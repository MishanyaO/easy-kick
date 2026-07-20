import asyncio
from contextlib import contextmanager
from typing import Iterator

from .models import EventEnvelope

SUBSCRIBER_QUEUE_SIZE = 256


class EventHub:
    """Fan-out of live events to connected SSE clients.

    Publishing is synchronous and never blocks: a subscriber that cannot keep up
    loses its oldest queued events rather than stalling webhook ingestion.
    """

    def __init__(self, queue_size: int = SUBSCRIBER_QUEUE_SIZE):
        self._queue_size = queue_size
        self._subscribers: set[asyncio.Queue[EventEnvelope]] = set()

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    def publish(self, event: EventEnvelope) -> None:
        for queue in self._subscribers:
            if queue.full():
                queue.get_nowait()  # drop oldest; a slow client must not block ingest
            queue.put_nowait(event)

    @contextmanager
    def subscribe(self) -> Iterator[asyncio.Queue[EventEnvelope]]:
        queue: asyncio.Queue[EventEnvelope] = asyncio.Queue(maxsize=self._queue_size)
        self._subscribers.add(queue)
        try:
            yield queue
        finally:
            self._subscribers.discard(queue)
