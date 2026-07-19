from pydantic import BaseModel

KNOWN_EVENTS = [
    "chat.message.sent",
    "channel.followed",
    "channel.subscription.renewal",
    "channel.subscription.gifts",
    "channel.subscription.new",
    "channel.reward.redemption.updated",
    "livestream.status.updated",
    "livestream.metadata.updated",
    "moderation.banned",
    "kicks.gifted",
]


class EventEnvelope(BaseModel):
    type: str
    version: str
    message_id: str
    timestamp: str
    payload: dict

    def username(self, key: str) -> str | None:
        node = self.payload.get(key)
        return node.get("username") if isinstance(node, dict) else None


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
