from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

from ..models import KNOWN_EVENTS

router = APIRouter()


class SubscribeRequest(BaseModel):
    broadcaster_user_id: int | None = None
    events: list[str] | None = None


@router.post("/subscriptions")
async def create_subscriptions(body: SubscribeRequest, request: Request):
    return await request.app.state.kick.create_subscriptions(
        body.events or KNOWN_EVENTS, body.broadcaster_user_id)


@router.get("/subscriptions")
async def list_subscriptions(request: Request):
    return await request.app.state.kick.list_subscriptions()


@router.delete("/subscriptions")
async def delete_subscriptions(request: Request, id: list[str] = Query(...)):
    await request.app.state.kick.delete_subscriptions(id)
    return {"status": "deleted", "ids": id}
