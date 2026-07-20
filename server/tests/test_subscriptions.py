import json

import httpx

from tests.conftest import authorize


async def test_create_subscriptions_requires_auth(client):
    resp = await client.post("/subscriptions", json={})
    assert resp.status_code == 409


async def test_create_subscriptions_posts_to_kick(client, app, mock_kick):
    authorize(app)
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["path"] = request.url.path
        captured["auth"] = request.headers.get("Authorization")
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"data": [{"subscription_id": "s1"}], "message": "ok"})

    mock_kick(handler)
    resp = await client.post("/subscriptions", json={"events": ["chat.message.sent"]})
    assert resp.status_code == 200
    assert captured["path"] == "/public/v1/events/subscriptions"
    assert captured["auth"] == "Bearer tok"
    assert captured["body"]["method"] == "webhook"
    assert captured["body"]["events"] == [{"name": "chat.message.sent", "version": 1}]


async def test_create_defaults_to_all_known_events(client, app, mock_kick):
    from easy_kick.models import EventType
    authorize(app)
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"data": [], "message": "ok"})

    mock_kick(handler)
    resp = await client.post("/subscriptions", json={"broadcaster_user_id": 123})
    assert resp.status_code == 200
    assert captured["body"]["broadcaster_user_id"] == 123
    assert [e["name"] for e in captured["body"]["events"]] == [e.value for e in EventType]


async def test_kick_error_passthrough(client, app, mock_kick):
    authorize(app)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"message": "forbidden"})

    mock_kick(handler)
    resp = await client.post("/subscriptions", json={})
    assert resp.status_code == 403


async def test_list_subscriptions(client, app, mock_kick):
    authorize(app)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        return httpx.Response(200, json={"data": [{"subscription_id": "s1"}]})

    mock_kick(handler)
    resp = await client.get("/subscriptions")
    assert resp.status_code == 200
    assert resp.json()["data"][0]["subscription_id"] == "s1"
