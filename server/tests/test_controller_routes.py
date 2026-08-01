import asyncio
import json

import httpx

from easy_kick.config import Settings
from easy_kick.main import create_app
from easy_kick.models import BANDIT_ARMS, Arm, Autonomy, Mode


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


async def test_the_scenario_runs_through_the_gym_controls():
    app, client = dev_client()
    async with client:
        run_sheet = (await client.get("/dev/gym/scenario")).json()
        assert run_sheet["scenario"] == "ranked_run"
        assert len(run_sheet["ground_truth"]) == 12  # three states × four tactics

        started = await client.post(
            "/dev/gym", params={"mode": "scenario", "speed": 100, "seed": 7}
        )
        assert started.status_code == 200
        assert started.json()["mode"] == "scenario"
        assert started.json()["beat"] == "in queue"

        # The story runs through the dashboard's own controller, so it obeys its warmup,
        # cooldown and hourly caps — the first card is minutes of virtual time in, not
        # seconds. Wait on the thing being asserted rather than on a fixed budget.
        async def until(ready, tries: int = 2000) -> None:
            for _ in range(tries):
                if ready():
                    return
                await asyncio.sleep(0.01)

        frames = app.state.controller_history.snapshot
        await until(lambda: any(f["type"] == "action" for f in frames()))

        status = (await client.get("/dev/gym")).json()
        assert status["scenario"] == "ranked_run"
        assert status["decisions"] > 0
        assert any(f["type"] == "action" for f in frames())
        # The rails the dashboard sets are the rails the story runs under: `emote_rally`
        # defaults to `ask`, so its card stops for the streamer instead of auto-firing.
        card = next(f for f in frames() if f["type"] == "action")
        assert card["autonomy"] == Autonomy.ASK
        assert card["auto_fire"] is False
        # The scenario's evidence lands in the seeded, run-scoped table `stop` throws away.
        pulls = lambda: sum(cell.pulls for cell in app.state.bandit.cells.values())  # noqa: E731
        await until(lambda: pulls() > 0)
        assert pulls() > 0

        paused = await client.post("/dev/gym/pause")
        assert paused.json()["status"] == "paused"
        assert paused.json()["mode"] == "scenario"

        resumed = await client.post("/dev/gym")
        assert resumed.json()["status"] == "running"
        assert resumed.json()["mode"] == "scenario"
        assert (await client.delete("/dev/gym")).json()["status"] == "stopped"
        assert sum(cell.pulls for cell in app.state.bandit.cells.values()) == 0


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


async def test_prediction_can_be_disabled_but_never_auto_approved():
    app, client = dev_client()
    async with client:
        disabled = await client.put(
            "/controller/autonomy", json={"autonomy": {"prediction": "off"}}
        )
        forced_auto = await client.put(
            "/controller/autonomy", json={"autonomy": {"prediction": "auto"}}
        )

    assert disabled.status_code == 200
    assert app.state.controller.autonomy[Arm.PREDICTION] is Autonomy.OFF
    assert forced_auto.status_code == 422
    assert "requires streamer approval" in forced_auto.json()["detail"]


async def test_nothing_cannot_be_disabled_through_the_control_surface():
    app, client = dev_client()
    async with client:
        response = await client.put(
            "/controller/autonomy", json={"autonomy": {"nothing": "off"}}
        )

    assert response.status_code == 422


async def test_control_mutations_require_the_configured_key():
    app, client = dev_client(control_api_key="stage-secret")
    async with client:
        denied = await client.put("/controller/autonomy", json={"enabled": False})
        allowed = await client.put(
            "/controller/autonomy",
            json={"enabled": False},
            headers={"X-Control-Key": "stage-secret"},
        )

    assert denied.status_code == 401
    assert allowed.status_code == 200


async def test_mode_and_fire_rate_are_human_set_and_read_back():
    app, client = dev_client()
    async with client:
        response = await client.put("/controller/autonomy",
                                    json={"mode": "manual",
                                         "fire_rate": {"emote_rally": 2.0}})
        body = response.json()

    assert body["mode"] == Mode.MANUAL
    assert body["fire_rate"] == {"emote_rally": 2.0}
    assert app.state.controller.mode is Mode.MANUAL
    assert app.state.controller.fire_rate[Arm.EMOTE_RALLY] == 2.0


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


async def test_eval_results_rejects_a_stale_arm_set(monkeypatch, tmp_path):
    from easy_kick.routes import controller as controller_routes
    artifact = tmp_path / "eval.json"
    artifact.write_text(json.dumps({"config": {"arms": ["old_arm"]}}))
    monkeypatch.setattr(controller_routes, "EVAL_RESULTS", artifact)

    app, client = dev_client()
    async with client:
        response = await client.get("/eval/results")

    assert response.status_code == 409


async def test_live_post_activates_only_after_kick_confirms_delivery():
    from easy_kick.routes.controller import _post

    app, client = dev_client()
    confirmed = []

    async def send_chat(content, broadcaster_user_id):
        return {"data": {"is_sent": True}}

    app.state.kick.send_chat = send_chat
    app.state.controller.delivery_succeeded = (
        lambda action_id, now: confirmed.append(action_id)
    )
    async with client:
        await _post(app, "action-1", "hello")

    assert confirmed == ["action-1"]


async def test_live_post_fails_closed_without_kick_confirmation():
    from easy_kick.routes.controller import _post

    app, client = dev_client()
    failed = []

    async def send_chat(content, broadcaster_user_id):
        return {"data": {"is_sent": False}}

    app.state.kick.send_chat = send_chat
    app.state.controller.delivery_failed = (
        lambda action_id, reason: failed.append((action_id, reason))
    )
    async with client:
        await _post(app, "action-1", "hello")

    assert failed and failed[0][0] == "action-1"


def test_controller_frames_ride_the_existing_stream_as_their_own_payload():
    from easy_kick.controller import hub_publisher
    from easy_kick.controller_history import ControllerHistory
    from easy_kick.hub import EventHub
    from easy_kick.models import EventEnvelope, EventType
    from easy_kick.routes.read import _frame

    hub = EventHub()
    history = ControllerHistory()
    with hub.subscribe() as queue:
        hub_publisher(hub, history)(
            "controller.bandit", {"type": "bandit", "decisions": 3}
        )
        published = queue.get_nowait()

    controller_frame = json.loads(_frame(published).removeprefix("data: "))
    assert controller_frame["type"] == "bandit"
    assert controller_frame["decisions"] == 3
    assert controller_frame["seq"] == 1
    assert controller_frame["session_id"] == history.session_id
    # Chat still takes the existing path, and everything else is still dropped.
    chat = EventEnvelope(type=EventType.CHAT_MESSAGE_SENT, version="1", message_id="m1",
                         timestamp="2026-07-25T09:00:00Z",
                         payload={"sender": {"username": "ana"}, "content": "hi"})
    assert '"username":"ana"' in _frame(chat)
    assert _frame(EventEnvelope(type=EventType.MODERATION_BANNED, version="1",
                                message_id="m2", timestamp="2026-07-25T09:00:00Z",
                                payload={})) is None


def test_gym_reset_discards_history_and_notifies_open_streams():
    from easy_kick.controller import hub_publisher
    from easy_kick.routes.controller import _reset_shared_state

    app, _ = dev_client()
    publish = hub_publisher(app.state.hub, app.state.controller_history)
    publish("controller.context", {"type": "context"})
    old_session = app.state.controller_history.session_id

    with app.state.hub.subscribe() as queue:
        _reset_shared_state(app)
        reset_event = queue.get_nowait()

    frames = app.state.controller_history.snapshot()
    assert app.state.controller_history.session_id != old_session
    assert frames == [reset_event.payload]
    assert reset_event.payload["type"] == "reset"
    assert reset_event.payload["seq"] == 1
