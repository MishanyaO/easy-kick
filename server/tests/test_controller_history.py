import json
from types import SimpleNamespace

from easy_kick.controller import hub_publisher
from easy_kick.controller_history import ControllerHistory
from easy_kick.hub import EventHub
from easy_kick.models import EventEnvelope, EventType
from easy_kick.routes.read import _chat_sse
from easy_kick.store import EventStore


def test_history_is_bounded_sequenced_and_resettable():
    history = ControllerHistory(maxlen=2)
    session_id = history.session_id

    history.record({"type": "context", "value": 1})
    history.record({"type": "context", "value": 2})
    history.record({"type": "context", "value": 3})

    assert [frame["seq"] for frame in history.snapshot()] == [2, 3]
    assert {frame["session_id"] for frame in history.snapshot()} == {session_id}

    history.reset()
    assert history.snapshot() == []
    assert history.session_id != session_id
    assert history.record({"type": "context"})["seq"] == 1


async def test_stream_replays_history_then_continues_with_live_frames():
    hub = EventHub()
    history = ControllerHistory()
    app = SimpleNamespace(
        state=SimpleNamespace(
            store=EventStore(),
            hub=hub,
            controller_history=history,
        )
    )
    publish = hub_publisher(hub, history)
    publish("controller.context", {"type": "context", "value": 1})

    stream = _chat_sse(SimpleNamespace(app=app), backlog=0)
    try:
        replayed = json.loads((await anext(stream)).removeprefix("data: "))
        publish("controller.context", {"type": "context", "value": 2})
        live = json.loads((await anext(stream)).removeprefix("data: "))
    finally:
        await stream.aclose()

    assert [replayed["seq"], live["seq"]] == [1, 2]
    assert replayed["session_id"] == live["session_id"]


async def test_replay_does_not_hand_a_new_subscriber_its_own_reset():
    """A replayed `reset` used to wipe the chat backlog sent alongside it.

    `reset` means "drop the session you are holding". The controller frames replay *after*
    the chat backlog, so obeying one during hydration threw away every message the same
    response had just delivered — which is why a tab opened onto a running session came up
    with an empty chat pane.
    """
    hub, history, store = EventHub(), ControllerHistory(), EventStore()
    store.add(EventEnvelope(
        type=EventType.CHAT_MESSAGE_SENT,
        version="1",
        message_id="m1",
        timestamp="2026-07-31T00:00:00Z",
        payload={"sender": {"username": "someone"}, "content": "hi"},
    ))
    app = SimpleNamespace(state=SimpleNamespace(store=store, hub=hub, controller_history=history))

    publish = hub_publisher(hub, history)
    publish("controller.reset", {"type": "reset"})
    publish("controller.context", {"type": "context", "value": 1})

    stream = _chat_sse(SimpleNamespace(app=app), backlog=10)
    try:
        replayed = [json.loads((await anext(stream)).removeprefix("data: ")) for _ in range(2)]
    finally:
        await stream.aclose()

    assert [frame["type"] for frame in replayed] == ["chat", "context"]
