"""Dev-only replay of a JSONL dataset into the event store."""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from ..config import PROJECT_ROOT
from ..hub import EventHub
from ..models import EventEnvelope, EventType
from ..store import EventStore

router = APIRouter(prefix="/dev", tags=["development"])
logger = logging.getLogger("kick.simulator")

DATASET = PROJECT_ROOT / "data" / "sample_stream.jsonl"


def _iso(moment: datetime) -> str:
    """Kick renders UTC timestamps with a 'Z' suffix rather than '+00:00'."""
    return moment.isoformat().replace("+00:00", "Z")


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


def _chat(row: DatasetRow, now: datetime) -> dict[str, object]:
    return {
        "message_id": str(uuid.uuid4()),
        "replies_to": None,
        "sender": _user(row.user, with_identity=True),
        "content": row.content,
        "emotes": [],
        "created_at": _iso(now),
    }


def _follow(row: DatasetRow, now: datetime) -> dict[str, object]:
    return {"follower": _user(row.user)}


def _subscription(row: DatasetRow, now: datetime) -> dict[str, object]:
    return {
        "subscriber": _user(row.user),
        "duration": row.duration,
        "created_at": _iso(now),
        "expires_at": _iso(now + timedelta(days=30 * row.duration)),
    }


def _kicks(row: DatasetRow, now: datetime) -> dict[str, object]:
    return {
        "sender": _user(row.user),
        "gift": {
            "amount": row.amount,
            "name": "Rage Quit",
            "type": "LEVEL_UP",
            "tier": "MID",
            "message": "",
            "pinned_time_seconds": 600,
        },
        "created_at": _iso(now),
    }


# The event types the simulator can replay — a subset of what we subscribe to.
PAYLOAD_BUILDERS: dict[EventType, Callable[[DatasetRow, datetime], dict[str, object]]] = {
    EventType.CHAT_MESSAGE_SENT: _chat,
    EventType.CHANNEL_FOLLOWED: _follow,
    EventType.SUBSCRIPTION_NEW: _subscription,
    EventType.SUBSCRIPTION_RENEWAL: _subscription,
    EventType.KICKS_GIFTED: _kicks,
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
    def check_type_is_supported(self) -> DatasetRow:
        if self.type not in PAYLOAD_BUILDERS:
            raise ValueError(f"the simulator cannot build {self.type} events")
        if self.type is EventType.CHAT_MESSAGE_SENT and not self.content:
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


def _build_event(row: DatasetRow) -> EventEnvelope:
    now = datetime.now(timezone.utc)
    return EventEnvelope(
        type=row.type.value,
        version="1",
        message_id=str(uuid.uuid4()),
        timestamp=_iso(now),
        payload={"broadcaster": _user(row.broadcaster), **PAYLOAD_BUILDERS[row.type](row, now)},
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
