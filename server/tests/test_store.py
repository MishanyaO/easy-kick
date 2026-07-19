from easy_kick.models import ChatMessageOut, EventEnvelope
from easy_kick.store import EventStore


def make_event(i: int, event_type: str = "chat.message.sent", sender: str = "alice") -> EventEnvelope:
    return EventEnvelope(
        type=event_type,
        version="1",
        message_id=f"msg-{i}",
        timestamp="2026-07-18T12:00:00Z",
        payload={"message_id": f"kick-{i}", "content": f"hello {i}",
                 "sender": {"user_id": 1, "username": sender},
                 "broadcaster": {"user_id": 2, "username": "streamer"}},
    )


def test_add_and_query_newest_first():
    store = EventStore(maxlen=10)
    for i in range(3):
        assert store.add(make_event(i)) is True
    result = store.query(limit=2)
    assert [e.message_id for e in result] == ["msg-2", "msg-1"]


def test_duplicate_message_id_rejected():
    store = EventStore(maxlen=10)
    assert store.add(make_event(1)) is True
    assert store.add(make_event(1)) is False
    assert store.stats()["events"] == 1


def test_ring_buffer_evicts_oldest():
    store = EventStore(maxlen=2)
    for i in range(3):
        store.add(make_event(i))
    ids = [e.message_id for e in store.query(limit=10)]
    assert ids == ["msg-2", "msg-1"]


def test_query_filters_by_type_and_sender():
    store = EventStore(maxlen=10)
    store.add(make_event(1, sender="alice"))
    store.add(make_event(2, sender="bob"))
    store.add(make_event(3, event_type="channel.followed"))
    assert [e.message_id for e in store.query(event_type="chat.message.sent", sender="bob")] == ["msg-2"]
    assert [e.message_id for e in store.query(event_type="channel.followed")] == ["msg-3"]


def test_chat_message_out_from_envelope():
    msg = ChatMessageOut.from_envelope(make_event(7))
    assert msg.sender == "alice"
    assert msg.broadcaster == "streamer"
    assert msg.content == "hello 7"
    assert msg.message_id == "kick-7"
