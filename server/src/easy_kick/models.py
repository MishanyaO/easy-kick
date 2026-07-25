from contextlib import suppress
from datetime import datetime, timezone
from enum import StrEnum
from functools import lru_cache

from pydantic import BaseModel


class EventType(StrEnum):
    """Kick webhook event names. The full set is what we subscribe to by default."""

    CHAT_MESSAGE_SENT = "chat.message.sent"
    CHANNEL_FOLLOWED = "channel.followed"
    SUBSCRIPTION_RENEWAL = "channel.subscription.renewal"
    SUBSCRIPTION_GIFTS = "channel.subscription.gifts"
    SUBSCRIPTION_NEW = "channel.subscription.new"
    REWARD_REDEMPTION_UPDATED = "channel.reward.redemption.updated"
    LIVESTREAM_STATUS_UPDATED = "livestream.status.updated"
    LIVESTREAM_METADATA_UPDATED = "livestream.metadata.updated"
    MODERATION_BANNED = "moderation.banned"
    KICKS_GIFTED = "kicks.gifted"


class ChatState(StrEnum):
    """How busy chat is relative to this channel's own rolling baseline."""

    LULL = "lull"
    STEADY = "steady"
    SPIKE = "spike"


class Arm(StrEnum):
    """An intervention the controller can choose. `NOTHING` is a real arm and is scored."""

    NOTHING = "nothing"
    EMOTE_RALLY = "emote_rally"
    CHAT_POLL = "chat_poll"
    QUESTION_RELAY = "question_relay"
    SHOUTOUT = "shoutout"
    PREDICTION = "prediction"


class Autonomy(StrEnum):
    """How much rope the streamer gives one arm."""

    AUTO = "auto"
    ASK = "ask"
    OFF = "off"


# What the bandit chooses between. `PREDICTION` stakes viewers' Channel Points, so it stays
# a manual card rather than an arm we explore.
BANDIT_ARMS = (Arm.NOTHING, Arm.EMOTE_RALLY, Arm.CHAT_POLL, Arm.QUESTION_RELAY, Arm.SHOUTOUT)


def parse_timestamp(timestamp: str) -> datetime | None:
    """Kick sends either an epoch or ISO-8601. None if the value is neither."""
    # OverflowError: an epoch far outside the range datetime can represent.
    with suppress(ValueError, OverflowError):
        return datetime.fromtimestamp(float(timestamp), tz=timezone.utc)
    with suppress(ValueError):
        return datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    return None


@lru_cache(maxsize=8192)
def _epoch(timestamp: str) -> float | None:
    # Cached: the engagement windows re-read the same events on every tick.
    moment = parse_timestamp(timestamp)
    return moment.timestamp() if moment else None


class EventEnvelope(BaseModel):
    # keep very simple for now
    type: str
    version: str
    message_id: str
    timestamp: str
    payload: dict

    def username(self, key: str) -> str | None:
        node = self.payload.get(key)
        return node.get("username") if isinstance(node, dict) else None

    def epoch(self) -> float | None:
        """Envelope time as a unix timestamp; None if unparseable."""
        return _epoch(self.timestamp)


class ChatEventOut(BaseModel):
    """A chat message in the shape the dashboard's `ChatEvent` type expects."""

    type: str = "chat"
    id: str
    ts: str
    username: str
    text: str
    emotes: list[str] = []
    is_sub: bool = False
    is_mod: bool = False

    @classmethod
    def from_envelope(cls, ev: EventEnvelope) -> "ChatEventOut":
        sender = ev.payload.get("sender") or {}
        identity = sender.get("identity") or {}
        badges = {b.get("type") for b in identity.get("badges") or [] if isinstance(b, dict)}
        emotes = ev.payload.get("emotes") or []
        return cls(
            id=ev.payload.get("message_id") or ev.message_id,
            ts=ev.timestamp,
            username=sender.get("username") or "anonymous",
            text=ev.payload.get("content") or "",
            emotes=[e.get("name", "") for e in emotes if isinstance(e, dict)],
            is_sub=bool(badges & {"subscriber", "founder"}),
            # Kick sends no separate mod badge for the channel owner, who is always a mod.
            is_mod=bool(badges & {"moderator", "broadcaster"}),
        )


class ChatMessageOut(BaseModel):
    message_id: str
    received_at: str
    broadcaster: str | None = None
    sender: str | None = None
    content: str | None = None

    @classmethod
    def from_envelope(cls, ev: EventEnvelope) -> "ChatMessageOut":
        return cls(
            message_id=ev.payload.get("message_id") or ev.message_id,
            received_at=ev.timestamp,
            broadcaster=ev.username("broadcaster"),
            sender=ev.username("sender"),
            content=ev.payload.get("content"),
        )
