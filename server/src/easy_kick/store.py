from collections import deque

from .models import EventEnvelope


class EventStore:
    """Bounded in-memory event buffer with message-id dedupe."""

    def __init__(self, maxlen: int = 10000):
        self._events: deque[EventEnvelope] = deque(maxlen=maxlen)
        self._seen_ids: set[str] = set()

    def add(self, event: EventEnvelope) -> bool:
        if event.message_id in self._seen_ids:
            return False
        if self._events.maxlen and len(self._events) == self._events.maxlen:
            self._seen_ids.discard(self._events[0].message_id)  # oldest, about to be evicted
        self._seen_ids.add(event.message_id)
        self._events.append(event)
        return True

    def query(self, event_type: str | None = None, sender: str | None = None,
              limit: int = 100) -> list[EventEnvelope]:
        results: list[EventEnvelope] = []
        for ev in reversed(self._events):
            if event_type and ev.type != event_type:
                continue
            if sender and ev.username("sender") != sender:
                continue
            results.append(ev)
            if len(results) >= limit:
                break
        return results

    def stats(self) -> dict:
        return {"events": len(self._events), "capacity": self._events.maxlen}
