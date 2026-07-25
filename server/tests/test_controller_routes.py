import asyncio

import httpx

from easy_kick.config import Settings
from easy_kick.main import create_app
from easy_kick.models import BANDIT_ARMS, Arm, Autonomy


def dev_client(**overrides):
    app = create_app(Settings(simulator_enabled=True, buffer_size=500, **overrides))
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                               base_url="http://testserver")
    return app, client


async def test_gym_routes_are_disabled_when_the_simulator_is_off():
    app = create_app(Settings(simulator_enabled=False))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://testserver") as client:
        assert (await client.get("/dev/gym")).status_code == 404
        # The controller itself is always mounted; only the gym is dev-only.
        assert (await client.get("/controller/policy")).status_code == 200


async def test_a_running_gym_writes_chat_into_the_store():
    app, client = dev_client()
    async with client:
        assert (await client.post("/dev/gym", params={"speed": 100, "seed": 4})).status_code == 200
        assert (await client.post("/dev/gym")).status_code == 409  # only one at a time

        for _ in range(200):
            if app.state.store.stats()["events"] > 0:
                break
            await asyncio.sleep(0.01)

        status = (await client.get("/dev/gym")).json()
        assert status["status"] == "running"
        assert status["personas"] > 0
        assert app.state.store.stats()["events"] > 0

        stopped = await client.delete("/dev/gym")
        assert stopped.json()["status"] == "stopped"


async def test_a_speedrun_returns_scored_decisions_and_a_posterior_table():
    app, client = dev_client()
    async with client:
        response = await client.post("/dev/gym/speedrun", params={"decisions": 8, "seed": 2})

    body = response.json()
    assert response.status_code == 200
    assert len(body["results"]) == 8
    assert {p["arm"] for p in body["posteriors"]} == set(BANDIT_ARMS)


async def test_an_unknown_policy_is_rejected():
    app, client = dev_client()
    async with client:
        response = await client.post("/dev/gym/speedrun", params={"policy": "vibes"})
    assert response.status_code == 422


async def test_a_race_runs_one_world_per_policy_on_the_same_seed():
    app, client = dev_client()
    async with client:
        response = await client.post("/dev/gym/race",
                                     params={"seed": 1, "decisions": 6,
                                             "policies": "gambit,silent"})

    body = response.json()
    assert [run["policy"] for run in body["runs"]] == ["gambit", "silent"]
    assert all(run["seed"] == 1 for run in body["runs"])


async def test_autonomy_is_human_set_and_read_back():
    app, client = dev_client()
    async with client:
        response = await client.put("/controller/autonomy",
                                    json={"autonomy": {"chat_poll": "auto"}, "enabled": False})
        body = response.json()

    assert body["enabled"] is False
    assert body["autonomy"]["chat_poll"] == Autonomy.AUTO
    assert app.state.controller.autonomy[Arm.CHAT_POLL] is Autonomy.AUTO
    assert app.state.controller.enabled is False


async def test_acting_on_a_card_that_is_not_waiting_is_a_404():
    app, client = dev_client()
    async with client:
        assert (await client.post("/controller/action/nope/send")).status_code == 404
        assert (await client.post("/controller/action/nope/shrug")).status_code == 422


async def test_the_policy_table_reports_what_has_been_learned():
    app, client = dev_client()
    async with client:
        body = (await client.get("/controller/policy")).json()

    assert body["enabled"] is True
    assert len(body["posteriors"]) == 15  # 5 arms × 3 states
    assert body["insights"] == []  # nothing learned yet, and we do not pretend otherwise


async def test_eval_results_says_so_when_the_eval_has_not_been_run(monkeypatch, tmp_path):
    from easy_kick.routes import controller as controller_routes
    monkeypatch.setattr(controller_routes, "EVAL_RESULTS", tmp_path / "missing.json")

    app, client = dev_client()
    async with client:
        assert (await client.get("/eval/results")).status_code == 404


def test_controller_frames_ride_the_existing_stream_as_their_own_payload():
    from easy_kick.controller import hub_publisher
    from easy_kick.hub import EventHub
    from easy_kick.models import EventEnvelope, EventType
    from easy_kick.routes.read import _frame

    hub = EventHub()
    with hub.subscribe() as queue:
        hub_publisher(hub)("controller.bandit", {"type": "bandit", "decisions": 3})
        published = queue.get_nowait()

    assert _frame(published) == 'data: {"type": "bandit", "decisions": 3}\n\n'
    # Chat still takes the existing path, and everything else is still dropped.
    chat = EventEnvelope(type=EventType.CHAT_MESSAGE_SENT, version="1", message_id="m1",
                         timestamp="2026-07-25T09:00:00Z",
                         payload={"sender": {"username": "ana"}, "content": "hi"})
    assert '"username":"ana"' in _frame(chat)
    assert _frame(EventEnvelope(type=EventType.MODERATION_BANNED, version="1",
                                message_id="m2", timestamp="2026-07-25T09:00:00Z",
                                payload={})) is None
