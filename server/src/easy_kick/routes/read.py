import asyncio
import json
from typing import AsyncIterator

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from ..models import ChatEventOut, ChatMessageOut, EventEnvelope, EventType

router = APIRouter()

# Kept below the 60s most proxies idle out at, so the connection stays warm.
KEEPALIVE_S = 20.0
CONTROLLER_PREFIX = "controller."


def _frame(event: EventEnvelope) -> str | None:
    """One SSE frame, or None for an event the dashboard has no use for.

    Controller frames ride the same stream as synthetic event types whose payload is already
    the frontend shape, so they need no envelope of their own.
    """
    if event.type == EventType.CHAT_MESSAGE_SENT:
        return f"data: {ChatEventOut.from_envelope(event).model_dump_json()}\n\n"
    if event.type.startswith(CONTROLLER_PREFIX):
        return f"data: {json.dumps(event.payload)}\n\n"
    return None


@router.get("/health")
async def health(request: Request):
    app = request.app
    settings = app.state.settings
    return {
        "status": "ok",
        **app.state.store.stats(),
        "readiness": {
            "oauth_authorized": app.state.tokens.authorized,
            "webhook_key_loaded": app.state.verifier.has_key,
            "controller_enabled": settings.controller_enabled,
            "control_routes_protected": bool(settings.control_api_key),
            "channel_live": app.state.context.is_live,
        },
    }


@router.get("/messages")
async def messages(request: Request, sender: str | None = None,
                   limit: int = Query(100, ge=1, le=1000)):
    events = request.app.state.store.query(event_type=EventType.CHAT_MESSAGE_SENT,
                                           sender=sender, limit=limit)
    return [ChatMessageOut.from_envelope(ev) for ev in events]


async def _chat_sse(request: Request, backlog: int) -> AsyncIterator[str]:
    store, hub = request.app.state.store, request.app.state.hub
    history = request.app.state.controller_history
    with hub.subscribe() as queue:
        # Capture both backlogs after subscribing. Anything published from here onward is
        # queued, so hydration cannot leave a gap before live delivery begins.
        chat_backlog = reversed(
            store.query(event_type=EventType.CHAT_MESSAGE_SENT, limit=backlog)
        )
        # A `reset` means "discard the session you are holding". A subscriber that has just
        # connected is holding none — but it *is* holding the chat backlog we sent one line
        # above, and replaying the boundary marker threw that away, so every fresh tab
        # opened onto a running session showed an empty chat pane. Dropping it here is safe
        # in general: `ControllerHistory.reset()` clears the buffer, so the only reset that
        # can ever appear in a snapshot is the current session's own first frame.
        controller_backlog = [f for f in history.snapshot() if f.get("type") != "reset"]
        for ev in chat_backlog:
            yield f"data: {ChatEventOut.from_envelope(ev).model_dump_json()}\n\n"
        for frame in controller_backlog:
            yield f"data: {json.dumps(frame)}\n\n"
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=KEEPALIVE_S)
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
                continue
            if frame := _frame(event):
                yield frame


@router.get("/stream")
async def stream(request: Request, backlog: int = Query(50, ge=0, le=1000)):
    """Chat plus replayable controller frames as Server-Sent Events, newest last."""
    return StreamingResponse(
        _chat_sse(request, backlog),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/events")
async def events(request: Request, type: str | None = None,
                 limit: int = Query(100, ge=1, le=1000)):
    return request.app.state.store.query(event_type=type, limit=limit)
