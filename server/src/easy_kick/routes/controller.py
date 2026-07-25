"""Controller control surface, and the dev-only gym that drives it on virtual time."""

import asyncio
import json
import logging
import time
from contextlib import suppress
from dataclasses import dataclass, field

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from ..config import PROJECT_ROOT
from ..controller import TICK_S, Controller
from ..gym import POLICIES, Gym, simulate
from ..models import Arm, Autonomy

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

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def status(self) -> dict:
        gym = self.gym
        return {
            "status": "running" if self.running else "idle",
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
        state.gym.fire(arm, chat_state)
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

    state.speed, state.seed = speed, seed
    state.gym = Gym(seed=seed, store=request.app.state.store, hub=request.app.state.hub)
    request.app.state.controller.perform = gym_fire(request.app, state)
    state.task = asyncio.create_task(_run_gym(request.app, state))
    logger.info("gym started: seed=%s speed=%s", seed, speed)
    return state.status()


@gym_router.get("")
async def gym_status(request: Request) -> dict:
    return request.app.state.gym.status()


@gym_router.delete("")
async def stop_gym(request: Request) -> dict:
    state: GymState = request.app.state.gym
    if not state.running:
        return state.status()
    state.task.cancel()
    with suppress(asyncio.CancelledError):
        await state.task
    return {**state.status(), "status": "stopped"}


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


@router.put("/controller/autonomy")
async def set_autonomy(body: AutonomyUpdate, request: Request) -> dict:
    controller: Controller = request.app.state.controller
    if body.autonomy:
        controller.autonomy.update(body.autonomy)
    if body.enabled is not None:
        controller.enabled = body.enabled
    return {"enabled": controller.enabled, "autonomy": controller.autonomy,
            "promotions": controller.promotions()}


@router.get("/eval/results")
async def eval_results() -> dict:
    """Whatever `python -m easy_kick.eval.run_eval` last wrote."""
    if not EVAL_RESULTS.exists():
        raise HTTPException(status_code=404, detail="run easy_kick.eval.run_eval first")
    return json.loads(EVAL_RESULTS.read_text(encoding="utf-8"))
