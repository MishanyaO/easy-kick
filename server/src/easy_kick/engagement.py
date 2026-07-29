"""Rolling chat metrics and the three-state classification the bandit conditions on.

Reads the event store and nothing else, so it sees exactly what it would see on live Kick
traffic whether the events came from a webhook or from the gym.
"""

from dataclasses import dataclass

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


@dataclass(frozen=True)
class Metrics:
    """One 60s window of chat, from the store alone."""

    ts: float
    unique_chatters: int
    msgs_per_min: float
    redemptions: int
    kicks_gifted: int
    follows: int
    viewer_count: int | None
    participation: float

    @property
    def rewards(self) -> int:
        """Kick-native signals that someone did more than type."""
        return self.redemptions + self.kicks_gifted + self.follows

    @property
    def actions_per_min(self) -> float:
        """Comments plus reactions: chat messages and channel-point spend, same window."""
        scale = 60.0 / WINDOW_S
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

    def measure(self, now: float) -> Metrics:
        """Window metrics at time `now`. Pure, so reward scoring can call it freely."""
        cutoff = now - self._window_s
        chatters: set[str] = set()
        msgs = redemptions = kicks = follows = 0

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
                    if sender_id is not None:
                        chatters.add(f"id:{sender_id}")
                    elif sender:
                        chatters.add(f"name:{sender}")
                case EventType.REWARD_REDEMPTION_UPDATED:
                    redemptions += 1
                case EventType.KICKS_GIFTED:
                    kicks += 1
                case EventType.CHANNEL_FOLLOWED:
                    follows += 1

        msgs_per_min = msgs / (self._window_s / 60.0)
        viewers = self._context.viewer_count
        return Metrics(
            ts=now,
            unique_chatters=len(chatters),
            msgs_per_min=msgs_per_min,
            redemptions=redemptions,
            kicks_gifted=kicks,
            follows=follows,
            viewer_count=viewers,
            participation=_participation(len(chatters), msgs_per_min, viewers),
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


def _participation(unique_chatters: int, msgs_per_min: float, viewers: int | None) -> float:
    """Share of the audience talking.

    A rate, not a volume: it is the number a streamer has intuition about, it is comparable
    across channels, and it absorbs a raid that triples the message rate for reasons that
    have nothing to do with us. Raw msgs/min is also gameable by one person spamming.
    """
    if viewers:
        return unique_chatters / viewers
    return (0.6 * unique_chatters + 0.4 * msgs_per_min) / FALLBACK_VIEWERS
