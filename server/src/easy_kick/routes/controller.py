"""Controller control surface, and the dev-only gym that drives it on virtual time."""

import asyncio
import json
import logging
import time
from contextlib import suppress
from dataclasses import dataclass, field

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from ..bandit import Bandit
from ..config import PROJECT_ROOT
from ..context import StreamContext
from ..controller import TICK_S, Controller, hub_publisher
from ..engagement import EngagementMonitor
from ..gym import POLICIES, Gym, simulate
from ..models import Arm, Autonomy, Mode
from ..reward import RewardBook
from ..store import EventStore

router = APIRouter(tags=["controller"])
gym_router = APIRouter(prefix="/dev/gym", tags=["development"])
logger = logging.getLogger("kick.controller")

EVAL_RESULTS = PROJECT_ROOT / "data" / "eval_results.json"


@dataclass
class GymState:
    """The single in-flight gym, and enough detail for a control panel."""

    task: asyncio.Task[None] | None = field(default=None, repr=False)
    gym: Gym | None = field(default=None, repr=False)
    speed: float = 1.0
    seed: int = 0
    paused_at: float | None = field(default=None, repr=False)

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    @property
    def paused(self) -> bool:
        """Held onto its gym and metrics, just not ticking — a stopped one has neither."""
        return self.gym is not None and not self.running

    def status(self) -> dict:
        gym = self.gym
        status = "running" if self.running else "paused" if self.paused else "idle"
        return {
            "status": status,
            "speed": self.speed,
            "seed": self.seed,
            "virtual_time_s": gym.t if gym else 0.0,
            "viewers": gym.viewers if gym else None,
            "personas": len(gym.personas) if gym else 0,
        }


async def _run_gym(app, state: GymState) -> None:
    """Map virtual time onto wall time at `speed`×, ticking the controller as we go."""
    controller: Controller = app.state.controller
    while True:
        await asyncio.sleep(TICK_S / state.speed)
        state.gym.step(TICK_S)
        app.state.context.viewer_count = state.gym.viewers
        controller.tick(state.gym.now)


def gym_fire(app, state: GymState):
    """In the gym the bot's line lands in chat like any other message, and the personas
    react to it. Live, the same callback posts through `chat:write`."""
    def fire(arm: Arm, chat_state, card) -> None:
        state.gym.say(card.body)
        state.gym.fire(arm, chat_state, card.options)
    return fire


def live_fire(app):
    def fire(arm: Arm, chat_state, card) -> None:
        asyncio.create_task(_post(app, card.body))
    return fire


async def _post(app, content: str) -> None:
    try:
        await app.state.kick.send_chat(content, app.state.settings.broadcaster_user_id)
    except Exception:
        logger.warning("could not post to Kick chat", exc_info=True)


@gym_router.post("")
async def start_gym(request: Request, speed: float = Query(1.0, gt=0, le=100),
                    seed: int = 0) -> dict:
    state: GymState = request.app.state.gym
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
        state.speed, state.seed = speed, seed
        state.gym = Gym(seed=seed, store=request.app.state.store, hub=request.app.state.hub)
        context.started_at = time.time()

    request.app.state.controller.perform = gym_fire(request.app, state)
    state.task = asyncio.create_task(_run_gym(request.app, state))
    logger.info("gym started: seed=%s speed=%s", seed, speed)
    return state.status()


@gym_router.get("")
async def gym_status(request: Request) -> dict:
    return request.app.state.gym.status()


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


def _reset_shared_state(app) -> None:
    """Rebuild everything the gym touches, the same way `create_app` builds it fresh."""
    app.state.context = StreamContext()
    app.state.store = EventStore(maxlen=app.state.settings.buffer_size)
    app.state.bandit = Bandit()
    app.state.monitor = EngagementMonitor(app.state.store, app.state.context)
    app.state.controller = Controller(
        monitor=app.state.monitor,
        bandit=app.state.bandit,
        rewards=RewardBook(app.state.monitor),
        context=app.state.context,
        store=app.state.store,
        publish=hub_publisher(app.state.hub),
        perform=live_fire(app) if app.state.settings.controller_enabled else None,
    )


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
    return state.gym.now if state and state.running else time.time()


@router.get("/controller/policy")
async def policy(request: Request) -> dict:
    return request.app.state.controller.policy()


@router.post("/controller/action/{action_id}/{verdict}")
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


@router.put("/controller/autonomy")
async def set_autonomy(body: AutonomyUpdate, request: Request) -> dict:
    controller: Controller = request.app.state.controller
    if body.autonomy:
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
    return json.loads(EVAL_RESULTS.read_text(encoding="utf-8"))
