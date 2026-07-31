"""The decision loop: read chat state, pick an intervention (or nothing), wait, measure the
lift against a control, update the posterior.

Two rules hold the whole thing together. Safety rails live here and are never learned — the
bandit optimises inside them. And a rail-forced no-op is not a decision: counting one would
poison `nothing`'s statistics with choices the policy never made.
"""

import asyncio
import logging
import random
import time
import uuid
from collections import Counter, deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from .bandit import MIN_PULLS, Bandit, Decision
from .context import StreamContext
from .controller_history import ControllerHistory
from .engagement import BOT_NAME, EngagementMonitor
from .hub import EventHub
from .models import (
    BANDIT_ARMS,
    Arm,
    Autonomy,
    ChatState,
    EventEnvelope,
    EventType,
    Mode,
    TrialOrigin,
)
from .reward import CONTAMINATION_S, Outcome, RewardBook, Window
from .store import EventStore

logger = logging.getLogger("kick.controller")

TICK_S = 5.0
# The tick is added because decisions only happen on the 5s grid: landing exactly on the
# boundary would leave it to float comparison.
COOLDOWN_S = CONTAMINATION_S + TICK_S
ARM_CAP_PER_HOUR = 4
PROMOTE_AFTER_APPROVALS = 5
SCAN_LIMIT = 200  # how far back the copy helpers look for a question or a new chatter
SUGGESTION_TTL_S = 60.0

DEFAULT_AUTONOMY = {
    Arm.NOTHING: Autonomy.AUTO,
    Arm.EMOTE_RALLY: Autonomy.ASK,  # still a line in the streamer's chat; theirs to approve
    Arm.CHAT_POLL: Autonomy.ASK,  # occupies chat's attention
    Arm.QUIZ: Autonomy.ASK,  # occupies chat's attention
    Arm.PREDICTION: Autonomy.ASK,  # stakes viewers' Channel Points. Not ours to spend
    # Never posts to chat, so there's nothing for the streamer to approve.
    Arm.CHAT_DIGEST: Autonomy.AUTO,
}


@dataclass(frozen=True)
class Card:
    """What the bot says, or what the streamer is asked to approve."""

    title: str
    body: str
    options: list[str]


@dataclass
class PendingAction:
    """A chosen action that has not successfully reached chat yet."""

    id: str
    decision: Decision
    card: Card
    origin: TrialOrigin
    awaiting_approval: bool
    expires_at: float


TEMPLATES = {
    Arm.EMOTE_RALLY: Card("Emote rally", "drop a 🔥 if you saw that", []),
    Arm.CHAT_POLL: Card("Chat poll", "was that a good call?", ["yes", "no"]),
    Arm.QUIZ: Card(
        "Quiz", "quick one: is that a buff or a debuff?", ["buff", "debuff"]
    ),
    Arm.PREDICTION: Card("Prediction", "/prediction Do they clutch it? | yes | no", []),
    Arm.CHAT_DIGEST: Card(
        "Chat digest", "a question worth answering is getting buried", []
    ),
}


def compose(arm: Arm) -> Card:
    """Copy for one arm. Templates are the floor; an LLM writer would replace this and a
    slow or failed call would fall back here without touching the learning loop."""
    return TEMPLATES[arm]


class Controller:
    def __init__(
        self,
        *,
        monitor: EngagementMonitor,
        bandit,
        rewards: RewardBook,
        context: StreamContext,
        store: EventStore,
        publish: Callable[[str, dict], None],
        perform: Callable[[str, Arm, ChatState, Card], bool] | None = None,
        require_live: bool = False,
        warmup_s: float = 0.0,
    ):
        self._monitor = monitor
        self._bandit = bandit
        self._rewards = rewards
        self._context = context
        self._store = store
        self._publish = publish
        self.perform = perform
        self._require_live = require_live
        self._warmup_s = warmup_s

        self.enabled = True  # kill switch
        self.autonomy = dict(DEFAULT_AUTONOMY)
        self.approvals: Counter[Arm] = Counter()
        self.vetoes: Counter[tuple[ChatState, Arm]] = Counter()

        # Set before the stream starts. In `manual`, `fire_rate` (fires/minute per arm) drives
        # firing directly and the bandit is never consulted or updated. In `auto` (default),
        # `fire_rate` is ignored entirely and Thompson sampling runs as normal — no blending.
        self.mode = Mode.AUTO
        self.fire_rate: dict[Arm, float] = {}

        self._pending: PendingAction | None = None
        self._window: Window | None = None
        self._card: Card | None = None
        self._fires: deque[tuple[float, Arm]] = deque()
        self._seen_category_change: float | None = None

    def tick(self, now: float) -> None:
        """One cycle. Safe to call at any cadence; nothing here sleeps or awaits."""
        self._close_due(now)
        self._expire_pending(now)
        self._reset_changed_regime()
        metrics = self._monitor.measure(now)
        state = self._monitor.classify(metrics)
        self._publish(
            "controller.context",
            self._context.frame(
                now,
                metrics.participation,
                metrics.unique_chatters,
                metrics.msgs_per_min,
                metrics.actions_per_min,
            ),
        )
        # Only once the prompt is actually in chat: a card still waiting for the streamer's
        # approval has asked nobody anything, so anything typed meanwhile is not a ballot.
        if self._window and self._window.fired and self._card and self._card.options:
            self._publish(
                "controller.poll", self._poll_frame(self._window, self._card, now)
            )

        if (
            not self.enabled
            or self._pending
            or self._window
            or self._railed(now)
            or not self._ready(now)
        ):
            return
        # Bandit-adjacent: `chat_digest` never touches chat and is never scored, so it isn't
        # one of the arms Thompson sampling competes over — but it still shares the cooldown
        # and hourly cap, so it can't collide with a fired arm's window.
        if (
            self.autonomy.get(Arm.CHAT_DIGEST) is not Autonomy.OFF
            and not self._capped(Arm.CHAT_DIGEST, now)
            and (highlight := _buried_highlight(self._store))
        ):
            self._fire_digest(highlight, now)
            return
        if self.mode is Mode.MANUAL:
            self._manual_tick(state, metrics, now)
            return
        eligible = self._eligible_arms(now)
        if not eligible or eligible == (Arm.NOTHING,):
            return
        try:
            decision = self._bandit.select(state, eligible)
        except Exception:
            # The bandit is a chooser, never a dependency. A degenerate cell must cost one
            # tick, not the loop.
            logger.warning("bandit.select failed; skipping tick", exc_info=True)
            return
        self._act(decision, metrics, now)

    def approve(self, action_id: str, now: float) -> bool:
        """Begin delivery. The measured window starts only after delivery succeeds."""
        pending = self._pending
        if not (pending and pending.awaiting_approval and pending.id == action_id):
            return False
        pending.awaiting_approval = False
        if pending.origin is TrialOrigin.AUTONOMOUS:
            pending.origin = TrialOrigin.APPROVED
        self.approvals[pending.decision.arm] += 1
        self._deliver(pending, now)
        return True

    def dismiss(self, action_id: str) -> bool:
        """Streamer killed a suggested card.

        A veto says this streamer does not want the arm, not that chat would have disliked
        it — the arm never fired. Folding it into the arm's posterior is missing-not-at-
        random, so it goes to a separate counter and the window is voided.
        """
        pending = self._pending
        if not (pending and pending.awaiting_approval and pending.id == action_id):
            return False
        self._pending = None
        self.vetoes[pending.decision.state, pending.decision.arm] += 1
        self._publish("controller.result", _pending_result(pending, "dismissed"))
        return True

    def delivery_succeeded(self, action_id: str, now: float) -> bool:
        """Activate a full treatment window after the action reached chat."""
        pending = self._pending
        if not (pending and not pending.awaiting_approval and pending.id == action_id):
            return False
        # Check contamination against the previous fire, never the one being opened now.
        self._window = self._rewards.open(
            pending.id,
            pending.decision.state,
            pending.decision.arm,
            now,
            fired=True,
            origin=pending.origin,
        )
        self._card = pending.card
        self._pending = None
        self._fires.append((now, self._window.arm))
        self._rewards.note_fire(now)
        return True

    def delivery_failed(self, action_id: str, reason: str = "send failed") -> bool:
        """Close a chosen action without pretending it became a treatment."""
        pending = self._pending
        if not (pending and not pending.awaiting_approval and pending.id == action_id):
            return False
        self._pending = None
        self._publish(
            "controller.result", _pending_result(pending, "send_failed", reason)
        )
        return True

    def policy(self) -> dict:
        """`GET /controller/policy`: the learned table, the rails, and what it all means."""
        return {
            "enabled": self.enabled,
            "mode": self.mode,
            "fire_rate": dict(self.fire_rate),
            "autonomy": dict(self.autonomy),
            "approvals": dict(self.approvals),
            "vetoes": [
                {"state": s, "arm": a, "count": n} for (s, a), n in self.vetoes.items()
            ],
            "promotions": self.promotions(),
            "insights": insights(self._bandit),
            **self._bandit.snapshot(),
        }

    def promotions(self) -> list[str]:
        """Arms the trust ratchet is ready to offer to promote out of `ask`."""
        return [
            arm
            for arm, mode in self.autonomy.items()
            if mode is Autonomy.ASK
            and arm is not Arm.PREDICTION  # never promoted: it spends viewers' points
            and self.approvals[arm] >= PROMOTE_AFTER_APPROVALS
            and _arm_mean(self._bandit, arm) > 0.5
        ]

    # --- internals -----------------------------------------------------------------

    def _railed(self, now: float) -> bool:
        return (
            self._context.speaking
            or self._context.in_transition(now)
            or (self._fires and now - self._fires[-1][0] < COOLDOWN_S)
        )

    def _capped(self, arm: Arm, now: float) -> bool:
        while self._fires and now - self._fires[0][0] > 3600:
            self._fires.popleft()
        return sum(a == arm for _, a in self._fires) >= ARM_CAP_PER_HOUR

    def _eligible_arms(self, now: float) -> tuple[Arm, ...]:
        """The exact choice set Thompson sampling and propensity logging both see."""
        return tuple(
            arm
            for arm in getattr(self._bandit, "arms", BANDIT_ARMS)
            if (
                arm is Arm.NOTHING
                or self.autonomy.get(arm, Autonomy.OFF) is not Autonomy.OFF
            )
            and not self._capped(arm, now)
        )

    def _ready(self, now: float) -> bool:
        if self._require_live and self._context.is_live is not True:
            return False
        if not self._warmup_s:
            return True
        return (
            self._context.started_at is not None
            and self._context.uptime_s(now) >= self._warmup_s
        )

    def _reset_changed_regime(self) -> None:
        changed_at = self._context.category_changed_at
        if changed_at is None or changed_at == self._seen_category_change:
            return
        self._seen_category_change = changed_at
        self._monitor.reset_baseline()
        self._rewards.reset_regime()

    def _act(
        self,
        decision: Decision,
        metrics,
        now: float,
        *,
        origin: TrialOrigin = TrialOrigin.AUTONOMOUS,
    ) -> None:
        arm, state = decision.arm, decision.state
        window_id = uuid.uuid4().hex[:12]
        autonomy = self.autonomy[arm]
        # `nothing` has no card and says nothing, but it still opens a window. Otherwise its
        # posterior never updates and the arm can never win — which is the whole reason the
        # bot stays quiet by default.
        card = None if arm is Arm.NOTHING else compose(arm)
        if card:
            pending = PendingAction(
                id=window_id,
                decision=decision,
                card=card,
                origin=origin,
                awaiting_approval=autonomy is Autonomy.ASK,
                expires_at=now + SUGGESTION_TTL_S,
            )
            self._pending = pending
            self._publish(
                "controller.action",
                _action(window_id, decision, card, metrics, now, autonomy),
            )
            if not pending.awaiting_approval:
                self._deliver(pending, now)
        else:
            self._window = self._rewards.open(
                window_id, state, arm, now, fired=False, origin=origin
            )
            self._card = None
        self._publish(
            "controller.bandit",
            {
                **self._bandit.snapshot(),
                "type": "bandit",
                "ts": _iso(now),
                "last_decision": decision.frame(),
            },
        )

    def _deliver(self, pending: PendingAction, now: float) -> None:
        """Start delivery; synchronous adapters confirm immediately, live ones callback."""
        if self.perform is None:
            self.delivery_failed(pending.id, "no delivery adapter configured")
            return
        try:
            sent = self.perform(
                pending.id, pending.decision.arm, pending.decision.state, pending.card
            )
        except Exception:
            logger.warning("action delivery failed", exc_info=True)
            self.delivery_failed(pending.id)
            return
        if sent:
            self.delivery_succeeded(pending.id, now)

    def _expire_pending(self, now: float) -> None:
        pending = self._pending
        if not (pending and pending.awaiting_approval and now >= pending.expires_at):
            return
        self._pending = None
        self._publish("controller.result", _pending_result(pending, "railed"))

    def _fire_chance(self, arm: Arm) -> float:
        """Slider rate (fires/minute) turned into a per-tick firing probability."""
        return min(1.0, self.fire_rate.get(arm, 0.0) * TICK_S / 60.0)

    def _manual_tick(self, state: ChatState, metrics, now: float) -> None:
        """Sliders decide, not the bandit — `bandit.select()` is never called here, and the
        window this opens is flagged so its close never updates a posterior."""
        eligible = [
            arm
            for arm in BANDIT_ARMS
            if arm is not Arm.NOTHING
            and self.autonomy[arm] is not Autonomy.OFF
            and not self._capped(arm, now)
            and random.random() < self._fire_chance(arm)
        ]
        if not eligible:
            return
        arm = random.choice(eligible)
        self._act(
            Decision(state, arm, {}, self._fire_chance(arm), tuple(eligible)),
            metrics,
            now,
            origin=TrialOrigin.MANUAL,
        )

    def _fire_digest(self, highlight: tuple[str, str], now: float) -> None:
        """Card-only: never calls `perform`, never opens a scored window."""
        self._fires.append((now, Arm.CHAT_DIGEST))
        who, text = highlight
        card = Card("Chat digest", f"@{who}: {text}", [])
        self._publish("controller.digest", _digest(card, highlight, now))

    def _close_due(self, now: float) -> None:
        window, card = self._window, self._card
        if window is None or now < window.closes_at:
            return
        self._window = self._card = None

        outcome = self._rewards.close(window, now)
        if (
            window.origin is TrialOrigin.AUTONOMOUS
            and outcome.contaminated is None
        ):
            self._bandit.update(window.state, window.arm, outcome.reward)
        self._publish(
            "controller.result",
            _result(
                window,
                outcome,
                "fired" if window.fired else "skipped",
                self._votes(window, card),
            ),
        )
        self._publish(
            "controller.bandit",
            {**self._bandit.snapshot(), "type": "bandit", "ts": _iso(now)},
        )

    def _votes(self, window: Window, card: Card | None) -> dict[str, int]:
        """A real poll without a poll API: the bot asked, chat replied, we count."""
        return self._ballots(window, card)[0]

    def _ballots(self, window: Window, card: Card | None) -> tuple[dict[str, int], int]:
        return ballots(self._store, card.options if card else [], window.opened_at)

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


def ballots(
    store: EventStore, options: list[str] | tuple[str, ...], since: float
) -> tuple[dict[str, int], int]:
    """The tally since `since`, and how many viewers cast a ballot.

    One viewer, one vote. Without this a single person typing `1` twenty times owns the
    poll — the mechanism that makes a chat poll cheap is the same one that makes it
    trivial to stuff, and the count is the thing a verdict is read off.

    First vote wins. Chat is a conversation: `2 ... actually no, 1` is a person arguing,
    not revising a ballot, and last-wins hands the poll to whoever talks most. Iteration
    runs newest-first, so the earliest ballot is the one that survives the overwrite.
    """
    if not options:
        return {}, 0
    lookup = {_normalise(option): option for option in options}
    cast: dict[str, str] = {}
    for ev in store.iter_recent():
        ts = ev.epoch()
        if ts is not None and ts < since:
            break
        # `==`, not `is`: EventEnvelope.type is a plain str, so identity never matches.
        if ev.type != EventType.CHAT_MESSAGE_SENT:
            continue
        # Our own prompt is in this window too, and `push it or reset?` leads with an
        # option — counting it would have the bot casting the first ballot in its own poll.
        if ev.username("sender") == BOT_NAME:
            continue
        choice = _vote_for(ev.payload.get("content") or "", lookup)
        if choice is None or (voter := _voter(ev)) is None:
            continue
        cast[voter] = choice
    tally = dict.fromkeys(options, 0)
    for choice in cast.values():
        tally[choice] += 1
    return tally, len(cast)


def insights(bandit) -> list[str]:
    """What the channel taught us, in sentences. This is the deliverable, not a footnote.

    A policy that holds no posteriors — any of the baselines — has nothing to say, and
    saying nothing beats inventing a finding.
    """
    if not getattr(bandit, "cells", None):
        return []
    lines = []
    means = {
        arm: _arm_mean(bandit, arm) for arm in bandit.arms if arm is not Arm.NOTHING
    }
    ranked = sorted(means.items(), key=lambda kv: -kv[1])
    if (
        len(ranked) >= 2
        and ranked[1][1] > 0
        and _evidence(bandit) >= MIN_PULLS * len(ranked)
    ):
        lines.append(
            f"In this channel, {ranked[0][0]} beats {ranked[1][0]} "
            f"{ranked[0][1] / ranked[1][1]:.1f}×."
        )
    for state in ChatState:
        cells = {arm: bandit.cells[state, arm] for arm in bandit.arms}
        if sum(c.pulls for c in cells.values()) >= MIN_PULLS * len(cells):
            best = max(cells, key=lambda arm: cells[arm].mean)
            lines.append(f"During a {state}, the best action is {best}.")
    return lines


def hub_publisher(
    hub: EventHub,
    history: ControllerHistory,
) -> Callable[[str, dict], None]:
    """Controller frames ride the existing `/stream` as envelopes with synthetic types.

    They are kept in a separate bounded history, never the engagement `EventStore`, so our
    own output cannot become audience activity.
    """

    def publish(event_type: str, payload: dict) -> None:
        frame = history.record(payload)
        hub.publish(
            EventEnvelope(
                type=event_type,
                version="1",
                message_id=uuid.uuid4().hex,
                timestamp=_iso(time.time()),
                payload=frame,
            )
        )

    return publish


def build_stack(
    app,
    settings,
    *,
    perform: Callable[[str, Arm, ChatState, Card], bool] | None = None,
    bandit_seed: int | None = None,
) -> None:
    """Wire StreamContext -> EventStore -> Bandit -> EngagementMonitor -> Controller onto
    `app.state`. Used both at app startup and to reset everything the gym touches, so the two
    can't drift apart.
    """
    app.state.context = StreamContext()
    app.state.store = EventStore(maxlen=settings.buffer_size)
    app.state.bandit = Bandit(seed=bandit_seed)
    app.state.monitor = EngagementMonitor(
        app.state.store,
        app.state.context,
        bot_user_id=(
            settings.bot_user_id
            or (
                str(settings.broadcaster_user_id)
                if settings.broadcaster_user_id is not None
                else None
            )
        ),
    )
    app.state.controller = Controller(
        monitor=app.state.monitor,
        bandit=app.state.bandit,
        rewards=RewardBook(app.state.monitor),
        context=app.state.context,
        store=app.state.store,
        publish=hub_publisher(app.state.hub, app.state.controller_history),
        perform=perform,
        require_live=settings.controller_enabled,
        warmup_s=settings.controller_warmup_s,
    )


async def run(controller: Controller, tick_s: float = TICK_S) -> None:
    """The live loop. One failing tick must not end the stream."""
    while True:
        await asyncio.sleep(tick_s)
        try:
            controller.tick(time.time())
        except Exception:
            logger.exception("controller tick failed")


def _action(
    window_id: str,
    decision: Decision,
    card: Card,
    metrics,
    now: float,
    autonomy: Autonomy,
) -> dict:
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
        "status": "suggested" if autonomy is Autonomy.ASK else "sending",
    }


def _digest(card: Card, highlight: tuple[str, str], now: float) -> dict:
    who, text = highlight
    return {
        "type": "digest",
        "ts": _iso(now),
        "kind": Arm.CHAT_DIGEST,
        "title": card.title,
        "body": card.body,
        "highlight": {"who": who, "text": text},
    }


def _result(
    window: Window,
    outcome: Outcome | None,
    status: str,
    votes: dict[str, int] | None = None,
) -> dict:
    return {
        "type": "result",
        "action_id": window.id,
        "state": window.state,
        "arm": window.arm,
        "origin": window.origin,
        "votes": votes or {},
        "engagement_delta": outcome.lift if outcome else 0.0,
        "reward": outcome.reward if outcome else 0.0,
        "lift_naive": outcome.lift_naive if outcome else 0.0,
        # Null when the window is attributable; a plain-words reason when it is not.
        "contaminated": outcome.contaminated if outcome else None,
        "controls": outcome.controls if outcome else 0,
        "outcome": status,
    }


def _pending_result(
    pending: PendingAction, status: str, reason: str | None = None
) -> dict:
    """A terminal action that never became a measured treatment."""
    return {
        "type": "result",
        "action_id": pending.id,
        "state": pending.decision.state,
        "arm": pending.decision.arm,
        "origin": pending.origin,
        "votes": {},
        "engagement_delta": 0.0,
        "reward": 0.0,
        "lift_naive": 0.0,
        "contaminated": reason,
        "controls": 0,
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


def _buried_highlight(store: EventStore) -> tuple[str, str] | None:
    """A question several people are asking — easy to miss in a fast-moving chat.

    Generalizes what used to be `question_relay`'s "the newest question" into "the question
    with the most independent askers", which is what makes it worth surfacing on a digest
    instead of reacting to a single message.
    """
    counts: Counter[str] = Counter()
    first_seen: dict[str, tuple[str, str]] = {}
    for i, ev in enumerate(store.iter_recent()):
        if i >= SCAN_LIMIT:
            break
        content = (ev.payload.get("content") or "").strip()
        if ev.type != EventType.CHAT_MESSAGE_SENT or not content.endswith("?"):
            continue
        if ev.username("sender") == BOT_NAME:  # our own line is not a buried question
            continue
        key = _normalise(content)
        counts[key] += 1
        first_seen.setdefault(key, (ev.username("sender") or "someone", content))
    recurring = [key for key, n in counts.items() if n >= 2]
    if not recurring:
        return None
    return first_seen[max(recurring, key=lambda k: counts[k])]


def _iso(moment: float) -> str:
    return (
        datetime.fromtimestamp(moment, tz=timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )
