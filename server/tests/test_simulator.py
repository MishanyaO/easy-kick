import asyncio
import json
import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from easy_kick.config import Settings
from easy_kick.main import create_app
from easy_kick.routes import simulator


def _dev_client(
    tmp_path: Path,
    rows: list[dict[str, Any]],
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[FastAPI, httpx.AsyncClient]:
    dataset = tmp_path / "replay.jsonl"
    dataset.write_text("\n".join(json.dumps(row) for row in rows), encoding="utf-8")
    app = create_app(Settings(simulator_enabled=True, buffer_size=50))
    monkeypatch.setattr(simulator, "DATASET", dataset)
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    )
    return app, client


async def test_replay_routes_are_disabled_when_simulator_is_off():
    app = create_app(Settings(simulator_enabled=False))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        assert (await client.get("/dev/replay")).status_code == 404


async def test_replay_emits_typed_kick_shaped_events(tmp_path, monkeypatch):
    rows = [
        {"delay_ms": 0, "type": "chat.message.sent", "user": "alice", "content": "hi"},
        {"delay_ms": 0, "type": "kicks.gifted", "user": "bob", "amount": 500},
    ]
    app, client = _dev_client(tmp_path, rows, monkeypatch)
    async with client:
        response = await client.post("/dev/replay", params={"speed": 100})
        assert response.status_code == 200

        for _ in range(20):
            if app.state.store.stats()["events"] == 2:
                break
            await asyncio.sleep(0)

        events = app.state.store.query()
        assert len(events) == 2
        assert events[0].payload["gift"]["amount"] == 500
        assert "amount" not in events[0].payload
        chat = events[1]
        assert chat.payload["message_id"] != chat.message_id
        uuid.UUID(chat.message_id)
        uuid.UUID(chat.payload["message_id"])
        assert set(chat.payload) == {
            "message_id",
            "replies_to",
            "broadcaster",
            "sender",
            "content",
            "emotes",
            "created_at",
        }
        assert set(chat.payload["sender"]) == {
            "is_anonymous",
            "user_id",
            "username",
            "is_verified",
            "profile_picture",
            "channel_slug",
            "identity",
        }
        assert chat.payload["sender"]["username"] == "alice"


async def test_replay_rejects_invalid_dataset_with_line_number(tmp_path, monkeypatch):
    app, client = _dev_client(
        tmp_path,
        [{"delay_ms": -1, "type": "chat.message.sent", "user": "alice", "content": "hi"}],
        monkeypatch,
    )
    async with client:
        response = await client.post("/dev/replay")

    assert response.status_code == 422
    assert "line 1" in response.json()["detail"]
    assert app.state.store.stats()["events"] == 0


async def test_only_one_replay_runs_and_it_can_be_stopped(tmp_path, monkeypatch):
    app, client = _dev_client(
        tmp_path,
        [{"delay_ms": 60_000, "type": "channel.followed", "user": "alice"}],
        monkeypatch,
    )
    async with client:
        assert (await client.post("/dev/replay", params={"loop": True})).status_code == 200
        assert (await client.post("/dev/replay")).status_code == 409

        stopped = await client.delete("/dev/replay")
        assert stopped.status_code == 200
        assert stopped.json()["status"] == "stopped"
        assert app.state.store.stats()["events"] == 0
