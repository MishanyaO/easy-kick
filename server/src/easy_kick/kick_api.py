import httpx

from .config import Settings
from .oauth import TokenStore, get_valid_token


class NotAuthorizedError(Exception):
    pass


class KickClient:
    """Thin async client for Kick's public v1 API."""

    def __init__(self, http: httpx.AsyncClient, settings: Settings, tokens: TokenStore):
        self._http = http
        self._settings = settings
        self._tokens = tokens

    async def _auth_headers(self) -> dict:
        token = await get_valid_token(self._http, self._settings, self._tokens)
        if token is None:
            raise NotAuthorizedError("no Kick user token; complete /auth/login first")
        return {"Authorization": f"Bearer {token}"}

    async def fetch_public_key(self) -> str:
        resp = await self._http.get(f"{self._settings.api_base}/public-key")
        resp.raise_for_status()
        return resp.json()["data"]["public_key"]

    async def list_subscriptions(self) -> dict:
        resp = await self._http.get(f"{self._settings.api_base}/events/subscriptions",
                                    headers=await self._auth_headers())
        resp.raise_for_status()
        return resp.json()

    async def create_subscriptions(self, event_names: list[str],
                                   broadcaster_user_id: int | None = None) -> dict:
        body: dict = {
            "events": [{"name": name, "version": 1} for name in event_names],
            "method": "webhook",
        }
        if broadcaster_user_id is not None:
            body["broadcaster_user_id"] = broadcaster_user_id
        resp = await self._http.post(f"{self._settings.api_base}/events/subscriptions",
                                     headers=await self._auth_headers(), json=body)
        resp.raise_for_status()
        return resp.json()

    async def delete_subscriptions(self, ids: list[str]) -> None:
        resp = await self._http.delete(f"{self._settings.api_base}/events/subscriptions",
                                       headers=await self._auth_headers(),
                                       params=[("id", i) for i in ids])
        resp.raise_for_status()
