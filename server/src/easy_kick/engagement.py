"""Rolling chat metrics and the three-state classification the bandit conditions on.

Reads the event store and nothing else, so it sees exactly what it would see on live Kick
traffic whether the events came from a webhook or from the gym.
"""

import math
from dataclasses import dataclass, field

from .context import StreamContext
from .models import ChatState, EventType
from .store import EventStore

WINDOW_S = 60.0
BOT_NAME = "gambit"  # our own lines are output, not audience engagement
BASELINE_ALPHA = 0.02  # ~4 minutes of history at a 5s tick
LULL_RATIO, SPIKE_RATIO = 0.7, 1.4
# Without a viewer count there is nothing to divide by, so scale by a plausible audience
# instead. Only the fallback path uses it; state is a ratio and cancels it out anyway.
FALLBACK_VIEWERS = 100.0
# A gift this size counts as one unit of reward, and the scale around it is logarithmic:
# a 10× bigger gift is worth more, but nowhere near 10× more. A linear amount would let one
# whale outweigh every other signal in the window and teach the bandit to chase them.
TYPICAL_GIFT = 100.0

# How much one chatter counts toward participation, by Kick badge. All 1.0 — every voice
# counts the same — and that is a deliberate default, not a stub: weighting subs and VIPs
# above everyone else retargets the bot from "make chat lively" to "engage the people who
# spend", which is a product decision the streamer should make on purpose. Editing a value
# here is the whole switch; nothing else needs to change.
CHATTER_WEIGHTS: dict[str, float] = {
    "broadcaster": 1.0,
    "moderator": 1.0,
    "subscriber": 1.0,
    "founder": 1.0,
    "vip": 1.0,
    "og": 1.0,
}


@dataclass(frozen=True)
class Metrics:
    """One window of chat, from the store alone. `window_s` is how wide it was."""

    ts: float
    unique_chatters: int
    msgs_per_min: float
    redemptions: int
    kicks_gifted: int
    follows: int
    viewer_count: int | None
    participation: float
    window_s: float = WINDOW_S
    # The identities behind `unique_chatters`, so a window can be differenced against
    # another one and say *who* is new rather than only how many.
    chatters: frozenset[str] = field(default_factory=frozenset)
    kicks_value: float = 0.0

    @property
    def rewards(self) -> float:
        """Kick-native signals that someone did more than type.

        Gifts enter by size rather than by count. Falling back to 1.0 per gift when the
        payload carries no amount keeps this identical to the count it replaced.
        """
        return self.redemptions + self.kicks_value + self.follows

    @property
    def actions_per_min(self) -> float:
        """Comments plus reactions: chat messages and channel-point spend, same window."""
        scale = 60.0 / self.window_s
        return self.msgs_per_min + (self.redemptions + self.kicks_gifted) * scale


class EngagementMonitor:
    def __init__(self, store: EventStore, context: StreamContext, window_s: float = WINDOW_S,
                 bot_username: str = BOT_NAME, bot_user_id: str | None = None):
        self._store = store
        self._context = context
        self._window_s = window_s
        self._bot = bot_username
        self._bot_user_id = bot_user_id
        self.baseline: float | None = None

    def reset_baseline(self) -> None:
        self.baseline = None

    def measure(self, now: float, window_s: float | None = None) -> Metrics:
        """Window metrics at time `now`. Pure, so reward scoring can call it freely.

        `window_s` overrides the default width. Scoring a window has to look back exactly
        as far as that window was wide: measuring a 45s treatment with a 60s lookback puts
        15s of *pre*-treatment chat in the "after" sample and quietly dilutes the lift.
        """
        window_s = self._window_s if window_s is None else window_s
        cutoff = now - window_s
        weights: dict[str, float] = {}
        msgs = redemptions = kicks = follows = 0
        kicks_value = 0.0

        for ev in self._store.iter_recent():
            ts = ev.epoch()
            if ts is None:
                continue
            if ts < cutoff:
                break  # events are appended in time order, so nothing older can qualify
            if ts > now:
                continue
            match ev.type:
                case EventType.CHAT_MESSAGE_SENT:
                    sender_node = ev.payload.get("sender") or {}
                    sender = sender_node.get("username")
                    sender_id = sender_node.get("user_id")
                    if sender == self._bot or (
                        self._bot_user_id is not None
                        and sender_id is not None
                        and str(sender_id) == self._bot_user_id
                    ):
                        continue  # measuring our own line as engagement flatters every fire
                    msgs += 1
                    key = (
                        f"id:{sender_id}" if sender_id is not None
                        else f"name:{sender}" if sender else None
                    )
                    if key is not None:
                        # Events arrive newest-first, so a viewer whose badges changed
                        # mid-window is counted at whatever they hold now.
                        weights.setdefault(key, _chatter_weight(sender_node))
                case EventType.REWARD_REDEMPTION_UPDATED:
                    redemptions += 1
                case EventType.KICKS_GIFTED:
                    kicks += 1
                    kicks_value += _gift_value(ev.payload)
                case EventType.CHANNEL_FOLLOWED:
                    follows += 1

        msgs_per_min = msgs / (window_s / 60.0)
        viewers = self._context.viewer_count
        weighted = sum(weights.values())
        return Metrics(
            ts=now,
            unique_chatters=len(weights),
            msgs_per_min=msgs_per_min,
            redemptions=redemptions,
            kicks_gifted=kicks,
            follows=follows,
            viewer_count=viewers,
            participation=_participation(weighted, msgs_per_min, viewers),
            window_s=window_s,
            chatters=frozenset(weights),
            kicks_value=kicks_value,
        )

    def classify(self, m: Metrics) -> ChatState:
        """Rate against the channel's own rolling baseline, then fold `m` into it."""
        baseline = self.baseline if self.baseline is not None else m.participation
        self.baseline = baseline + BASELINE_ALPHA * (m.participation - baseline)

        ratio = m.participation / baseline if baseline > 0 else 1.0
        if ratio < LULL_RATIO:
            return ChatState.LULL
        if ratio > SPIKE_RATIO:
            return ChatState.SPIKE
        return ChatState.STEADY


def _participation(chatters: float, msgs_per_min: float, viewers: int | None) -> float:
    """Share of the audience talking.

    A rate, not a volume: it is the number a streamer has intuition about, it is comparable
    across channels, and it absorbs a raid that triples the message rate for reasons that
    have nothing to do with us. Raw msgs/min is also gameable by one person spamming.

    `chatters` is the badge-weighted headcount, which equals the plain count while every
    weight in `CHATTER_WEIGHTS` is 1.0.
    """
    if viewers:
        return chatters / viewers
    return (0.6 * chatters + 0.4 * msgs_per_min) / FALLBACK_VIEWERS


def _chatter_weight(sender: dict) -> float:
    """What one viewer's presence is worth, from their Kick badges.

    The strongest badge wins rather than the sum: a moderator who is also a subscriber is
    one person, and multiplying their badges together would make them a crowd.
    """
    identity = sender.get("identity") or {}
    badges = identity.get("badges") or []
    return max(
        (
            CHATTER_WEIGHTS[b["type"]]
            for b in badges
            if isinstance(b, dict) and b.get("type") in CHATTER_WEIGHTS
        ),
        default=1.0,
    )


def _gift_value(payload: dict) -> float:
    """One gift's weight, log-scaled around `TYPICAL_GIFT`. 1.0 when no amount is sent."""
    gift = payload.get("gift")
    amount = gift.get("amount") if isinstance(gift, dict) else None
    if not isinstance(amount, (int, float)) or amount <= 0:
        return 1.0
    return math.log1p(amount) / math.log1p(TYPICAL_GIFT)
