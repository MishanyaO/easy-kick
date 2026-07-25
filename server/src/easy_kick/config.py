from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# src/easy_kick/config.py -> parents[2] is the project root.
PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=PROJECT_ROOT / ".env", env_prefix="KICK_")

    client_id: str = ""
    client_secret: str = ""
    redirect_uri: str = "http://localhost:8000/auth/callback"
    public_base_url: str = "http://localhost:8000"
    api_base: str = "https://api.kick.com/public/v1"
    auth_base: str = "https://id.kick.com"
    buffer_size: int = 10000
    simulator_enabled: bool = False
    # The controller's decision loop against live Kick traffic. In simulator mode the gym
    # drives the same loop on virtual time instead, so only one of the two ticks it.
    controller_enabled: bool = False
    broadcaster_user_id: int | None = None
    # Browser origins allowed to call the read API (the Vite dev server by default).
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]


@lru_cache
def get_settings() -> Settings:
    return Settings()
