import json
from datetime import datetime, timezone

from tests.conftest import sign

CHAT_PAYLOAD = {
    "message_id": "kick-abc",
    "content": "hello world",
    "sender": {"user_id": 1, "username": "alice"},
    "broadcaster": {"user_id": 2, "username": "streamer"},
}


def webhook_headers(private_key, message_id, body: bytes,
                    event_type="chat.message.sent",
                    timestamp=None, signature=None):
    timestamp = timestamp or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "Kick-Event-Type": event_type,
        "Kick-Event-Version": "1",
        "Kick-Event-Message-Id": message_id,
        "Kick-Event-Message-Timestamp": timestamp,
        "Kick-Event-Signature": signature or sign(private_key, message_id, timestamp, body),
        "Content-Type": "application/json",
    }


async def test_valid_event_is_stored(client, app, rsa_keys):
    private_key, _ = rsa_keys
    body = json.dumps(CHAT_PAYLOAD).encode()
    resp = await client.post("/webhook", content=body,
                             headers=webhook_headers(private_key, "m-1", body))
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "duplicate": False}
    stored = app.state.store.query()
    assert len(stored) == 1
    assert stored[0].payload["content"] == "hello world"


async def test_duplicate_event_not_stored_twice(client, app, rsa_keys):
    private_key, _ = rsa_keys
    body = json.dumps(CHAT_PAYLOAD).encode()
    headers = webhook_headers(private_key, "m-dup", body)
    await client.post("/webhook", content=body, headers=headers)
    resp = await client.post("/webhook", content=body, headers=headers)
    assert resp.json() == {"status": "ok", "duplicate": True}
    assert app.state.store.stats()["events"] == 1


async def test_invalid_signature_rejected(client, app, rsa_keys):
    private_key, _ = rsa_keys
    body = json.dumps(CHAT_PAYLOAD).encode()
    headers = webhook_headers(private_key, "m-2", body)
    resp = await client.post("/webhook", content=b'{"tampered": true}', headers=headers)
    assert resp.status_code == 401
    assert app.state.store.stats()["events"] == 0


async def test_missing_headers_rejected(client):
    resp = await client.post("/webhook", content=b"{}")
    assert resp.status_code == 401


async def test_oversized_body_rejected(client, app, rsa_keys):
    private_key, _ = rsa_keys
    from easy_kick.routes.webhook import MAX_BODY_BYTES
    body = b'{"x":"' + b"a" * (MAX_BODY_BYTES + 1) + b'"}'
    resp = await client.post("/webhook", content=body,
                             headers=webhook_headers(private_key, "m-big", body))
    assert resp.status_code == 413
    assert app.state.store.stats()["events"] == 0


async def test_stale_timestamp_rejected(client, app, rsa_keys):
    private_key, _ = rsa_keys
    body = json.dumps(CHAT_PAYLOAD).encode()
    headers = webhook_headers(private_key, "m-stale", body, timestamp="2020-01-01T00:00:00Z")
    resp = await client.post("/webhook", content=body, headers=headers)
    assert resp.status_code == 401
    assert app.state.store.stats()["events"] == 0


async def test_malformed_payload_returns_200(client, app, rsa_keys):
    private_key, _ = rsa_keys
    body = b"this is not json"
    resp = await client.post("/webhook", content=body,
                             headers=webhook_headers(private_key, "m-3", body))
    assert resp.status_code == 200
    assert resp.json() == {"status": "ignored"}
    assert app.state.store.stats()["events"] == 0


async def test_no_key_and_no_kick_client_returns_503(rsa_keys):
    import httpx

    from easy_kick.config import Settings
    from easy_kick.main import create_app
    application = create_app(Settings(client_id="x"))
    application.state.kick = None
    private_key, _ = rsa_keys
    body = b"{}"
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        resp = await c.post("/webhook", content=body,
                            headers=webhook_headers(private_key, "m-4", body))
    assert resp.status_code == 503
