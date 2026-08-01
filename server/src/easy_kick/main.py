import asyncio
import logging
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import Settings, get_settings
from .context import poll_channel
from .controller import build_stack
from .controller_history import ControllerHistory
from .hub import EventHub
from .kick_api import KickClient, NotAuthorizedError
from .oauth import TokenStore
from .routes import auth, controller, read, subscriptions, webhook
from .security import SignatureVerifier

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("kick")


@asynccontextmanager
async def _lifespan(app: FastAPI):
    try:
        app.state.verifier.set_key(await app.state.kick.fetch_public_key())
        app.state.key_fetched_at = time.monotonic()
    except Exception:
        logger.warning("could not preload Kick public key at startup", exc_info=True)

    tasks = []
    if app.state.settings.controller_enabled:
        from .controller import run as run_controller
        from .routes.controller import live_announce, live_fire
        app.state.controller.perform = live_fire(app)
        app.state.controller.announce = live_announce(app)
        tasks.append(asyncio.create_task(run_controller(app.state.controller)))
        tasks.append(asyncio.create_task(
            poll_channel(app.state.kick, app.state.context,
                         app.state.settings.broadcaster_user_id)))
    yield
    for task in tasks:
        task.cancel()
    await app.state.http.aclose()


async def _not_authorized_handler(request: Request, exc: NotAuthorizedError) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": str(exc)})


async def _upstream_error_handler(request: Request, exc: httpx.HTTPStatusError) -> JSONResponse:
    return JSONResponse(status_code=exc.response.status_code, content={"detail": exc.response.text})


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="easy-kick backend", lifespan=_lifespan)
    app.state.settings = settings
    app.state.hub = EventHub()
    app.state.controller_history = ControllerHistory()
    app.state.tokens = TokenStore()
    app.state.verifier = SignatureVerifier()
    app.state.http = httpx.AsyncClient(timeout=15.0)
    app.state.kick = KickClient(app.state.http, settings, app.state.tokens)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type", "X-Control-Key"],
    )
    app.add_exception_handler(NotAuthorizedError, _not_authorized_handler)
    app.add_exception_handler(httpx.HTTPStatusError, _upstream_error_handler)
    build_stack(app, settings)
    app.include_router(read.router)
    app.include_router(webhook.router)
    app.include_router(auth.router)
    app.include_router(subscriptions.router)
    app.include_router(controller.router)
    if settings.simulator_enabled:
        from .routes import simulator
        app.state.replay = simulator.ReplayState()
        app.state.gym = controller.GymState()
        app.include_router(simulator.router)
        app.include_router(controller.gym_router)
    return app


app = create_app()
