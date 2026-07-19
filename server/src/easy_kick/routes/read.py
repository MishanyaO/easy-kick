from fastapi import APIRouter, Query, Request

from ..models import ChatMessageOut

router = APIRouter()


@router.get("/health")
async def health(request: Request):
    return {"status": "ok", **request.app.state.store.stats()}


@router.get("/messages")
async def messages(request: Request, sender: str | None = None,
                   limit: int = Query(100, ge=1, le=1000)):
    events = request.app.state.store.query(event_type="chat.message.sent",
                                           sender=sender, limit=limit)
    return [ChatMessageOut.from_envelope(ev) for ev in events]


@router.get("/events")
async def events(request: Request, type: str | None = None,
                 limit: int = Query(100, ge=1, le=1000)):
    return request.app.state.store.query(event_type=type, limit=limit)
