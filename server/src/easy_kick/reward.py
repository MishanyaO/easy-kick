"""Scoring a closed decision window.

The reward is a lift against comparable windows where nothing fired, never a raw level: a
clutch play spikes chat whether or not we did anything.
"""

import math
from collections import deque
from dataclasses import dataclass

from .engagement import EngagementMonitor
from .models import Arm, ChatState

WINDOW_S = 60.0
# The score is a *relative* lift — "participation went up a fifth" — so these constants mean
# the same thing on a 200-viewer channel and a 20,000-viewer one. The reported lift stays in
# participation points, because that is the number anyone can picture.
FIRE_COST = 0.05  # small and load-bearing: an intervention has to earn its interruption
BONUS_WEIGHT = 0.02  # per redemption / kicks gift / follow inside the window
SCALE = 0.15  # logistic width: a 15% relative lift scores ~0.73
# A 60% relative lift is already an enormous result. Past that we are almost certainly
# dividing by a control that is barely above zero — the first minutes of a stream, a channel
# coming back from a break — and one freak window must not own a posterior.
MAX_RELATIVE_LIFT = 0.6
CONTROL_POOL = 8  # clean same-state windows averaged into the matched control
# Cooldown is 90s and chat keeps responding for up to 90s, so the window after a fire still
# carries the last intervention's tail or its fatigue. Neither is a control.
CONTAMINATION_S = 120.0


@dataclass
class Window:
    """One decision, open until `closes_at`."""

    id: str
    state: ChatState
    arm: Arm
    opened_at: float
    closes_at: float
    control_naive: float
    fired: bool
    contaminated: bool


@dataclass(frozen=True)
class Outcome:
    reward: float  # [0, 1], what the posterior sees
    lift: float  # against the matched control — the one we ship
    lift_naive: float  # against the 60s before the fire — kept for the comparison


class RewardBook:
    """Opens and closes windows, and keeps the pool of clean controls they are scored on."""

    def __init__(self, monitor: EngagementMonitor, window_s: float = WINDOW_S):
        self._monitor = monitor
        self._window_s = window_s
        self._pool = {state: deque(maxlen=CONTROL_POOL) for state in ChatState}
        self._last_fire_at: float | None = None

    def note_fire(self, now: float) -> None:
        self._last_fire_at = now

    def open(self, window_id: str, state: ChatState, arm: Arm, now: float,
             *, fired: bool) -> Window:
        return Window(
            id=window_id,
            state=state,
            arm=arm,
            opened_at=now,
            closes_at=now + self._window_s,
            control_naive=self._monitor.measure(now).participation,
            fired=fired,
            contaminated=self._contaminated(now),
        )

    def close(self, window: Window, now: float) -> Outcome:
        after = self._monitor.measure(now)
        moved = after.participation - window.control_naive
        lift = moved - self._drift(window.state)
        base = window.control_naive
        relative = _clip(lift / base, MAX_RELATIVE_LIFT) if base > 0 else 0.0
        raw = relative + BONUS_WEIGHT * after.rewards - (FIRE_COST if window.fired else 0.0)

        # Contaminated windows still count as decisions; they just cannot be controls.
        if not window.fired and not window.contaminated:
            self._pool[window.state].append(moved)

        return Outcome(reward=_logistic(raw / SCALE), lift=lift, lift_naive=moved)

    def _drift(self, state: ChatState) -> float:
        """How far chat moves over a window in this state anyway, with nobody intervening.

        This is the whole correction. Subtracting a pooled *level* instead looks tempting
        and is worse: those windows were sampled all over the stream's content arc, and that
        variance swamps the mean reversion it was meant to remove. Differencing first keeps
        the comparison local in time, and this term is then exactly the reversion `naive`
        mistakes for our effect.
        """
        pool = self._pool[state]
        return sum(pool) / len(pool) if pool else 0.0

    def _contaminated(self, now: float) -> bool:
        return (self._last_fire_at is not None
                and now - self._last_fire_at < CONTAMINATION_S)


def _clip(x: float, limit: float) -> float:
    return max(-limit, min(limit, x))


def _logistic(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-_clip(x, 30.0)))
