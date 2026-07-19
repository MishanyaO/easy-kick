import asyncio
import base64
import hashlib
import secrets
import time
from dataclasses import dataclass, field

import httpx

from .config import Settings

MAX_PENDING = 128


def generate_pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


@dataclass
class TokenStore:
    access_token: str | None = None
    refresh_token: str | None = None
    expires_at: float = 0.0
    pending: dict[str, str] = field(default_factory=dict)
    refresh_lock: asyncio.Lock = field(default_factory=asyncio.Lock, compare=False, repr=False)

    @property
    def authorized(self) -> bool:
        return self.access_token is not None

    def add_pending(self, state: str, verifier: str) -> None:
        if len(self.pending) >= MAX_PENDING:
            self.pending.pop(next(iter(self.pending)))  # drop oldest abandoned login
        self.pending[state] = verifier

    def store(self, token_response: dict) -> None:
        self.access_token = token_response["access_token"]
        # Refresh-grant responses may omit refresh_token (RFC 6749 §6); keep the old one.
        self.refresh_token = token_response.get("refresh_token") or self.refresh_token
        self.expires_at = time.time() + token_response.get("expires_in", 3600)


async def _request_token(http: httpx.AsyncClient, settings: Settings, **grant: str) -> dict:
    resp = await http.post(f"{settings.auth_base}/oauth/token", data={
        "client_id": settings.client_id,
        "client_secret": settings.client_secret,
        **grant,
    })
    resp.raise_for_status()
    return resp.json()


async def exchange_code(http: httpx.AsyncClient, settings: Settings,
                        code: str, verifier: str) -> dict:
    return await _request_token(http, settings, grant_type="authorization_code",
                                redirect_uri=settings.redirect_uri, code=code,
                                code_verifier=verifier)


async def refresh_tokens(http: httpx.AsyncClient, settings: Settings,
                         refresh_token: str) -> dict:
    return await _request_token(http, settings, grant_type="refresh_token",
                                refresh_token=refresh_token)


async def get_valid_token(http: httpx.AsyncClient, settings: Settings,
                          tokens: TokenStore) -> str | None:
    if tokens.access_token is None:
        return None
    if time.time() <= tokens.expires_at - 60:
        return tokens.access_token
    if tokens.refresh_token:
        async with tokens.refresh_lock:
            if time.time() > tokens.expires_at - 60:  # still stale after acquiring the lock
                tokens.store(await refresh_tokens(http, settings, tokens.refresh_token))
        return tokens.access_token
    # Cannot refresh: usable only while not yet actually expired.
    return tokens.access_token if time.time() < tokens.expires_at else None
