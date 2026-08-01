"""Controller control surface, and the dev-only gym that drives it on virtual time."""

import asyncio
import json
import logging
import time
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel

from ..config import PROJECT_ROOT
from ..controller import TICK_S, Controller, build_stack, hub_publisher
from ..gym import POLICIES, Gym, simulate
from ..models import APPROVAL_ONLY_ARMS, BANDIT_ARMS, Arm, Autonomy, Mode
from ..scenario import DEFAULT_SEED, Scenario, catalogue
from ..security import require_control_key

router = APIRouter(tags=["controller"])
gym_router = APIRouter(prefix="/dev/gym", tags=["development"])
logger = logging.getLogger("kick.controller")

EVAL_RESULTS = PROJECT_ROOT / "data" / "eval_results.json"


@dataclass
class GymState:
    """The single in-flight gym, and enough detail for a control panel."""

    task: asyncio.Task[None] | None = field(default=None, repr=False)
    gym: Gym | Scenario | None = field(default=None, repr=False)
    speed: float = 1.0
    seed: int = 0
    mode: Literal["gym", "scenario"] = "gym"
    paused_at: float | None = field(default=None, repr=False)

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    @property
    def paused(self) -> bool:
        """Held onto its gym and metrics, just not ticking — a stopped one has neither."""
        return (
            self.gym is not None
            and not self.running
            and not getattr(self.gym, "completed", False)
        )

    def status(self) -> dict:
        gym = self.gym
        completed = bool(gym and getattr(gym, "completed", False))
        status = (
            "running" if self.running else "paused" if self.paused
            else "complete" if completed else "idle"
        )
        result = {
            "status": status,
            "mode": self.mode,
            "speed": self.speed,
            "seed": self.seed,
            "virtual_time_s": gym.t if gym else 0.0,
            "viewers": gym.viewers if gym else None,
            "personas": len(gym.personas) if gym else 0,
        }
        if isinstance(gym, Scenario):
            result.update(gym.status())
        return result


async def _run_gym(app, state: GymState) -> None:
    """Map virtual time onto wall time at `speed`×, ticking the controller as we go.

    The statistical gym measures on a five-second grid. Below 5×, stepping it once per
    `TICK_S` means a real second can pass between chat bursts — every persona's whole
    `TICK_S`-worth of Poisson-sampled lines lands in one lump. Capping the wall-clock
    sleep at 1s and stepping the gym by a correspondingly smaller `dt_s` spreads the same
    messages over more, smaller bursts without changing the total rate. The controller
    still ticks once per `TICK_S` of virtual time — its decision cadence (cooldowns,
    fire-rate math) is defined in terms of that constant and must not drift with the
    finer gym step.

    The prepared story is event-driven instead: it wakes at the exact next chat arrival,
    action, result, or measurement boundary rather than quantizing human messages onto a
    polling clock, and it publishes its own frames and drives its own actions — so the
    controller stays out of that loop entirely.
    """
    controller: Controller = app.state.controller
    if state.mode == "gym":
        # A frame before the first sleep, so the dashboard has an uptime to show
        # immediately rather than a dash for the first `TICK_S/speed` seconds. It cannot
        # decide anything this early — warmup gates that — so it costs nothing but the
        # frame.
        app.state.context.viewer_count = state.gym.viewers
        controller.tick(state.gym.now)
    virtual_since_tick = 0.0
    while True:
        if state.mode == "scenario":
            step_s = state.gym.next_due_in()
            await asyncio.sleep(step_s / state.speed)
            state.gym.step(step_s)
            if state.gym.completed:
                return
            if state.gym.hold:
                _hold(app, state)
                return
            continue
        wall_s = min(TICK_S / state.speed, 1.0)
        await asyncio.sleep(wall_s)
        dt_s = wall_s * state.speed
        state.gym.step(dt_s)
        app.state.context.viewer_count = state.gym.viewers
        virtual_since_tick += dt_s
        if virtual_since_tick >= TICK_S:
            virtual_since_tick -= TICK_S
            controller.tick(state.gym.now)


def _hold(app, state: GymState) -> None:
    """The story asked for the clock to stop, on a beat it wants looked at.

    Exactly a pause, and reached the same way one is — the gym, its metrics and its uptime
    are kept, and Start resumes it — so the only thing that makes this different from the
    streamer hitting the button is who pressed it. The frame tells the dashboard, which
    freezes the click map on the picture the hold was called for rather than letting it
    fade out while it is being talked about.
    """
    state.gym.hold = False  # consumed: resuming must not stop again on the same beat
    state.paused_at = time.time()
    hub_publisher(app.state.hub, app.state.controller_history)(
        "controller.hold", {"type": "hold", "reason": "click rally"}
    )
    logger.info("scenario held at t=%.1fs", state.gym.t)


def gym_fire(app, state: GymState):
    """In the gym the bot's line lands in chat like any other message, and the personas
    react to it. Live, the same callback posts through `chat:write`."""
    def fire(action_id: str, arm: Arm, chat_state, card) -> bool:
        state.gym.say(card.body)
        state.gym.fire(arm, chat_state, card.options)
        return True
    return fire


def live_fire(app):
    def fire(action_id: str, arm: Arm, chat_state, card) -> bool:
        asyncio.create_task(_post(app, action_id, card.body))
        return False  # confirmation arrives through the callback below
    return fire


async def _post(app, action_id: str, content: str) -> None:
    try:
        response = await app.state.kick.send_chat(
            content, app.state.settings.broadcaster_user_id
        )
        if not _is_sent(response):
            app.state.controller.delivery_failed(
                action_id, "Kick did not confirm that the message was sent"
            )
            return
    except Exception as exc:
        logger.warning("could not post to Kick chat", exc_info=True)
        app.state.controller.delivery_failed(action_id, str(exc))
        return
    app.state.controller.delivery_succeeded(action_id, time.time())


def _is_sent(response: dict) -> bool:
    """Kick has returned both object and one-row-list data shapes; fail closed."""
    data = response.get("data")
    rows = data if isinstance(data, list) else [data]
    return any(isinstance(row, dict) and row.get("is_sent") is True for row in rows)


@gym_router.post("")
async def start_gym(request: Request, speed: float = Query(1.0, gt=0, le=100),
                    seed: int | None = None,
                    mode: Literal["gym", "scenario"] = "gym") -> dict:
    state: GymState = request.app.state.gym
    # A prepared run without a seed means "play the one we prepared" — the seed is the
    # whole show, so there is a named default for it. The gym is a statistical harness and
    # has no such thing, hence 0.
    if seed is None:
        seed = DEFAULT_SEED if mode == "scenario" else 0
    if state.running:
        raise HTTPException(status_code=409, detail="a gym is already running")
    context = request.app.state.context

    if state.paused:
        # Resuming: keep the gym, its metrics, and "Time Live" — just shift
        # started_at forward by however long the pause lasted.
        if context.started_at is not None and state.paused_at is not None:
            context.started_at += time.time() - state.paused_at
        state.paused_at = None
    else:
        # A prepared run always starts clean (including its first run), while a completed
        # run remains inspectable until Replay or Stop.
        if state.gym is not None or mode == "scenario":
            _reset_shared_state(
                request.app, bandit_seed=seed if mode == "scenario" else None
            )
            context = request.app.state.context
        state.speed, state.seed, state.mode = speed, seed, mode
        if mode == "scenario":
            # The dashboard's own controller drives the story, so the rails on screen are
            # the rails it runs under: an arm left on `ask` raises an approval card,
            # `manual` hands firing to the sliders, and the kill switch stops it.
            state.gym = Scenario(
                seed=seed,
                store=request.app.state.store,
                hub=request.app.state.hub,
                bandit=request.app.state.bandit,
                context=context,
                controller=request.app.state.controller,
                publish=hub_publisher(
                    request.app.state.hub, request.app.state.controller_history
                ),
            )
        else:
            state.gym = Gym(
                seed=seed, store=request.app.state.store, hub=request.app.state.hub
            )
        context.started_at = time.time()
        context.is_live = True

    if state.mode == "gym":
        request.app.state.controller.perform = gym_fire(request.app, state)
    state.task = asyncio.create_task(_run_gym(request.app, state))
    logger.info("gym started: mode=%s seed=%s speed=%s", state.mode, seed, speed)
    return state.status()


@gym_router.get("")
async def gym_status(request: Request) -> dict:
    return request.app.state.gym.status()


@gym_router.get("/scenario")
async def scenario_catalogue() -> dict:
    """The complete prepared run sheet, including each expected visible outcome."""
    return catalogue()


@gym_router.patch("/speed")
async def set_gym_speed(request: Request, speed: float = Query(..., gt=0, le=100)) -> dict:
    """Change the tick rate in place. `_run_gym`'s loop re-reads `state.speed` on every
    iteration, so this takes effect on the very next tick — no restart needed."""
    state: GymState = request.app.state.gym
    if state.gym is None:
        raise HTTPException(status_code=409, detail="no gym to adjust")
    state.speed = speed
    logger.info("gym speed changed to %s", speed)
    return state.status()


@gym_router.post("/pause")
async def pause_gym(request: Request) -> dict:
    """Stop ticking without losing the gym, its metrics, or the elapsed uptime."""
    state: GymState = request.app.state.gym
    if not state.running:
        raise HTTPException(status_code=409, detail="gym is not running")
    state.task.cancel()
    with suppress(asyncio.CancelledError):
        await state.task
    state.task = None
    state.paused_at = time.time()
    logger.info("gym paused")
    return state.status()


@gym_router.delete("")
async def stop_gym(request: Request) -> dict:
    """Stop, and leave nothing behind: a gym run mutates shared, request-scoped state
    (the event store, the controller's rails and posteriors, the stream context) that
    `pause` deliberately preserves but a real stop must not — otherwise the next gym
    run, or a switch to live traffic, starts contaminated by synthetic history."""
    state: GymState = request.app.state.gym
    if state.running:
        state.task.cancel()
        with suppress(asyncio.CancelledError):
            await state.task
    state.task = None
    state.gym = None
    state.paused_at = None
    _reset_shared_state(request.app)
    logger.info("gym stopped")
    return {**state.status(), "status": "stopped"}


def _reset_shared_state(app, *, bandit_seed: int | None = None) -> None:
    """Rebuild everything the gym touches, the same way `create_app` builds it fresh.

    Everything *measured* has to go — store, posteriors, open window, context — or the next
    run starts contaminated. The human rails do not: `enabled`, the per-arm autonomy and the
    manual-mode fire rates are settings the streamer chose in Channel Actions, and wiping
    them on Start meant an Auto approve set before a run silently did nothing.
    """
    settings = app.state.settings
    previous = getattr(app.state, "controller", None)
    app.state.controller_history.reset()
    hub_publisher(app.state.hub, app.state.controller_history)(
        "controller.reset", {"type": "reset"}
    )
    build_stack(
        app,
        settings,
        perform=live_fire(app) if settings.controller_enabled else None,
        bandit_seed=bandit_seed,
    )
    if previous is not None:
        app.state.controller.adopt_rails(previous)


@gym_router.post("/speedrun")
async def speedrun(decisions: int = Query(200, ge=1, le=5000), seed: int = 0,
                   policy: str = "gambit", truth: bool = False) -> dict:
    """Headless run, flat out. This is how the posteriors get somewhere in demo time."""
    if policy not in POLICIES:
        raise HTTPException(status_code=422, detail=f"policy must be one of {POLICIES}")
    return await asyncio.to_thread(simulate, seed=seed, decisions=decisions, policy=policy,
                                   truth=truth)


@gym_router.post("/race")
async def race(seed: int = 0, decisions: int = Query(60, ge=1, le=2000),
               policies: str = "gambit,timer") -> dict:
    """Two worlds, one seed, same personas, same arc — one per policy.

    A demonstration of mechanism, not a measurement of magnitude. Say so out loud.
    """
    names = [p.strip() for p in policies.split(",") if p.strip()]
    if not all(name in POLICIES for name in names):
        raise HTTPException(status_code=422, detail=f"policies must be from {POLICIES}")
    runs = await asyncio.gather(*(
        asyncio.to_thread(simulate, seed=seed, decisions=decisions, policy=name)
        for name in names))
    return {"seed": seed, "runs": runs}


def _now(app) -> float:
    """A running gym owns the clock; otherwise it is wall time."""
    state: GymState | None = getattr(app.state, "gym", None)
    return state.gym.now if state and state.gym else time.time()


@router.get("/controller/policy")
async def policy(request: Request) -> dict:
    return request.app.state.controller.policy()


@router.post(
    "/controller/action/{action_id}/{verdict}",
    dependencies=[Depends(require_control_key)],
)
async def act_on_card(action_id: str, verdict: str, request: Request) -> dict:
    controller: Controller = request.app.state.controller
    if verdict not in ("send", "dismiss"):
        raise HTTPException(status_code=422, detail="verdict must be 'send' or 'dismiss'")
    handled = (controller.approve(action_id, _now(request.app)) if verdict == "send"
               else controller.dismiss(action_id))
    if not handled:
        raise HTTPException(status_code=404, detail="no card is waiting on that id")
    return {"status": verdict, "action_id": action_id}


class AutonomyUpdate(BaseModel):
    """Human-set rails. Never learned."""

    autonomy: dict[Arm, Autonomy] | None = None
    enabled: bool | None = None
    # Set before the stream starts. `manual`: `fire_rate` (fires/minute per arm) drives firing
    # directly, the bandit is never consulted. `auto`: `fire_rate` is ignored entirely.
    mode: Mode | None = None
    fire_rate: dict[Arm, float] | None = None


@router.put("/controller/autonomy", dependencies=[Depends(require_control_key)])
async def set_autonomy(body: AutonomyUpdate, request: Request) -> dict:
    controller: Controller = request.app.state.controller
    if body.autonomy:
        if body.autonomy.get(Arm.NOTHING, Autonomy.AUTO) is not Autonomy.AUTO:
            raise HTTPException(
                status_code=422,
                detail="'nothing' must stay enabled to preserve the control group",
            )
        forced_auto = [
            arm.value
            for arm in APPROVAL_ONLY_ARMS
            if body.autonomy.get(arm) is Autonomy.AUTO
        ]
        if forced_auto:
            raise HTTPException(
                status_code=422,
                detail=f"{', '.join(forced_auto)} always requires streamer approval",
            )
        controller.autonomy.update(body.autonomy)
    if body.enabled is not None:
        controller.enabled = body.enabled
    if body.mode is not None:
        controller.mode = body.mode
    if body.fire_rate:
        controller.fire_rate.update(body.fire_rate)
    return {"enabled": controller.enabled, "autonomy": controller.autonomy,
            "promotions": controller.promotions(),
            "mode": controller.mode, "fire_rate": controller.fire_rate}


@router.get("/eval/results")
async def eval_results() -> dict:
    """Whatever `python -m easy_kick.eval.run_eval` last wrote."""
    if not EVAL_RESULTS.exists():
        raise HTTPException(status_code=404, detail="run easy_kick.eval.run_eval first")
    result = json.loads(EVAL_RESULTS.read_text(encoding="utf-8"))
    expected = [arm.value for arm in BANDIT_ARMS]
    if result.get("config", {}).get("arms") != expected:
        raise HTTPException(
            status_code=409,
            detail="evaluation artifact is stale; regenerate it with the current arm set",
        )
    return result
