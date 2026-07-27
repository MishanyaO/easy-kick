"""The decision loop: read chat state, pick an intervention (or nothing), wait, measure the
lift against a control, update the posterior.

Two rules hold the whole thing together. Safety rails live here and are never learned — the
bandit optimises inside them. And a rail-forced no-op is not a decision: counting one would
poison `nothing`'s statistics with choices the policy never made.
"""

import asyncio
import logging
import time
import uuid
from collections import Counter, deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from .bandit import MIN_PULLS, Decision
from .context import StreamContext
from .engagement import EngagementMonitor
from .hub import EventHub
from .models import Arm, Autonomy, ChatState, EventEnvelope, EventType
from .reward import Outcome, RewardBook, Window
from .store import EventStore

logger = logging.getLogger("kick.controller")

TICK_S = 5.0
COOLDOWN_S = 90.0  # one open window at a time, and a quiet gap after every fire
ARM_CAP_PER_HOUR = 4
PROMOTE_AFTER_APPROVALS = 5
SCAN_LIMIT = 200  # how far back the copy helpers look for a question or a new chatter

DEFAULT_AUTONOMY = {
    Arm.NOTHING: Autonomy.AUTO,
    Arm.EMOTE_RALLY: Autonomy.AUTO,  # spends nothing but a chat line
    Arm.SHOUTOUT: Autonomy.AUTO,
    Arm.CHAT_POLL: Autonomy.ASK,  # occupies chat's attention
    Arm.QUESTION_RELAY: Autonomy.ASK,
    Arm.PREDICTION: Autonomy.ASK,  # stakes viewers' Channel Points. Not ours to spend
}


@dataclass(frozen=True)
class Card:
    """What the bot says, or what the streamer is asked to approve."""

    title: str
    body: str
    options: list[str]


TEMPLATES = {
    Arm.EMOTE_RALLY: Card("Emote rally", "drop a 🔥 if you saw that", []),
    Arm.CHAT_POLL: Card("Chat poll", "was that a good call? 1) yes  2) no — type 1 or 2",
                        ["1", "2"]),
    Arm.QUESTION_RELAY: Card("Question relay", "there's a question in chat worth answering",
                             []),
    Arm.SHOUTOUT: Card("Shoutout", "welcome in, good to see a new face 👋", []),
    Arm.PREDICTION: Card("Prediction", "/prediction Do they clutch it? | yes | no", []),
}


def compose(arm: Arm, store: EventStore) -> Card:
    """Copy for one arm. Templates are the floor; an LLM writer would replace this and a
    slow or failed call would fall back here without touching the learning loop."""
    match arm:
        case Arm.QUESTION_RELAY:
            if asked := _recent_question(store):
                who, text = asked
                return Card("Question relay", f"@{who} asked: {text}", [])
        case Arm.SHOUTOUT:
            if who := _newest_chatter(store):
                return Card("Shoutout", f"welcome in @{who} 👋", [])
    return TEMPLATES[arm]


class Controller:
    def __init__(self, *, monitor: EngagementMonitor, bandit, rewards: RewardBook,
                 context: StreamContext, store: EventStore,
                 publish: Callable[[str, dict], None],
                 perform: Callable[[Arm, ChatState, Card], None] | None = None):
        self._monitor = monitor
        self._bandit = bandit
        self._rewards = rewards
        self._context = context
        self._store = store
        self._publish = publish
        self.perform = perform  # how an arm actually reaches chat; None means card-only

        self.enabled = True  # kill switch
        self.autonomy = dict(DEFAULT_AUTONOMY)
        self.approvals: Counter[Arm] = Counter()
        self.vetoes: Counter[tuple[ChatState, Arm]] = Counter()

        self._window: Window | None = None
        self._card: Card | None = None
        self._awaiting_approval = False
        self._fires: deque[tuple[float, Arm]] = deque()

    def tick(self, now: float) -> None:
        """One cycle. Safe to call at any cadence; nothing here sleeps or awaits."""
        self._close_due(now)
        metrics = self._monitor.measure(now)
        state = self._monitor.classify(metrics)
        self._publish("controller.context", self._context.frame(now, metrics.participation))
        # Only once the prompt is actually in chat: a card still waiting for the streamer's
        # approval has asked nobody anything, so anything typed meanwhile is not a ballot.
        if self._window and self._window.fired and self._card and self._card.options:
            self._publish("controller.poll", self._poll_frame(self._window, self._card, now))

        if not self.enabled or self._window or self._railed(now):
            return
        try:
            decision = self._bandit.select(state)
        except Exception:
            # The bandit is a chooser, never a dependency. A degenerate cell must cost one
            # tick, not the loop.
            logger.warning("bandit.select failed; skipping tick", exc_info=True)
            return
        if self.autonomy[decision.arm] is Autonomy.OFF or self._capped(decision.arm, now):
            return  # rail, not a decision
        self._act(decision, metrics, now)

    def approve(self, action_id: str, now: float) -> bool:
        """Streamer sent a suggested card. The arm fires now and the window runs on."""
        if not (self._awaiting_approval and self._window and self._window.id == action_id):
            return False
        self._awaiting_approval = False
        self.approvals[self._window.arm] += 1
        self._window.fired = True
        self._do_fire(self._window.arm, self._window.state, self._card, now)
        return True

    def dismiss(self, action_id: str) -> bool:
        """Streamer killed a suggested card.

        A veto says this streamer does not want the arm, not that chat would have disliked
        it — the arm never fired. Folding it into the arm's posterior is missing-not-at-
        random, so it goes to a separate counter and the window is voided.
        """
        if not (self._awaiting_approval and self._window and self._window.id == action_id):
            return False
        window = self._window
        self._window, self._card, self._awaiting_approval = None, None, False
        self.vetoes[window.state, window.arm] += 1
        self._publish("controller.result", _result(window, None, "dismissed"))
        return True

    def policy(self) -> dict:
        """`GET /controller/policy`: the learned table, the rails, and what it all means."""
        return {
            "enabled": self.enabled,
            "autonomy": dict(self.autonomy),
            "approvals": dict(self.approvals),
            "vetoes": [{"state": s, "arm": a, "count": n} for (s, a), n in self.vetoes.items()],
            "promotions": self.promotions(),
            "insights": insights(self._bandit),
            **self._bandit.snapshot(),
        }

    def promotions(self) -> list[str]:
        """Arms the trust ratchet is ready to offer to promote out of `ask`."""
        return [
            arm for arm, mode in self.autonomy.items()
            if mode is Autonomy.ASK
            and arm is not Arm.PREDICTION  # never promoted: it spends viewers' points
            and self.approvals[arm] >= PROMOTE_AFTER_APPROVALS
            and _arm_mean(self._bandit, arm) > 0.5
        ]

    # --- internals -----------------------------------------------------------------

    def _railed(self, now: float) -> bool:
        return (self._context.speaking
                or self._context.in_transition(now)
                or (self._fires and now - self._fires[-1][0] < COOLDOWN_S))

    def _capped(self, arm: Arm, now: float) -> bool:
        while self._fires and now - self._fires[0][0] > 3600:
            self._fires.popleft()
        return sum(a == arm for _, a in self._fires) >= ARM_CAP_PER_HOUR

    def _act(self, decision: Decision, metrics, now: float) -> None:
        arm, state = decision.arm, decision.state
        window_id = uuid.uuid4().hex[:12]
        autonomy = self.autonomy[arm]
        # `nothing` has no card and says nothing, but it still opens a window. Otherwise its
        # posterior never updates and the arm can never win — which is the whole reason the
        # bot stays quiet by default.
        self._card = None if arm is Arm.NOTHING else compose(arm, self._store)
        self._awaiting_approval = self._card is not None and autonomy is Autonomy.ASK
        fires_now = self._card is not None and not self._awaiting_approval

        if fires_now:
            self._do_fire(arm, state, self._card, now)
        if self._card:
            self._publish("controller.action",
                          _action(window_id, decision, self._card, metrics, now, autonomy))

        self._window = self._rewards.open(window_id, state, arm, now, fired=fires_now)
        self._publish("controller.bandit",
                      {**self._bandit.snapshot(), "type": "bandit", "ts": _iso(now),
                       "last_decision": decision.frame()})

    def _do_fire(self, arm: Arm, state: ChatState, card: Card | None, now: float) -> None:
        self._fires.append((now, arm))
        self._rewards.note_fire(now)
        if self.perform and card:
            self.perform(arm, state, card)

    def _close_due(self, now: float) -> None:
        window, card = self._window, self._card
        if window is None or now < window.closes_at:
            return
        self._window = self._card = None

        if self._awaiting_approval:
            # Nobody answered the card. No fire, no signal, no update.
            self._awaiting_approval = False
            self._publish("controller.result", _result(window, None, "railed"))
            return

        outcome = self._rewards.close(window, now)
        self._bandit.update(window.state, window.arm, outcome.reward)
        self._publish("controller.result",
                      _result(window, outcome, "fired" if window.fired else "skipped",
                              self._votes(window, card)))
        self._publish("controller.bandit",
                      {**self._bandit.snapshot(), "type": "bandit", "ts": _iso(now)})

    def _votes(self, window: Window, card: Card | None) -> dict[str, int]:
        """A real poll without a poll API: the bot asked, chat replied, we count."""
        return self._ballots(window, card)[0]

    def _ballots(self, window: Window, card: Card | None) -> tuple[dict[str, int], int]:
        """The tally, and how many viewers cast a ballot.

        One viewer, one vote. Without this a single person typing `1` twenty times owns the
        poll — the mechanism that makes a chat poll cheap is the same one that makes it
        trivial to stuff, and the count is the thing a verdict is read off.

        First vote wins. Chat is a conversation: `2 ... actually no, 1` is a person arguing,
        not revising a ballot, and last-wins hands the poll to whoever talks most. Iteration
        runs newest-first, so the earliest ballot is the one that survives the overwrite.
        """
        if not card or not card.options:
            return {}, 0
        lookup = {_normalise(option): option for option in card.options}
        ballots: dict[str, str] = {}
        for ev in self._store.iter_recent():
            ts = ev.epoch()
            if ts is not None and ts < window.opened_at:
                break
            # `==`, not `is`: EventEnvelope.type is a plain str, so identity never matches.
            if ev.type != EventType.CHAT_MESSAGE_SENT:
                continue
            choice = _vote_for(ev.payload.get("content") or "", lookup)
            if choice is None or (voter := _voter(ev)) is None:
                continue
            ballots[voter] = choice
        tally = dict.fromkeys(card.options, 0)
        for choice in ballots.values():
            tally[choice] += 1
        return tally, len(ballots)

    def _poll_frame(self, window: Window, card: Card, now: float) -> dict:
        """The open poll, published every tick.

        Votes used to exist only on the closed `result`, so the card was blind for the whole
        window — the one moment a viewer is actually doing something is the one moment the
        streamer could not see it.
        """
        tally, voters = self._ballots(window, card)
        return {
            "type": "poll",
            "ts": _iso(now),
            "action_id": window.id,
            "arm": window.arm,
            "question": card.body,
            "options": list(card.options),
            "votes": tally,
            "voters": voters,
            "closes_in_s": max(0.0, round(window.closes_at - now, 1)),
        }


def insights(bandit) -> list[str]:
    """What the channel taught us, in sentences. This is the deliverable, not a footnote.

    A policy that holds no posteriors — any of the baselines — has nothing to say, and
    saying nothing beats inventing a finding.
    """
    if not getattr(bandit, "cells", None):
        return []
    lines = []
    means = {arm: _arm_mean(bandit, arm) for arm in bandit.arms if arm is not Arm.NOTHING}
    ranked = sorted(means.items(), key=lambda kv: -kv[1])
    if len(ranked) >= 2 and ranked[1][1] > 0 and _evidence(bandit) >= MIN_PULLS * len(ranked):
        lines.append(f"In this channel, {ranked[0][0]} beats {ranked[1][0]} "
                     f"{ranked[0][1] / ranked[1][1]:.1f}×.")
    for state in ChatState:
        cells = {arm: bandit.cells[state, arm] for arm in bandit.arms}
        if sum(c.pulls for c in cells.values()) >= MIN_PULLS * len(cells):
            best = max(cells, key=lambda arm: cells[arm].mean)
            lines.append(f"During a {state}, the best action is {best}.")
    return lines


def hub_publisher(hub: EventHub) -> Callable[[str, dict], None]:
    """Controller frames ride the existing `/stream` as envelopes with synthetic types.

    They are published, never stored: `engagement.py` reads the store, and our own output
    is not chat.
    """
    def publish(event_type: str, payload: dict) -> None:
        hub.publish(EventEnvelope(type=event_type, version="1", message_id=uuid.uuid4().hex,
                                  timestamp=_iso(time.time()), payload=payload))
    return publish


async def run(controller: Controller, tick_s: float = TICK_S) -> None:
    """The live loop. One failing tick must not end the stream."""
    while True:
        await asyncio.sleep(tick_s)
        try:
            controller.tick(time.time())
        except Exception:
            logger.exception("controller tick failed")


def _action(window_id: str, decision: Decision, card: Card, metrics, now: float,
            autonomy: Autonomy) -> dict:
    return {
        "type": "action",
        "id": window_id,
        "ts": _iso(now),
        "kind": decision.arm,
        "trigger": decision.state,
        "state": decision.state,
        "propensity": decision.propensity,
        "autonomy": autonomy,
        "reason": f"{decision.state}: {metrics.participation:.1%} of viewers talking",
        "title": card.title,
        "body": card.body,
        "options": card.options,
        "auto_fire": autonomy is Autonomy.AUTO,
        "status": "suggested" if autonomy is Autonomy.ASK else "live",
    }


def _result(window: Window, outcome: Outcome | None, status: str,
            votes: dict[str, int] | None = None) -> dict:
    return {
        "type": "result",
        "action_id": window.id,
        "state": window.state,
        "arm": window.arm,
        "votes": votes or {},
        "engagement_delta": outcome.lift if outcome else 0.0,
        "reward": outcome.reward if outcome else 0.0,
        "lift_naive": outcome.lift_naive if outcome else 0.0,
        # Null when the window is attributable; a plain-words reason when it is not.
        "contaminated": outcome.contaminated if outcome else None,
        "controls": outcome.controls if outcome else 0,
        "outcome": status,
    }


def _normalise(text: str) -> str:
    """Vote text reduced to what the viewer meant: case, spacing and punctuation dropped."""
    return "".join(ch for ch in text.lower() if ch.isalnum())


def _vote_for(text: str, lookup: dict[str, str]) -> str | None:
    """Which option this message votes for, or None.

    `1`, `!1`, `1)`, ` 1 ` and `1 yes` all vote for `1`. Exact-string matching counted none
    of those, so a poll could read zero while chat was visibly answering it. `is 1 better?`
    still counts for nothing — the option has to lead the message, or every mention of a
    number becomes a ballot.
    """
    stripped = text.strip()
    if not stripped:
        return None
    if (whole := _normalise(stripped)) in lookup:
        return lookup[whole]
    return lookup.get(_normalise(stripped.split(maxsplit=1)[0]))


def _voter(ev: EventEnvelope) -> str | None:
    """The identity a ballot is keyed on — `user_id` where Kick sends it, else the name."""
    sender = ev.payload.get("sender") or {}
    if (user_id := sender.get("user_id")) is not None:
        return f"id:{user_id}"
    username = sender.get("username")
    return f"name:{username}" if username else None


def _arm_mean(bandit, arm: Arm) -> float:
    cells = [bandit.cells[state, arm] for state in ChatState]
    return sum(c.mean for c in cells) / len(cells)


def _evidence(bandit) -> int:
    return sum(cell.pulls for cell in bandit.cells.values())


def _recent_question(store: EventStore) -> tuple[str, str] | None:
    """The newest chat message that reads as a question, with whoever asked it."""
    for i, ev in enumerate(store.iter_recent()):
        if i >= SCAN_LIMIT:
            break
        content = ev.payload.get("content") or ""
        if ev.type == EventType.CHAT_MESSAGE_SENT and content.rstrip().endswith("?"):
            return ev.username("sender") or "someone", content
    return None


def _newest_chatter(store: EventStore) -> str | None:
    """The most recent chatter who has said only one thing — a plausible first-timer."""
    counts: Counter[str] = Counter()
    order: list[str] = []
    for i, ev in enumerate(store.iter_recent()):
        if i >= SCAN_LIMIT:
            break
        if ev.type == EventType.CHAT_MESSAGE_SENT and (who := ev.username("sender")):
            counts[who] += 1
            order.append(who)
    return next((who for who in order if counts[who] == 1), None)


def _iso(moment: float) -> str:
    return datetime.fromtimestamp(moment, tz=timezone.utc).isoformat().replace("+00:00", "Z")
