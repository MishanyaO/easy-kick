"""Dev-only replay of a JSONL dataset into the event store."""

import asyncio
import logging
import uuid
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ..config import PROJECT_ROOT
from ..hub import EventHub
from ..models import EventEnvelope
from ..store import EventStore

router = APIRouter(prefix="/dev", tags=["development"])
logger = logging.getLogger("kick.simulator")

DATASET = PROJECT_ROOT / "data" / "sample_stream.jsonl"
EventType = Literal[
    "chat.message.sent",
    "channel.followed",
    "channel.subscription.new",
    "channel.subscription.renewal",
    "kicks.gifted",
]


@dataclass
class ReplayState:
    """The single in-flight replay, plus enough detail for a UI to render progress."""

    task: asyncio.Task[None] | None = field(default=None, repr=False)
    speed: float = 1.0
    loop: bool = False
    total: int = 0
    sent: int = 0

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def status(self) -> dict[str, object]:
        return {
            "status": "running" if self.running else "idle",
            "speed": self.speed,
            "loop": self.loop,
            "total": self.total,
            "sent": self.sent,
            "dataset": DATASET.name,
        }


class DatasetRow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    delay_ms: int = Field(default=500, ge=0)
    type: EventType
    user: str = Field(min_length=1)
    content: str | None = None
    broadcaster: str = Field(default="streamer", min_length=1)
    amount: int = Field(default=100, gt=0)
    duration: int = Field(default=1, ge=1)

    @model_validator(mode="after")
    def require_chat_content(self) -> "DatasetRow":
        if self.type == "chat.message.sent" and not self.content:
            raise ValueError("content is required for chat messages")
        return self


def _load_dataset(path: Path) -> list[DatasetRow]:
    rows: list[DatasetRow] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            rows.append(DatasetRow.model_validate_json(line))
        except ValidationError as exc:
            raise ValueError(f"invalid dataset row at line {line_number}: {exc}") from exc
    if not rows:
        raise ValueError("dataset contains no events")
    return rows


def _user(username: str, *, with_identity: bool = False) -> dict[str, object]:
    """Build the user object included in Kick webhook payloads."""
    user_id = uuid.uuid5(uuid.NAMESPACE_URL, f"kick.com/{username}").int % 2_000_000_000
    identity = None
    if with_identity:
        identity = {
            "username_color": f"#{user_id & 0xFFFFFF:06X}",
            "badges": [],
        }
    return {
        "is_anonymous": False,
        "user_id": user_id,
        "username": username,
        "is_verified": False,
        "profile_picture": "",
        "channel_slug": username.lower(),
        "identity": identity,
    }


def _build_event(row: DatasetRow) -> EventEnvelope:
    event_message_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    timestamp = now.isoformat().replace("+00:00", "Z")
    payload: dict[str, object] = {
        "broadcaster": _user(row.broadcaster),
    }

    if row.type == "chat.message.sent":
        payload.update(
            message_id=str(uuid.uuid4()),
            replies_to=None,
            sender=_user(row.user, with_identity=True),
            content=row.content,
            emotes=[],
            created_at=timestamp,
        )
    elif row.type == "channel.followed":
        payload["follower"] = _user(row.user)
    elif row.type in ("channel.subscription.new", "channel.subscription.renewal"):
        payload.update(
            subscriber=_user(row.user),
            duration=row.duration,
            created_at=timestamp,
            expires_at=(now + timedelta(days=30 * row.duration))
            .isoformat()
            .replace("+00:00", "Z"),
        )
    elif row.type == "kicks.gifted":
        payload.update(
            sender=_user(row.user),
            gift={
                "amount": row.amount,
                "name": "Rage Quit",
                "type": "LEVEL_UP",
                "tier": "MID",
                "message": "",
                "pinned_time_seconds": 600,
            },
            created_at=timestamp,
        )

    return EventEnvelope(
        type=row.type,
        version="1",
        message_id=event_message_id,
        timestamp=timestamp,
        payload=payload,
    )


async def _run(store: EventStore, hub: EventHub, rows: list[DatasetRow],
               state: ReplayState) -> None:
    while True:
        for row in rows:
            await asyncio.sleep(row.delay_ms / 1000 / state.speed)
            event = _build_event(row)
            # Same store-then-publish order as the webhook route, so replayed events
            # reach live SSE subscribers instead of only landing in the buffer.
            if store.add(event):
                hub.publish(event)
            state.sent += 1
            logger.info("event=%s user=%s content=%s", event.type, row.user, row.content or "")
        if not state.loop:
            return


def _replay_finished(task: asyncio.Task[None]) -> None:
    try:
        task.result()
    except asyncio.CancelledError:
        logger.info("replay stopped")
    except Exception:
        logger.exception("replay failed")
    else:
        logger.info("replay finished")


@router.post("/replay")
async def start_replay(
    request: Request,
    speed: float = Query(1.0, gt=0, le=100),
    loop: bool = False,
) -> dict[str, object]:
    """Start replaying the sample dataset in the background."""
    state: ReplayState = request.app.state.replay

    if state.running:
        raise HTTPException(status_code=409, detail="a replay is already running")
    if not DATASET.exists():
        raise HTTPException(status_code=404, detail=f"dataset not found: {DATASET}")

    try:
        rows = _load_dataset(DATASET)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    state.speed, state.loop, state.total, state.sent = speed, loop, len(rows), 0
    state.task = asyncio.create_task(
        _run(request.app.state.store, request.app.state.hub, rows, state))
    state.task.add_done_callback(_replay_finished)
    logger.info("replay started: events=%d speed=%s loop=%s", len(rows), speed, loop)
    return state.status()


@router.get("/replay")
async def replay_status(request: Request) -> dict[str, object]:
    """Current replay state — what a control panel polls."""
    return request.app.state.replay.status()


@router.delete("/replay")
async def stop_replay(request: Request) -> dict[str, object]:
    state: ReplayState = request.app.state.replay

    if not state.running:
        return state.status()
    state.task.cancel()
    with suppress(asyncio.CancelledError):
        await state.task
    # "stopped" rather than "idle": the caller cancelled a running replay.
    return {**state.status(), "status": "stopped"}
