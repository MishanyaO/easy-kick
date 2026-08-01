import base64
import hashlib
from urllib.parse import parse_qs, urlparse

import httpx

from easy_kick.oauth import TokenStore, generate_pkce_pair, get_valid_token


def test_pkce_challenge_is_s256_of_verifier():
    verifier, challenge = generate_pkce_pair()
    expected = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    assert challenge == expected
    assert len(verifier) >= 43


def test_store_preserves_refresh_token_when_omitted():
    tokens = TokenStore()
    tokens.store({"access_token": "a1", "refresh_token": "r1", "expires_in": 3600})
    tokens.store({"access_token": "a2", "expires_in": 3600})  # refresh grant omits it
    assert tokens.access_token == "a2"
    assert tokens.refresh_token == "r1"


async def test_get_valid_token_none_when_expired_without_refresh():
    tokens = TokenStore(access_token="stale", expires_at=0.0)
    assert await get_valid_token(None, None, tokens) is None


async def test_login_redirects_to_kick(client, app):
    resp = await client.get("/auth/login")
    assert resp.status_code == 307
    url = urlparse(resp.headers["location"])
    q = parse_qs(url.query)
    assert url.netloc == "id.kick.com"
    assert url.path == "/oauth/authorize"
    assert q["response_type"] == ["code"]
    assert q["client_id"] == ["test-client"]
    assert q["code_challenge_method"] == ["S256"]
    scopes = set(q["scope"][0].split())
    assert {"user:read", "events:subscribe", "channel:read", "chat:write"} <= scopes
    assert q["state"][0] in app.state.tokens.pending


async def test_callback_exchanges_code(client, app, mock_kick):
    await client.get("/auth/login")
    state = next(iter(app.state.tokens.pending))

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/oauth/token"
        return httpx.Response(200, json={"access_token": "tok-123",
                                         "refresh_token": "ref-456",
                                         "expires_in": 3600})

    mock_kick(handler)

    resp = await client.get("/auth/callback", params={"code": "abc", "state": state})
    assert resp.status_code == 200
    assert app.state.tokens.access_token == "tok-123"
    status = await client.get("/auth/status")
    assert status.json() == {"authorized": True}


async def test_callback_rejects_unknown_state(client):
    resp = await client.get("/auth/callback", params={"code": "abc", "state": "bogus"})
    assert resp.status_code == 400
