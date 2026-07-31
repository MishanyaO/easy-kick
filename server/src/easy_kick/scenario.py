"""A stage-friendly stream story: generated from a seed, not written out in advance.

The gym is the statistical test environment and its chat is deliberately generic. This module
is the one we put on a screen, so its chat has to read like a real room watching a real match.
What it is *not* is a script: the arc, who talks, when the bot decides, which tactic it picks
and how the room answers are all drawn from one seeded RNG. Same seed, same show; a new seed,
a genuinely different one.

Everything downstream of the chat is production code. Messages go through the real
``EventStore``, ``EngagementMonitor`` classifies the room from those messages alone, Thompson
sampling picks the tactic, ``RewardBook`` scores the window against matched quiet controls, and
the votes are counted by the same parser a live Kick poll goes through. The only thing this
module knows that the policy does not is ``AUDIENCE`` — the hidden truth it has to discover.
"""

from __future__ import annotations

import random
import time
import uuid
from bisect import insort
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone

from .bandit import Bandit
from .context import StreamContext
from .controller import COOLDOWN_S, TICK_S, ballots
from .engagement import BOT_NAME, EngagementMonitor
from .hub import EventHub
from .models import Arm, ChatState, EventEnvelope, EventType
from .reward import RewardBook, Window
from .store import EventStore

SCENARIO_NAME = "ranked_run"
RUN_S = 7200.0  # two virtual hours of stream — a ranked session, not a highlight reel
VIEWERS = 640
BASE_PER_MINUTE = 16.0  # ambient chat at heat 1.0, before the arc and the mood multiply it
WARMUP_S = 120.0  # the controller watches the room before it is allowed an opinion of it
RESPONSE_WINDOW_S = 40.0  # how long a room takes to finish answering a prompt
RESPONSE_SPREAD = 0.35  # per-fire noise on the hidden response size, as a fraction of it
BACKFIRE_S = 45.0  # how long the room stays put out after a mistimed interruption
REGULAR_WEIGHT = 12.0  # a regular talks this much more than a lurker, unprompted
LURKERS = 96
EARLY_EXIT = 0.25  # matches that end in the first fight, so the arc is not a metronome

# How likely the bot is to spend a decision on the room it can currently see. Deliberately
# mild: a rail that refused to act during a spike would hand the policy the answer it is
# supposed to *learn*, so this leans toward a quiet room and no further. Together with the
# cooldown it is where the spacing between interventions comes from — there is no timer here,
# and the gaps run from the cooldown floor to several minutes depending on what chat does.
URGE = {ChatState.LULL: 0.5, ChatState.STEADY: 0.25, ChatState.SPIKE: 0.25}

# The hidden truth, and the only thing here the bandit cannot see: how many viewers answer an
# intervention, on average, in each state. Negative means the room gets *quieter* — a prompt
# during a clutch talks over the moment people are actually watching. Each fire samples around
# these with `RESPONSE_SPREAD`, so a good tactic still lands flat sometimes and a bad one
# occasionally works. That variance is the reason a bandit is the right tool and one trial
# is not a conclusion.
AUDIENCE = {
    (ChatState.LULL, Arm.EMOTE_RALLY): 18.0,
    (ChatState.LULL, Arm.CHAT_POLL): 15.0,
    (ChatState.LULL, Arm.QUIZ): 11.0,
    (ChatState.STEADY, Arm.EMOTE_RALLY): 10.0,
    (ChatState.STEADY, Arm.CHAT_POLL): 9.0,
    (ChatState.STEADY, Arm.QUIZ): 6.0,
    (ChatState.SPIKE, Arm.EMOTE_RALLY): -5.0,
    (ChatState.SPIKE, Arm.CHAT_POLL): -8.0,
    (ChatState.SPIKE, Arm.QUIZ): -10.0,
}


@dataclass(frozen=True)
class Phase:
    """One beat of a ranked match. `heat` multiplies the ambient message rate."""

    kind: str  # which chat pool and which cards belong to this moment
    beat: str  # what the operator strip calls it
    heat: float
    seconds: tuple[float, float]  # sampled per match, so no two runs share a rhythm


# One match, looped. Durations are drawn inside these ranges every time round, so nothing in
# the run lands on a grid and no two matches have the same shape.
MATCH = (
    Phase("calm", "in queue", 0.45, (40.0, 90.0)),
    Phase("banter", "dropping in", 1.0, (25.0, 45.0)),
    Phase("calm", "looting", 0.5, (50.0, 110.0)),
    Phase("fight", "first contact", 2.2, (30.0, 60.0)),
    Phase("calm", "rotating", 0.6, (40.0, 90.0)),
    Phase("fight", "third party", 2.0, (25.0, 55.0)),
    Phase("clutch", "endgame", 3.2, (40.0, 85.0)),
    Phase("banter", "post-game", 1.1, (30.0, 60.0)),
)
DIED_EARLY_AT = 4  # leaving "first contact": some runs end there and skip to the post-game


@dataclass(frozen=True)
class Card:
    """A tactic with copy attached. `options` empty means there is nothing to count."""

    arm: Arm
    title: str
    body: str
    options: tuple[str, ...] = ()


# Copy that fits the moment it is sent in. A poll about the next loadout during an endgame is
# the exact thing that makes a bot feel like a cron job, so cards are drawn from the current
# phase's pool and the same body cannot come back inside eight interventions.
CARDS: dict[str, tuple[Card, ...]] = {
    "calm": (
        Card(Arm.CHAT_POLL, "Chat poll", "loadout for this one: bow or shotgun?",
             ("bow", "shotgun")),
        Card(Arm.CHAT_POLL, "Chat poll", "next drop — hot or edge?", ("hot", "edge")),
        Card(Arm.CHAT_POLL, "Chat poll", "rotate river or ridge?", ("river", "ridge")),
        Card(Arm.QUIZ, "Quiz", "while we heal: max shield, 100 or 150?", ("100", "150")),
        Card(Arm.QUIZ, "Quiz", "vault key on this map — blue or gold?", ("blue", "gold")),
        Card(Arm.QUIZ, "Quiz", "does smoke cancel the scan: yes or no?", ("yes", "no")),
        Card(Arm.EMOTE_RALLY, "Emote rally", "quiet lobby, loud chat — emote check"),
        Card(Arm.EMOTE_RALLY, "Emote rally", "drop an emote if you're still here"),
        Card(Arm.EMOTE_RALLY, "Emote rally", "spam something while we queue"),
    ),
    "banter": (
        Card(Arm.CHAT_POLL, "Chat poll", "better drop spot: caves or tower?",
             ("caves", "tower")),
        Card(Arm.CHAT_POLL, "Chat poll", "worth a replay of that one — yes or no?",
             ("yes", "no")),
        Card(Arm.CHAT_POLL, "Chat poll", "save the ult next game or use it early?",
             ("save", "early")),
        Card(Arm.QUIZ, "Quiz", "what won that game: height or aim?", ("height", "aim")),
        Card(Arm.QUIZ, "Quiz", "squads left at the end — 3 or 4?", ("3", "4")),
        Card(Arm.QUIZ, "Quiz", "is that gun a buff or a nerf this season?", ("buff", "nerf")),
        Card(Arm.EMOTE_RALLY, "Emote rally", "GG in chat"),
        Card(Arm.EMOTE_RALLY, "Emote rally", "W in chat if that was clean"),
        Card(Arm.EMOTE_RALLY, "Emote rally", "emote if you're staying for one more"),
    ),
    "fight": (
        Card(Arm.CHAT_POLL, "Chat poll", "best play there — flank or hold?",
             ("flank", "hold")),
        Card(Arm.CHAT_POLL, "Chat poll", "push it or reset?", ("push", "reset")),
        Card(Arm.QUIZ, "Quiz", "does that shield break in one shot: yes or no?",
             ("yes", "no")),
        Card(Arm.QUIZ, "Quiz", "who has the angle here — us or them?", ("us", "them")),
        Card(Arm.EMOTE_RALLY, "Emote rally", "emote if he wins this one"),
        Card(Arm.EMOTE_RALLY, "Emote rally", "spam it if that shot lands"),
    ),
    "clutch": (
        Card(Arm.CHAT_POLL, "Chat poll", "do they take this: yes or no?", ("yes", "no")),
        Card(Arm.CHAT_POLL, "Chat poll", "clutch or reset?", ("clutch", "reset")),
        Card(Arm.QUIZ, "Quiz", "is height worth more than shield here — yes or no?",
             ("yes", "no")),
        Card(Arm.QUIZ, "Quiz", "last one standing gets what, 1 point or 2?", ("1", "2")),
        Card(Arm.EMOTE_RALLY, "Emote rally", "EMOTE WALL NOW"),
        Card(Arm.EMOTE_RALLY, "Emote rally", "SPAM IT"),
    ),
}

# What the room says about the stream, independent of anything the bot does. Short, repetitive
# and imperfect on purpose: that reads like chat, not like dialogue written for chat. Kick
# inlines emotes in the body as `[emote:<id>:<name>]` and the dashboard renders the art.
CHATTER: dict[str, tuple[str, ...]] = {
    "calm": (
        "queue times are rough tonight", "what rank are we now", "brb making coffee",
        "this skin combo goes hard", "song id?", "first time catching the stream",
        "audio ok for everyone?", "how long we been live", "chat is so quiet lol",
        "i missed the last one, what happened", "[emote:1730752:emojiAngel]",
        "did we win the last game?", "my ping is awful today", "new map when",
        "he always loots this side", "loadout looks clean",
    ),
    "banter": (
        "here we go", "dropping where", "not roof again", "free loot down there",
        "gl", "that landing was clean", "[emote:1730756:emojiCheerful]", "run it back",
        "he had 3 kills last game", "one more one more", "nice route", "clip that later",
        "so close last game", "chat behave", "lets get one", "teammate is a liability",
    ),
    "fight": (
        "BEHIND", "one shot one shot", "he heard you", "reload!!", "third party incoming",
        "get the height", "[emote:1579033:emojiAstonished]", "no way he missed", "PUSH",
        "team above us", "heal heal heal", "how did that not hit", "two left", "nice shot",
        "back up back up", "theyre pushing",
    ),
    "clutch": (
        "I CANT WATCH", "NO SHOT", "clip it clip it", "one hp", "chat be quiet let him hear",
        "[emote:1579033:emojiAstonished][emote:1579033:emojiAstonished]", "my heart",
        "hes cracked", "LAST ONE", "this is insane", "W AIM", "GO GO GO",
        "[emote:1730760:emojiCrave]", "unreal", "he actually did it", "screaming rn",
    ),
}

# How a ballot is typed. Some of these deliberately do not parse as votes — a real poll is
# answered by a room, not a form, and the tally has to survive that rather than assume it away.
BALLOTS = (
    "{opt}", "{opt}", "{opt}", "{opt}", "{opt} for sure", "{opt} 100%", "{opt} obviously",
    "{opt}?", "gotta be {opt}", "idk maybe {opt}", "im saying {opt}",
)
RALLY = (
    "[emote:1730756:emojiCheerful]", "[emote:1730756:emojiCheerful][emote:1730756:emojiCheerful]",
    "[emote:1730759:emojiCool]", "[emote:1730760:emojiCrave]", "[emote:1730755:emojiBubbly]",
    "[emote:1579033:emojiAstonished]", "W", "wwww", "LETS GO", "🔥🔥",
)
ANNOYED = (
    "not now bot", "bad timing lol", "cant see the callouts", "let him cook",
    "bot read the room", "kinda busy here",
)

REGULARS = ("mia", "rohan", "nix", "lulu", "jess", "pixelpete", "ash", "kai",
            "sora", "benji", "tanya", "dv8", "moose", "kestrel")
LURKER_STEMS = ("kev", "dana", "marc", "sunny", "tofu", "gizmo", "pip", "wren",
                "bolt", "juno", "rico", "nova", "cinder", "yuki", "orbit", "hazel")
LURKER_TAGS = ("", "_", "xx", "99", "07", "_tv", "2k", "42", "77", "_gg")


@dataclass(frozen=True)
class Persona:
    """A name in chat. `lean` is which way they answer, fixed for the whole run.

    Fixed rather than drawn per poll on purpose: a lean sampled per question makes every poll
    a coin flip, and a real chat has camps that hold across a stream.
    """

    name: str
    lean: float


class Scenario:
    """One seeded ranked session, played on a virtual clock the gym routes drive."""

    mode = "scenario"

    def __init__(
        self,
        *,
        seed: int,
        store: EventStore,
        hub: EventHub,
        bandit: Bandit,
        publish,
        context: StreamContext | None = None,
        base_epoch: float | None = None,
    ):
        self._rng = random.Random(seed)
        self._store = store
        self._hub = hub
        self._bandit = bandit
        self._publish = publish
        self._context = context if context is not None else StreamContext()
        self._context.category = self._context.category or "Fortnite"
        self._base_epoch = time.time() if base_epoch is None else base_epoch
        # Production measurement, unmodified: it reads the store and nothing else, so it sees
        # exactly what it would see on live Kick traffic.
        self._monitor = EngagementMonitor(store, self._context)
        self._rewards = RewardBook(self._monitor)

        regulars = [Persona(name, self._rng.random()) for name in REGULARS]
        pool = [stem + tag for stem in LURKER_STEMS for tag in LURKER_TAGS]
        lurkers = [
            Persona(name, self._rng.random())
            for name in self._rng.sample(pool, LURKERS)
        ]
        # Most of an audience is silent in any given minute, and that headroom is what an
        # intervention converts. Regulars carry the ambient conversation; the room only gets
        # visibly bigger when someone asks it something.
        self._regulars = regulars
        self.personas = regulars + lurkers
        self._weights = [REGULAR_WEIGHT] * len(regulars) + [1.0] * len(lurkers)

        self.t = 0.0
        self.viewers = VIEWERS
        self.state = ChatState.STEADY
        self.completed = False
        self.decisions = 0
        self.interventions = 0
        self.match = 1

        self._phase_index = 0
        self._phase = MATCH[0]
        self._phase_ends_at = self._rng.uniform(*MATCH[0].seconds)
        self._mood = self._rng.uniform(0.8, 1.3)
        self._chill = 1.0
        self._chill_until = 0.0
        self._next_tick = TICK_S
        self._next_chat_at = 0.0
        self._schedule_chat()
        self._replies: list[tuple[float, str, str]] = []
        self._recent: deque[str] = deque(maxlen=8)
        self._window: Window | None = None
        self._card: Card | None = None
        self._fired_at: float | None = None
        self._opened = False

    @property
    def now(self) -> float:
        """Virtual time as a unix timestamp, so envelope times and the measurement agree."""
        return self._base_epoch + self.t

    def status(self) -> dict[str, object]:
        return {
            "scenario": SCENARIO_NAME,
            "match": self.match,
            "beat": self._phase.beat,
            "state": self.state,
            "decisions": self.decisions,
            "interventions": self.interventions,
        }

    def step(self, dt_s: float) -> list[EventEnvelope]:
        """Advance the story and publish everything that fell due, in time order."""
        if self.completed:
            return []
        if not self._opened:
            self._opened = True
            self._publish_policy()
        target = min(self.t + dt_s, RUN_S)
        events: list[EventEnvelope] = []
        while (due := self._next_due()) <= target:
            self.t = due
            events.extend(self._advance())
        self.t = target
        if self.t >= RUN_S:
            self.completed = True
        return events

    def next_due_in(self) -> float:
        """Virtual seconds to the next message, decision or phase change.

        The caller sleeps exactly this long rather than polling on a grid: human messages
        quantized onto a tick arrive in lumps, and lumps are the thing that reads as a bot.
        """
        if self.completed:
            return 0.0
        return max(0.001, min(self._next_due(), RUN_S) - self.t)

    # --- the clock -------------------------------------------------------------------

    def _next_due(self) -> float:
        upcoming = [self._phase_ends_at, self._next_chat_at, self._next_tick]
        if self._replies:
            upcoming.append(self._replies[0][0])
        return min(upcoming)

    def _advance(self) -> list[EventEnvelope]:
        """Everything that happens at exactly `self.t`, chat before the decision that reads
        it — a message sent this instant is part of the window it is measured in."""
        events = []
        if self.t >= self._phase_ends_at:
            self._next_phase()
        while self._replies and self._replies[0][0] <= self.t:
            _, who, text = self._replies.pop(0)
            events.append(self._say(who, text))
        if self.t >= self._next_chat_at:
            speaker = self._rng.choices(self.personas, self._weights)[0]
            events.append(self._say(speaker.name, self._rng.choice(CHATTER[self._phase.kind])))
            self._schedule_chat()
        if self.t >= self._next_tick:
            self._next_tick += TICK_S
            events.extend(self._decide())
        return events

    def _next_phase(self) -> None:
        index = self._phase_index + 1
        if index == DIED_EARLY_AT and self._rng.random() < EARLY_EXIT:
            index = len(MATCH) - 1  # knocked out in the first fight; straight to the lobby
        if index >= len(MATCH):
            index, self.match = 0, self.match + 1
        self._phase_index = index
        self._phase = MATCH[index]
        self._phase_ends_at = self.t + self._rng.uniform(*self._phase.seconds)
        self._mood = self._rng.uniform(0.8, 1.3)  # no two looting phases are equally chatty
        self._schedule_chat()

    def _schedule_chat(self) -> None:
        """Next arrival off an exponential clock. Resampling whenever the rate changes is
        free: an exponential gap is memoryless, so a partly-elapsed one carries no history."""
        chill = self._chill if self.t < self._chill_until else 1.0
        rate = BASE_PER_MINUTE * self._phase.heat * self._mood * chill
        self._next_chat_at = self.t + max(0.05, self._rng.expovariate(rate / 60.0))

    # --- the decision loop -----------------------------------------------------------

    def _decide(self) -> list[EventEnvelope]:
        now = self.now
        self._drift_viewers()
        self._context.viewer_count = self.viewers
        metrics = self._monitor.measure(now)
        self.state = self._monitor.classify(metrics)
        self._publish(
            "controller.context",
            self._context.frame(now, metrics.participation, metrics.unique_chatters,
                                metrics.msgs_per_min, metrics.actions_per_min),
        )
        if self._window is not None:
            self._publish_poll(now)
            if now >= self._window.closes_at:
                self._close(now)
            return []
        if self.t < WARMUP_S:
            return []  # the baseline means nothing until there is a stream to compare to
        if self._fired_at is not None and now - self._fired_at < COOLDOWN_S:
            return []
        if self._rng.random() >= URGE[self.state]:
            return []
        return self._act(metrics, now)

    def _act(self, metrics, now: float) -> list[EventEnvelope]:
        decision = self._bandit.select(self.state)
        action_id = uuid.uuid4().hex[:12]
        spoken: list[EventEnvelope] = []
        # `nothing` says nothing but still opens a window: without one its posterior never
        # updates, and the arm that is supposed to win during a clutch could never win.
        card = None if decision.arm is Arm.NOTHING else self._compose(decision.arm)
        if card is not None:
            self._publish(
                "controller.action",
                {
                    "type": "action",
                    "id": action_id,
                    "ts": _iso(now),
                    "kind": decision.arm,
                    "trigger": self.state,
                    "state": self.state,
                    "propensity": decision.propensity,
                    "autonomy": "auto",
                    "reason": f"{self.state}: {metrics.participation:.1%} of viewers talking",
                    "title": card.title,
                    "body": card.body,
                    "options": list(card.options),
                    "auto_fire": True,
                    "status": "sending",
                },
            )
            # A real chat event, like every other line — the measurement then has to know to
            # leave our own message out of the participation it credits us with.
            spoken.append(self._say(BOT_NAME, card.body))
        # Contamination is read off the *previous* fire, so the window opens before this one
        # is recorded — otherwise every fired window flags itself.
        self._window = self._rewards.open(
            action_id, self.state, decision.arm, now, fired=card is not None
        )
        self._card = card
        if card is not None:
            self._rewards.note_fire(now)
            self._fired_at = now
            self.interventions += 1
            self._respond(decision.arm, card)
        self.decisions += 1
        self._publish(
            "controller.bandit",
            {**self._bandit.snapshot(), "type": "bandit", "ts": _iso(now),
             "evidence_origin": "scenario", "last_decision": decision.frame()},
        )
        return spoken

    def _close(self, now: float) -> None:
        window, card = self._window, self._card
        self._window = self._card = None
        outcome = self._rewards.close(window, now)
        votes, _ = ballots(
            self._store, list(card.options) if card else [], window.opened_at
        )
        # A window nobody can attribute teaches nothing, exactly as in the live controller.
        if outcome.contaminated is None:
            self._bandit.update(window.state, window.arm, outcome.reward)
        self._publish(
            "controller.result",
            {
                "type": "result",
                "action_id": window.id,
                "state": window.state,
                "arm": window.arm,
                # Simulated evidence stays labelled as such wherever it is shown, however
                # real the measurement behind it was.
                "origin": "scenario",
                "votes": votes,
                "engagement_delta": outcome.lift,
                "reward": outcome.reward,
                "lift_naive": outcome.lift_naive,
                "contaminated": outcome.contaminated,
                "controls": outcome.controls,
                "outcome": "fired" if window.fired else "skipped",
            },
        )
        self._publish_policy(now)

    def _compose(self, arm: Arm) -> Card:
        """Copy that belongs to this moment, and that chat has not just heard."""
        pool = [card for card in CARDS[self._phase.kind] if card.arm is arm]
        fresh = [card for card in pool if card.body not in self._recent]
        card = self._rng.choice(fresh or pool)
        self._recent.append(card.body)
        return card

    def _respond(self, arm: Arm, card: Card) -> None:
        """The room answers — or stops talking, which is also an answer."""
        mean = AUDIENCE[self.state, arm]
        count = round(self._rng.gauss(mean, abs(mean) * RESPONSE_SPREAD))
        if count > 0:
            for who in self._rng.sample(self.personas, min(count, len(self.personas))):
                at = self.t + self._rng.uniform(2.0, RESPONSE_WINDOW_S)
                insort(self._replies, (at, who.name, self._reply(who, card)))
        elif count < 0:
            # Interrupted at the wrong moment, people stop typing rather than argue about it.
            # Suppressing the ambient rate is what makes a backfire show up in the measurement
            # instead of only in the transcript.
            self._chill = max(0.4, 1.0 + count / 20.0)
            self._chill_until = self.t + BACKFIRE_S
            self._schedule_chat()
            for who in self._rng.sample(self._regulars, min(-count, 3)):
                at = self.t + self._rng.uniform(2.0, 12.0)
                insort(self._replies, (at, who.name, self._rng.choice(ANNOYED)))

    def _reply(self, who: Persona, card: Card) -> str:
        if not card.options:
            return self._rng.choice(RALLY)
        index = min(int(who.lean * len(card.options)), len(card.options) - 1)
        return self._rng.choice(BALLOTS).format(opt=card.options[index])

    def _drift_viewers(self) -> None:
        """Loosely tied to the arc, and deliberately so: a clutch play makes the people
        already watching talk more, it does not double the audience inside a minute. Tie
        viewers tightly to the arc and participation — a ratio of the two — cancels out."""
        target = VIEWERS * (0.95 + 0.05 * self._phase.heat)
        self.viewers = max(
            1, round(self.viewers + (target - self.viewers) * 0.05 + self._rng.gauss(0, 2))
        )

    # --- frames ----------------------------------------------------------------------

    def _publish_poll(self, now: float) -> None:
        """The open tally, republished every tick — the one moment a viewer is doing
        something is the one moment the streamer should be able to watch it."""
        window, card = self._window, self._card
        if not (window and window.fired and card and card.options):
            return
        votes, voters = ballots(self._store, list(card.options), window.opened_at)
        self._publish(
            "controller.poll",
            {
                "type": "poll",
                "ts": _iso(now),
                "action_id": window.id,
                "arm": window.arm,
                "question": card.body,
                "options": list(card.options),
                "votes": votes,
                "voters": voters,
                "closes_in_s": max(0.0, round(window.closes_at - now, 1)),
            },
        )

    def _publish_policy(self, now: float | None = None) -> None:
        self._publish(
            "controller.bandit",
            {**self._bandit.snapshot(), "type": "bandit",
             "ts": _iso(self.now if now is None else now),
             "evidence_origin": "scenario"},
        )

    def _say(self, username: str, text: str) -> EventEnvelope:
        event = EventEnvelope(
            type=EventType.CHAT_MESSAGE_SENT,
            version="1",
            message_id=uuid.uuid4().hex,
            timestamp=_iso(self.now),
            payload={
                "broadcaster": _user("streamer"),
                "message_id": uuid.uuid4().hex,
                "replies_to": None,
                "sender": _user(username),
                "content": text,
                "emotes": [],
            },
        )
        if self._store.add(event):
            self._hub.publish(event)
        return event


def catalogue() -> dict[str, object]:
    """The world, including the table the policy is never shown.

    Publishing the ground truth is the point: a demo where the outcomes were written down in
    advance proves nothing, and one where you can check what the bandit was up against proves
    something. Nothing in the run reads this.
    """
    return {
        "scenario": SCENARIO_NAME,
        "description": "a seeded ranked session — the arc, the chat, the timing and every "
                       "outcome are drawn from the seed, and measured by production code",
        "duration_s": RUN_S,
        "viewers": VIEWERS,
        "decision_every_s": TICK_S,
        "cooldown_s": COOLDOWN_S,
        "warmup_s": WARMUP_S,
        "match": [
            {"beat": phase.beat, "kind": phase.kind, "heat": phase.heat,
             "seconds": list(phase.seconds)}
            for phase in MATCH
        ],
        "cards": sum(len(pool) for pool in CARDS.values()),
        "ground_truth": [
            {"state": state, "arm": arm, "responders": mean, "hidden_from_policy": True}
            for (state, arm), mean in AUDIENCE.items()
        ],
    }


def _user(username: str) -> dict[str, object]:
    """The identity anything counting people keys on — unique chatters, one-vote-per-viewer."""
    user_id = uuid.uuid5(uuid.NAMESPACE_URL, f"kick.com/{username}").int % 2_000_000_000
    return {
        "is_anonymous": False,
        "username": username,
        "channel_slug": username.lower(),
        "user_id": user_id,
        "identity": {"badges": []},
    }


def _iso(moment: float) -> str:
    return (
        datetime.fromtimestamp(moment, tz=timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )
