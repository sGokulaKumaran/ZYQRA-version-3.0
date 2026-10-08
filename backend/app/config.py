"""Runtime settings, read once from the environment / backend/.env."""

from __future__ import annotations

import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BACKEND_DIR / ".env"

load_dotenv(ENV_FILE)


def _secret_key() -> str:
    key = os.getenv("SECRET_KEY", "").strip()
    if key:
        return key
    # No key configured: keep one on disk so tokens survive server restarts.
    path = BACKEND_DIR / ".secret_key"
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    key = secrets.token_urlsafe(48)
    path.write_text(key, encoding="utf-8")
    return key


def _csv(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


class Settings:
    app_name = "Zyqra API"

    secret_key: str = _secret_key()
    jwt_algorithm = "HS256"
    access_token_days: int = int(os.getenv("ACCESS_TOKEN_DAYS", "7"))

    database_url: str = os.getenv("DATABASE_URL", f"sqlite:///{(BACKEND_DIR / 'zyqra.db').as_posix()}")

    cors_origins: list[str] = _csv(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    )

    ai_models_file: Path = Path(os.getenv("AI_MODELS_FILE", str(BACKEND_DIR / "ai_models.json")))
    ai_timeout_seconds: float = float(os.getenv("AI_TIMEOUT_SECONDS", "45"))


settings = Settings()
