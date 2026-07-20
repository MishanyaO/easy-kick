import asyncio
from typing import AsyncIterator

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from ..models import ChatEventOut, ChatMessageOut

router = APIRouter()

# Kept below the 60s most proxies idle out at, so the connection stays warm.
KEEPALIVE_S = 20.0


@router.get("/health")
async def health(request: Request):
    return {"status": "ok", **request.app.state.store.stats()}


@router.get("/messages")
async def messages(request: Request, sender: str | None = None,
                   limit: int = Query(100, ge=1, le=1000)):
    events = request.app.state.store.query(event_type="chat.message.sent",
                                           sender=sender, limit=limit)
    return [ChatMessageOut.from_envelope(ev) for ev in events]


async def _chat_sse(request: Request, backlog: int) -> AsyncIterator[str]:
    store, hub = request.app.state.store, request.app.state.hub
    with hub.subscribe() as queue:
        # Replay before streaming so a reconnecting client is not left with an empty panel.
        # Subscribing first means anything arriving mid-replay queues up rather than being lost.
        for ev in reversed(store.query(event_type="chat.message.sent", limit=backlog)):
            yield f"data: {ChatEventOut.from_envelope(ev).model_dump_json()}\n\n"
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=KEEPALIVE_S)
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
                continue
            if event.type == "chat.message.sent":
                yield f"data: {ChatEventOut.from_envelope(event).model_dump_json()}\n\n"


@router.get("/stream")
async def stream(request: Request, backlog: int = Query(50, ge=0, le=1000)):
    """Live chat messages as Server-Sent Events, newest last."""
    return StreamingResponse(
        _chat_sse(request, backlog),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/events")
async def events(request: Request, type: str | None = None,
                 limit: int = Query(100, ge=1, le=1000)):
    return request.app.state.store.query(event_type=type, limit=limit)
