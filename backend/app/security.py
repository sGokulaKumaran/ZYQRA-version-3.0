"""Password hashing, access tokens and the current-user dependency."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

import jwt
from dotenv import dotenv_values
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models
from .config import ENV_FILE, settings
from .database import get_db

log = logging.getLogger("zyqra.auth")

DEFAULT_ADMIN_USERNAME = "admin@zyqra.com"
MIN_ADMIN_PASSWORD = 8

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
_bearer = HTTPBearer(auto_error=False)

# bcrypt only reads the first 72 bytes; truncating keeps hashing well-defined.
_BCRYPT_MAX = 72


def hash_password(password: str) -> str:
    return _pwd.hash(password[:_BCRYPT_MAX])


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _pwd.verify(plain[:_BCRYPT_MAX], hashed)
    except ValueError:
        return False


def create_access_token(user_id: int) -> str:
    expires = datetime.now(timezone.utc) + timedelta(days=settings.access_token_days)
    return jwt.encode(
        {"sub": str(user_id), "exp": expires}, settings.secret_key, algorithm=settings.jwt_algorithm
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> models.User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Your session has expired. Please sign in again.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise unauthorized
    try:
        payload = jwt.decode(
            credentials.credentials, settings.secret_key, algorithms=[settings.jwt_algorithm]
        )
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise unauthorized
    user = db.get(models.User, user_id)
    if user is None:
        raise unauthorized
    return user


# ─── Administrators ────────────────────────────────────────────────────
def admin_credentials() -> tuple[str, str]:
    """(username, password) of the built-in administrator, read fresh from .env.

    Reading the file each time means a password typed into .env works on the
    next sign-in, without restarting the server.
    """
    values = dotenv_values(ENV_FILE) if ENV_FILE.exists() else os.environ
    username = (values.get("ADMIN_USERNAME") or "").strip() or DEFAULT_ADMIN_USERNAME
    return username, values.get("ADMIN_PASSWORD") or ""


def is_builtin_admin(user: models.User) -> bool:
    return (user.username or "").lower() == admin_credentials()[0].lower()


def sync_admin(db: Session) -> models.User | None:
    """Create the built-in administrator, or bring its password in line with .env."""
    username, password = admin_credentials()
    if len(password) < MIN_ADMIN_PASSWORD:
        if password:
            log.warning("ADMIN_PASSWORD is shorter than %d characters - ignored", MIN_ADMIN_PASSWORD)
        return None
    user = db.query(models.User).filter(func.lower(models.User.username) == username.lower()).first()
    if user is None:
        user = models.User(username=username, password=hash_password(password), is_admin=True)
        db.add(user)
        log.info("administrator account '%s' created", username)
    else:
        if not verify_password(password, user.password):
            user.password = hash_password(password)
        user.is_admin = True
    db.commit()
    return user


def require_admin(user: models.User = Depends(get_current_user)) -> models.User:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only an administrator can do that.")
    return user
