"""A reactive chat simulator: personas with hidden response curves, a scripted content arc
that moves chat regardless of what the bot does, and forkable twin worlds for ground truth.

This is our development environment and test harness, not evidence. The bandit never sees
`true_effect` — it trains only on the observational estimator it would use on live Kick
traffic, and that separation is structural: the gym writes `EventEnvelope`s into the same
`EventStore` real webhooks write into, and `engagement.py` reads only from the store.

The honest limit: personas carry `theta[(state, arm)]` and the bandit is a table over
(state, arm), so world and model share a parameterisation. The model cannot be misspecified
here, only wrong about values.
"""

import copy
import math
import random
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone

from .bandit import Bandit, RandomPolicy, ReactivePolicy, SilentPolicy, TimerPolicy
from .context import StreamContext
from .controller import Controller
from .engagement import BOT_NAME, EngagementMonitor
from .hub import EventHub
from .models import Arm, Autonomy, ChatState, EventEnvelope, EventType
from .reward import RewardBook
from .store import EventStore

BASE_VIEWERS = 900
# Chat is a long tail: a few regulars carry it and most of the audience is convertible but
# silent. Too few personas and unique chatters saturates, which flattens every arm at once.
PERSONAS = 120
ARC_PERIOD_S = 1200.0
SIM_EPOCH = 1_750_000_000.0  # fixed clock origin for headless runs
# The confounder, and it has to exist: chat moves on its own, so a naive pre/post estimator
# has something to be biased by. (t, multiplier on every persona's base rate.)
ARC = ((0.0, 1.0), (300.0, 0.3), (600.0, 1.0), (900.0, 3.2), (1050.0, 1.4))
# A lull is where the headroom is. Mid-spike chat is already saying what it wants to say,
# and a bot talking over the moment actively deflates it — hence the negative gain.
STATE_GAIN = {ChatState.LULL: 1.4, ChatState.STEADY: 1.0, ChatState.SPIKE: -0.3}
FATIGUE_PER_FIRE = 0.6  # the fourth emote rally in an hour lands worse than the first
FATIGUE_RECOVERY_S = 1800.0

CHATTER = ("nice", "lets go", "🔥", "no way", "gg", "how did he do that", "first time here",
           "that was clean", "🚀🚀", "what happened", "lmao", "insane")


@dataclass(frozen=True)
class Archetype:
    """A voice, and what it will pay attention for. `responds_to` spans cost of
    participation, because that is what decides who converts."""

    name: str
    base_rate: float  # msgs/min at steady state
    responds_to: dict[Arm, float]


# Base rates are low on purpose: most of chat is silent in any given minute, and that
# headroom is what an intervention converts. A world where everyone already talks has
# nothing for any arm to win.
ARCHETYPES = (
    Archetype("lurker", 0.06, {Arm.EMOTE_RALLY: 3.5}),
    Archetype("emote_enthusiast", 0.8, {Arm.EMOTE_RALLY: 2.0, Arm.CHAT_POLL: 0.6}),
    Archetype("the_analyst", 0.4, {Arm.CHAT_POLL: 2.5, Arm.QUIZ: 2.2}),
    Archetype("regular", 1.0, {Arm.CHAT_POLL: 1.2, Arm.QUIZ: 1.0, Arm.EMOTE_RALLY: 0.8}),
    Archetype("newcomer", 0.15, {Arm.EMOTE_RALLY: 1.2}),
    Archetype("hype_beast", 0.6, {Arm.EMOTE_RALLY: 2.5, Arm.PREDICTION: 2.0}),
)


@dataclass
class Persona:
    name: str
    base_rate: float
    theta: dict[tuple[ChatState, Arm], float]  # hidden response multiplier
    fatigue: dict[Arm, float] = field(default_factory=dict)
    response_s: float = 60.0  # fixed at build time so `fire` consumes no randomness
    boost: float = 0.0
    boost_until: float = 0.0
    # Which way this persona leans when asked, in [0,1). Fixed at build time: a lean drawn
    # per poll would make every poll a coin flip, and a real chat has camps.
    lean: float = 0.5
    # The option they will type on their next message, while a poll is open on them.
    ballot: str | None = None
    ballot_until: float = 0.0


def build_personas(rng: random.Random, count: int = PERSONAS) -> list[Persona]:
    personas = []
    for i in range(count):
        arch = ARCHETYPES[i % len(ARCHETYPES)]
        theta = {
            (state, arm): arch.responds_to.get(arm, 0.0) * STATE_GAIN[state]
            * rng.uniform(0.6, 1.4)
            for state in ChatState for arm in Arm
        }
        personas.append(Persona(
            name=f"{arch.name}_{i}",
            base_rate=arch.base_rate * rng.uniform(0.7, 1.3),
            theta=theta,
            response_s=rng.uniform(30.0, 90.0),
            lean=rng.random(),
        ))
    return personas


class Gym:
    def __init__(self, seed: int, store: EventStore | None = None, hub: EventHub | None = None,
                 personas: int = PERSONAS, base_epoch: float | None = None):
        # Own the RNG. With a shared module-level `random`, two forks are not independent
        # and every twin-world number is garbage.
        self._rng = random.Random(seed)
        self._store = store
        self._hub = hub
        self.personas = build_personas(self._rng, personas)
        self.viewers = BASE_VIEWERS
        self.t = 0.0  # virtual seconds; the caller decides how they map to wall time
        # Live, virtual time starts now so the dashboard shows sensible clock times. Headless,
        # a fixed base keeps a seeded run reproducible down to the timestamp.
        self._base_epoch = time.time() if base_epoch is None else base_epoch
        self._log: deque[tuple[float, str]] = deque(maxlen=8000)

    @property
    def now(self) -> float:
        """Virtual time as a unix timestamp, so envelope timestamps and the controller agree."""
        return self._base_epoch + self.t

    def step(self, dt_s: float) -> list[EventEnvelope]:
        self.t += dt_s
        arc = self._arc()
        self._drift_viewers(arc)

        events = []
        for persona in self.personas:
            if self.t >= persona.boost_until:
                persona.boost = 0.0
            self._recover(persona, dt_s)
            rate = persona.base_rate * arc * max(0.0, 1.0 + persona.boost) / 60.0
            for _ in range(self._poisson(rate * dt_s)):
                events.append(self._chat(persona.name, self._speak(persona)))
        events += self._incidental(arc, dt_s)

        for event in events:
            self._emit(event)
        return events

    def fire(self, arm: Arm, state: ChatState, options: list[str] | None = None) -> None:
        """The bot intervened. Personas respond for a while, then tire of that arm.

        A gain can be negative — mistimed, an intervention suppresses chat rather than
        merely failing to help. Exactly zero means this persona does not care either way.

        `options` makes a poll answerable: a persona who responds to this arm types one of
        them instead of chatter. The world still only fakes the *chat* — nothing here
        touches the tally, the dedupe or the window, so a vote has to survive the same
        parsing a live viewer's would.
        """
        for persona in self.personas:
            gain = persona.theta[state, arm] * persona.fatigue.get(arm, 1.0)
            if gain == 0:
                continue
            persona.boost = gain
            persona.boost_until = self.t + persona.response_s
            persona.fatigue[arm] = persona.fatigue.get(arm, 1.0) * FATIGUE_PER_FIRE
            # A negative gain means the prompt landed badly — those people do not answer it.
            if options and gain > 0:
                persona.ballot = options[min(int(persona.lean * len(options)), len(options) - 1)]
                persona.ballot_until = self.t + persona.response_s

    def _speak(self, persona: Persona) -> str:
        """What this persona types next — their ballot if a poll is open on them, else noise.

        The ballot is not cleared after use: a real chat has people who type `1` twice, and
        the server's one-vote-per-viewer rule is exactly what has to absorb that.
        """
        if persona.ballot and self.t < persona.ballot_until:
            return persona.ballot
        persona.ballot = None
        return self._rng.choice(CHATTER)

    def say(self, text: str) -> EventEnvelope:
        """The bot's own line, so it shows up in chat like any other message."""
        event = self._chat(BOT_NAME, text)
        self._emit(event)
        return event

    def fork(self) -> "Gym":
        """A twin world, RNG state and all. Never shares the live store or hub — a twin
        that wrote into either would contaminate the world it was forked from."""
        store, hub = self._store, self._hub
        self._store, self._hub = None, None
        try:
            return copy.deepcopy(self)
        finally:
            self._store, self._hub = store, hub

    def participation(self, window_s: float = 60.0) -> float:
        cutoff = self.t - window_s
        return len({who for t, who in self._log if t >= cutoff}) / max(self.viewers, 1)

    def true_effect(self, arm: Arm, state: ChatState, window_s: float = 60.0) -> float:
        """participation(fired) − participation(no-op) from twin worlds. Evaluation only."""
        fired, control = self.fork(), self.fork()
        fired.fire(arm, state)
        for twin in (fired, control):
            twin.run(window_s)
        return fired.participation(window_s) - control.participation(window_s)

    def run(self, duration_s: float, dt_s: float = 5.0) -> None:
        for _ in range(int(duration_s / dt_s)):
            self.step(dt_s)

    # --- internals -----------------------------------------------------------------

    def _arc(self) -> float:
        phase = self.t % ARC_PERIOD_S
        points = ARC + ((ARC_PERIOD_S, ARC[0][1]),)
        for (t0, v0), (t1, v1) in zip(points, points[1:]):
            if phase < t1:
                return v0 + (v1 - v0) * (phase - t0) / (t1 - t0)
        return ARC[0][1]

    def _drift_viewers(self, arc: float) -> None:
        """Simulated so `participation` is exercised rather than falling back in the gym.

        Only weakly tied to the arc, and deliberately so: a clutch play makes the people
        already watching talk more, it does not double the audience inside a minute. Tie
        viewers tightly to the arc and participation — a ratio of the two — cancels out.
        """
        target = BASE_VIEWERS * (0.9 + 0.1 * arc)
        self.viewers = max(1, round(self.viewers + (target - self.viewers) * 0.02
                                    + self._rng.gauss(0, 3)))

    def _recover(self, persona: Persona, dt_s: float) -> None:
        for arm, level in persona.fatigue.items():
            persona.fatigue[arm] = min(1.0, level + dt_s / FATIGUE_RECOVERY_S)

    def _incidental(self, arc: float, dt_s: float) -> list[EventEnvelope]:
        """Kick-native reward signals, likelier when chat is worked up."""
        excitement = arc + sum(p.boost for p in self.personas) / len(self.personas)
        events = []
        for event_type, per_min in ((EventType.CHANNEL_FOLLOWED, 0.5),
                                    (EventType.KICKS_GIFTED, 0.2),
                                    (EventType.REWARD_REDEMPTION_UPDATED, 0.4)):
            for _ in range(self._poisson(per_min * excitement * dt_s / 60.0)):
                who = self._rng.choice(self.personas).name
                events.append(self._event(event_type, {"sender": _user(who)}))
        return events

    def _chat(self, username: str, text: str) -> EventEnvelope:
        if username != BOT_NAME:  # our own line is not audience participation
            self._log.append((self.t, username))
        return self._event(EventType.CHAT_MESSAGE_SENT, {
            "message_id": uuid.uuid4().hex,
            "replies_to": None,
            "sender": _user(username),
            "content": text,
            "emotes": [],
        })

    def _event(self, event_type: EventType, payload: dict) -> EventEnvelope:
        # Virtual time, not wall clock: engagement windows read envelope timestamps, and a
        # headless run would otherwise put 2000 decisions inside the same "second".
        return EventEnvelope(type=event_type.value, version="1", message_id=uuid.uuid4().hex,
                             timestamp=_iso(self.now),
                             payload={"broadcaster": _user("streamer"), **payload})

    def _emit(self, event: EventEnvelope) -> None:
        # Same store-then-publish order as the webhook route.
        if self._store is not None and self._store.add(event) and self._hub is not None:
            self._hub.publish(event)

    def _poisson(self, lam: float) -> int:
        """Knuth. Per-persona rates here are well under 1, so the loop is short."""
        target, k, product = math.exp(-lam), 0, self._rng.random()
        while product > target:
            k += 1
            product *= self._rng.random()
        return k


POLICIES = ("gambit", "random", "timer", "reactive", "silent")


def build_policy(name: str, seed: int):
    match name:
        case "gambit":
            return Bandit(seed=seed)
        case "random":
            return RandomPolicy(seed=seed)
        case "timer":
            return TimerPolicy()
        case "reactive":
            return ReactivePolicy()
        case "silent":
            return SilentPolicy()
    raise ValueError(f"unknown policy: {name!r}")


def simulate(*, seed: int, decisions: int, policy: str = "gambit", truth: bool = False,
             tick_s: float = 5.0, max_steps: int = 40_000) -> dict:
    """Run one world headless until `decisions` windows have closed.

    `truth` measures each fire against twin worlds. It costs two forks per fire and is only
    ever read by the evaluation — never by the policy.
    """
    store = EventStore(maxlen=4000)
    context = StreamContext()
    gym = Gym(seed=seed, store=store, base_epoch=SIM_EPOCH)
    monitor = EngagementMonitor(store, context)
    brain = build_policy(policy, seed)

    results: list[dict] = []
    samples: list[dict] = []
    pending_truth: float | None = 0.0 if truth else None

    def publish(event_type: str, payload: dict) -> None:
        nonlocal pending_truth
        if event_type == "controller.result":
            # A `nothing` window has no effect to measure, so its ground truth is zero.
            results.append({**payload, "lift_true": pending_truth if truth else None})
            pending_truth = 0.0 if truth else None

    def fire(arm: Arm, state: ChatState, card) -> None:
        nonlocal pending_truth
        pending_truth = gym.true_effect(arm, state) if truth else None
        gym.say(card.body)
        gym.fire(arm, state, card.options)

    controller = Controller(monitor=monitor, bandit=brain, rewards=RewardBook(monitor),
                        context=context, store=store, publish=publish, perform=fire)
    # Nobody is at the keyboard headless, and an unanswered card is a voided window.
    controller.autonomy = dict.fromkeys(controller.autonomy, Autonomy.AUTO)

    for step in range(max_steps):
        gym.step(tick_s)
        context.viewer_count = gym.viewers
        controller.tick(gym.now)
        if step % int(60 / tick_s) == 0:
            participation = gym.participation()
            samples.append({"t": gym.t, "participation": participation,
                            "unique_chatters": round(participation * gym.viewers)})
        if len(results) >= decisions:
            break

    active = [s["unique_chatters"] for s in samples] or [0]
    return {
        "policy": policy,
        "seed": seed,
        "hours": gym.t / 3600.0,
        "results": results,
        "samples": samples,
        "active_chatters_per_min": sum(active) / len(active),
        "posteriors": brain.snapshot()["posteriors"],
    }


def _user(username: str) -> dict:
    # Derived from the name the same way the simulator route does it, so gym traffic carries
    # the identity anything counting people keys on — unique chatters, one-vote-per-viewer.
    user_id = uuid.uuid5(uuid.NAMESPACE_URL, f"kick.com/{username}").int % 2_000_000_000
    return {"is_anonymous": False, "username": username, "channel_slug": username.lower(),
            "user_id": user_id, "identity": {"badges": []}}


def _iso(moment: float) -> str:
    return datetime.fromtimestamp(moment, tz=timezone.utc).isoformat().replace("+00:00", "Z")
