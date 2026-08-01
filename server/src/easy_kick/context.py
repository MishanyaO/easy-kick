"""Stream metadata: viewer count, category, uptime, and the optional audio gate.

Every field here is optional and every one of them may go stale. A failed poll leaves
`viewer_count` at None and `engagement.py` falls back to count-based normalisation.
"""

import asyncio
import logging
import time
from dataclasses import dataclass

from .models import parse_timestamp

logger = logging.getLogger("kick.context")

POLL_INTERVAL_S = 30.0
# A category switch is a regime change for chat: the baseline is meaningless for a while.
CATEGORY_TRANSITION_S = 60.0


@dataclass
class StreamContext:
    """What we know about the stream itself, refreshed by `poll_channel`."""

    viewer_count: int | None = None
    category: str | None = None
    stream_title: str | None = None
    started_at: float | None = None
    is_live: bool | None = None
    speaking: bool = False  # set by an optional audio provider; absent means no gate
    category_changed_at: float | None = None

    def apply(self, channel: dict, now: float) -> None:
        """Fold one `GET /channels` row in, noting a category change as a regime change."""
        stream = channel.get("stream") or {}
        self.is_live = bool(channel.get("is_live", stream))
        category = (channel.get("category") or {}).get("name")
        if category and self.category and category != self.category:
            self.category_changed_at = now
        self.category = category or self.category
        self.stream_title = channel.get("stream_title") or self.stream_title
        if "viewer_count" in stream:
            self.viewer_count = stream["viewer_count"]
        started = parse_timestamp(stream.get("start_time") or "")
        if started:
            self.started_at = started.timestamp()

    def in_transition(self, now: float) -> bool:
        return (self.category_changed_at is not None
                and now - self.category_changed_at < CATEGORY_TRANSITION_S)

    def uptime_s(self, now: float) -> float:
        """Chat at minute five is not chat at hour six."""
        return max(0.0, now - self.started_at) if self.started_at else 0.0

    def frame(self, now: float, participation: float, unique_chatters: int = 0,
              msgs_per_min: float = 0.0, actions_per_min: float = 0.0) -> dict:
        """The `controller.context` SSE payload."""
        return {
            "type": "context",
            "viewer_count": self.viewer_count,
            "category": self.category,
            "participation": participation,
            "unique_chatters": unique_chatters,
            "msgs_per_min": msgs_per_min,
            "actions_per_min": actions_per_min,
            "uptime_s": self.uptime_s(now),
            "streamer_speaking": self.speaking,
            "is_live": self.is_live,
        }


async def poll_channel(kick, context: StreamContext, broadcaster_user_id: int | None = None,
                       interval_s: float = POLL_INTERVAL_S) -> None:
    """Keep `context` fresh from `GET /channels`. Never raises: a dead poll only means we
    stop knowing the viewer count, and every consumer has a path for that."""
    while True:
        try:
            channels = await kick.get_channels(broadcaster_user_id)
            if channels:
                context.apply(channels[0], time.time())
            else:
                context.is_live = False
        except Exception:
            logger.warning("channel poll failed; viewer count unknown", exc_info=True)
            context.viewer_count = None
        await asyncio.sleep(interval_s)
