import json
import logging
import time
from datetime import datetime, timezone

from fastapi import APIRouter, FastAPI, HTTPException, Request

from ..models import EventEnvelope, parse_timestamp

router = APIRouter()
logger = logging.getLogger("kick.webhook")

MAX_BODY_BYTES = 512 * 1024
MAX_CLOCK_SKEW_S = 300
KEY_REFETCH_COOLDOWN_S = 60


async def load_public_key(app: FastAPI, *, force: bool = False) -> bool:
    """Ensure the signature verifier has Kick's public key. Returns True on success."""
    verifier = app.state.verifier
    if verifier.has_key and not force:
        return True
    kick = app.state.kick
    if kick is None:
        return False
    try:
        verifier.set_key(await kick.fetch_public_key())
    except Exception:
        logger.exception("failed to fetch Kick public key")
        return False
    app.state.key_fetched_at = time.monotonic()
    return True


def _timestamp_age(timestamp: str) -> float | None:
    """Seconds between now and a Kick event timestamp; None if unparseable."""
    sent = parse_timestamp(timestamp)
    if sent is None:
        return None
    return abs((datetime.now(timezone.utc) - sent).total_seconds())


@router.post("/webhook")
async def receive_webhook(request: Request):
    app = request.app
    content_length = request.headers.get("content-length", "")
    if content_length.isdigit() and int(content_length) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="payload too large")

    body = await request.body()
    if len(body) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="payload too large")

    headers = request.headers
    message_id = headers.get("kick-event-message-id")
    timestamp = headers.get("kick-event-message-timestamp")
    signature = headers.get("kick-event-signature")
    event_type = headers.get("kick-event-type")
    version = headers.get("kick-event-version", "1")

    if not (message_id and timestamp and signature and event_type):
        raise HTTPException(status_code=401, detail="missing webhook headers")

    age = _timestamp_age(timestamp)
    if age is None or age > MAX_CLOCK_SKEW_S:
        raise HTTPException(status_code=401, detail="stale or invalid timestamp")

    if not await load_public_key(app):
        raise HTTPException(status_code=503, detail="verification key unavailable")

    verifier = app.state.verifier
    if not verifier.verify(message_id, timestamp, body, signature):
        # The key may have rotated; refetch at most once per cooldown, then retry.
        since_fetch = time.monotonic() - getattr(app.state, "key_fetched_at", 0.0)
        refetched = since_fetch > KEY_REFETCH_COOLDOWN_S and await load_public_key(app, force=True)
        if not (refetched and verifier.verify(message_id, timestamp, body, signature)):
            raise HTTPException(status_code=401, detail="invalid signature")

    try:
        payload = json.loads(body)
        if not isinstance(payload, dict):
            raise ValueError("payload is not an object")
    except ValueError:
        logger.warning("authentic but malformed payload id=%s type=%s", message_id, event_type)
        return {"status": "ignored"}

    event = EventEnvelope(type=event_type, version=version, message_id=message_id,
                          timestamp=timestamp, payload=payload)
    added = app.state.store.add(event)
    if added:
        logger.info("event=%s id=%s%s", event_type, message_id, _summary(event))
        app.state.hub.publish(event)  # duplicates are never re-broadcast
    return {"status": "ok", "duplicate": not added}


def _summary(event: EventEnvelope) -> str:
    """Human-readable tail for the ingest log: sender and message text when present."""
    parts = []
    sender = event.username("sender")
    if sender:
        parts.append(f" sender={sender}")
    content = event.payload.get("content")
    if isinstance(content, str):
        text = content if len(content) <= 200 else content[:200] + "…"
        parts.append(f" text={text!r}")
    return "".join(parts)
