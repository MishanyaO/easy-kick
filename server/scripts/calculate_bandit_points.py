#!/usr/bin/env python3
"""Reproduce the ``+1.3 pts`` lift shown in the Bandit Insights UI.

The UI value is a matched-control lift in participation points.  It is separate
from the logistic reward that updates the Bandit's Beta posterior.

Example::

    python scripts/calculate_bandit_points.py \
      --before-chatters 20 --before-viewers 1000 \
      --after-chatters 36 --after-viewers 1000 \
      --control-move 0.003

prints ``+1.3 pts``: participation rose by 0.016, while comparable quiet
windows normally rose by 0.003, leaving a matched lift of 0.013.
"""

from __future__ import annotations

import argparse
from collections.abc import Iterable
from decimal import Decimal, ROUND_HALF_UP

FALLBACK_VIEWERS = 100.0
CONTROL_POOL = 8


def participation(
    chatters: float,
    viewers: int | None,
    messages_per_minute: float = 0.0,
) -> float:
    """Match ``engagement._participation``.

    Every badge currently has weight 1, so ``chatters`` is the unique-chatter
    count.  When a real viewer count is unavailable, the production fallback
    mixes unique chatters and message rate and divides by 100.
    """
    if viewers:
        return chatters / viewers
    return (0.6 * chatters + 0.4 * messages_per_minute) / FALLBACK_VIEWERS


def matched_lift(
    before_participation: float,
    after_participation: float,
    control_moves: Iterable[float] = (),
) -> float:
    """Return the fraction stored as ``result.engagement_delta``.

    A control move is ``control_after - control_before`` from a clean, no-action
    window with the same chat state and duration.  Production retains the most
    recent eight such moves.  With no controls, drift is zero, although the UI
    marks the result as not yet attributable.
    """
    controls = list(control_moves)[-CONTROL_POOL:]
    drift = sum(controls) / len(controls) if controls else 0.0
    return (after_participation - before_participation) - drift


def format_points(lift: float, decimal_places: int = 1) -> str:
    """Match the UI's signed ``lift * 100`` presentation and remove ``-0.0``."""
    points = lift * 100.0
    quantum = Decimal(1).scaleb(-decimal_places)
    # Decimal.from_float preserves the binary float being rounded. ROUND_HALF_UP
    # matches JavaScript toFixed's tie direction after it takes the magnitude.
    rounded = Decimal.from_float(points).quantize(quantum, rounding=ROUND_HALF_UP)
    if rounded == 0:
        rounded = abs(rounded)
    sign = "+" if rounded > 0 else ""
    return f"{sign}{rounded:.{decimal_places}f} pts"


def calculate_points(
    *,
    before_chatters: float,
    after_chatters: float,
    before_viewers: int | None,
    after_viewers: int | None,
    before_messages_per_minute: float = 0.0,
    after_messages_per_minute: float = 0.0,
    control_moves: Iterable[float] = (),
) -> float:
    """Calculate the raw matched lift; pass it to ``format_points`` for the UI text."""
    before = participation(
        before_chatters, before_viewers, before_messages_per_minute
    )
    after = participation(after_chatters, after_viewers, after_messages_per_minute)
    return matched_lift(before, after, control_moves)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before-chatters", type=float, required=True)
    parser.add_argument("--after-chatters", type=float, required=True)
    parser.add_argument("--before-viewers", type=int)
    parser.add_argument("--after-viewers", type=int)
    parser.add_argument("--before-messages-per-minute", type=float, default=0.0)
    parser.add_argument("--after-messages-per-minute", type=float, default=0.0)
    parser.add_argument(
        "--control-move",
        type=float,
        action="append",
        default=[],
        help=(
            "repeat for each quiet-window participation change, as a fraction "
            "(0.003 means +0.3 pts)"
        ),
    )
    args = parser.parse_args()

    before = participation(
        args.before_chatters,
        args.before_viewers,
        args.before_messages_per_minute,
    )
    after = participation(
        args.after_chatters,
        args.after_viewers,
        args.after_messages_per_minute,
    )
    controls = args.control_move[-CONTROL_POOL:]
    drift = sum(controls) / len(controls) if controls else 0.0
    lift = matched_lift(before, after, controls)

    print(f"before participation : {before:.6f}")
    print(f"after participation  : {after:.6f}")
    print(f"naive change         : {after - before:.6f}")
    print(f"matched control drift: {drift:.6f}")
    print(f"matched lift         : {lift:.6f}")
    print(f"UI                    : {format_points(lift)}")


if __name__ == "__main__":
    main()
