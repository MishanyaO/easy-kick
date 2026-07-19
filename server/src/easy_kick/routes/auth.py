import secrets
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from ..oauth import exchange_code, generate_pkce_pair

router = APIRouter(prefix="/auth")

SCOPES = "user:read events:subscribe"


@router.get("/login")
async def login(request: Request):
    settings = request.app.state.settings
    tokens = request.app.state.tokens
    verifier, challenge = generate_pkce_pair()
    state = secrets.token_urlsafe(24)
    tokens.add_pending(state, verifier)
    params = urlencode({
        "response_type": "code",
        "client_id": settings.client_id,
        "redirect_uri": settings.redirect_uri,
        "scope": SCOPES,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
    })
    return RedirectResponse(f"{settings.auth_base}/oauth/authorize?{params}")


@router.get("/callback")
async def callback(request: Request, state: str, code: str | None = None,
                   error: str | None = None):
    tokens = request.app.state.tokens
    verifier = tokens.pending.pop(state, None)
    if verifier is None:
        raise HTTPException(status_code=400, detail="unknown or expired state")
    if error or code is None:
        raise HTTPException(status_code=400, detail=f"authorization failed: {error or 'no code'}")
    data = await exchange_code(request.app.state.http, request.app.state.settings,
                               code, verifier)
    tokens.store(data)
    return {"status": "authorized"}


@router.get("/status")
async def status(request: Request):
    return {"authorized": request.app.state.tokens.authorized}
