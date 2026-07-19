from easy_kick.models import EventEnvelope


def seed(app):
    for i, (etype, sender) in enumerate([
        ("chat.message.sent", "alice"),
        ("chat.message.sent", "bob"),
        ("channel.followed", None),
    ]):
        payload = {"message_id": f"kick-{i}", "content": f"msg {i}"}
        if sender:
            payload["sender"] = {"user_id": i, "username": sender}
        app.state.store.add(EventEnvelope(type=etype, version="1", message_id=f"m-{i}",
                                          timestamp="2026-07-18T12:00:00Z", payload=payload))


async def test_messages_returns_chat_only_newest_first(client, app):
    seed(app)
    resp = await client.get("/messages")
    assert resp.status_code == 200
    data = resp.json()
    assert [m["sender"] for m in data] == ["bob", "alice"]
    assert data[0]["content"] == "msg 1"


async def test_messages_filter_by_sender_and_limit(client, app):
    seed(app)
    resp = await client.get("/messages", params={"sender": "alice", "limit": 1})
    data = resp.json()
    assert len(data) == 1
    assert data[0]["sender"] == "alice"


async def test_events_lists_all_types(client, app):
    seed(app)
    resp = await client.get("/events")
    assert len(resp.json()) == 3


async def test_events_filter_by_type(client, app):
    seed(app)
    resp = await client.get("/events", params={"type": "channel.followed"})
    data = resp.json()
    assert len(data) == 1
    assert data[0]["type"] == "channel.followed"
