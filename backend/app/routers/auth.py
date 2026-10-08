from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..common import iso
from ..database import get_db
from ..security import (
    admin_credentials, create_access_token, get_current_user, hash_password, is_builtin_admin,
    sync_admin, verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _clean_username(value: str) -> str:
    value = value.strip()
    if not 3 <= len(value) <= 32:
        raise ValueError("Username must be 3-32 characters long.")
    return value


class Credentials(BaseModel):
    username: str
    password: str


class Registration(Credentials):
    password: str = Field(min_length=6, max_length=128)

    @field_validator("username")
    @classmethod
    def _username(cls, value: str) -> str:
        return _clean_username(value)


class ProfileUpdate(BaseModel):
    username: str | None = None
    daily_goal_minutes: int | None = Field(default=None, ge=5, le=720)

    @field_validator("username")
    @classmethod
    def _username(cls, value: str | None) -> str | None:
        return None if value is None else _clean_username(value)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=128)


def user_out(user: models.User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "daily_goal_minutes": user.daily_goal_minutes or 60,
        "created_at": iso(user.created_at),
        "is_admin": bool(user.is_admin),
        # The account defined in .env: its name and password can't be changed in the app.
        "builtin_admin": bool(user.is_admin) and is_builtin_admin(user),
    }


def _session(user: models.User) -> dict:
    return {"token": create_access_token(user.id), "user": user_out(user)}


def _username_taken(db: Session, username: str, except_id: int | None = None) -> bool:
    query = db.query(models.User).filter(func.lower(models.User.username) == username.lower())
    if except_id is not None:
        query = query.filter(models.User.id != except_id)
    return db.query(query.exists()).scalar()


def registration_open(db: Session) -> bool:
    setting = db.get(models.Setting, "registration_open")
    return setting is None or setting.value != "0"


def _reserved(username: str) -> bool:
    """The administrator's name can only ever belong to the account made from .env."""
    return username.lower() == admin_credentials()[0].lower()


@router.get("/config")
def auth_config(db: Session = Depends(get_db)):
    """What the sign-in page needs to know before anyone is signed in."""
    return {"registration_open": registration_open(db)}


@router.post("/register", status_code=201)
def register(body: Registration, db: Session = Depends(get_db)):
    if not registration_open(db):
        raise HTTPException(status_code=403, detail="New sign-ups are closed. Ask the administrator for an account.")
    if _reserved(body.username) or _username_taken(db, body.username):
        raise HTTPException(status_code=409, detail="That username is already taken.")
    user = models.User(username=body.username, password=hash_password(body.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return _session(user)


@router.post("/login")
def login(body: Credentials, db: Session = Depends(get_db)):
    if _reserved(body.username.strip()):
        sync_admin(db)  # pick up a password just typed into .env
    user = db.query(models.User).filter(models.User.username == body.username.strip()).first()
    # One message for both cases so the form can't be used to probe for usernames.
    if user is None or not verify_password(body.password, user.password):
        raise HTTPException(status_code=401, detail="Incorrect username or password.")
    return _session(user)


@router.get("/me")
def me(user: models.User = Depends(get_current_user)):
    return user_out(user)


@router.patch("/me")
def update_me(body: ProfileUpdate, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.username is not None and body.username != user.username:
        if is_builtin_admin(user):
            raise HTTPException(status_code=400, detail="The administrator's username is set by ADMIN_USERNAME in backend/.env.")
        if _reserved(body.username) or _username_taken(db, body.username, except_id=user.id):
            raise HTTPException(status_code=409, detail="That username is already taken.")
        user.username = body.username
    if body.daily_goal_minutes is not None:
        user.daily_goal_minutes = body.daily_goal_minutes
    db.commit()
    return user_out(user)


@router.post("/password", status_code=204)
def change_password(body: PasswordChange, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    if is_builtin_admin(user):
        raise HTTPException(status_code=400, detail="The administrator's password is set by ADMIN_PASSWORD in backend/.env.")
    if not verify_password(body.current_password, user.password):
        raise HTTPException(status_code=400, detail="Your current password is incorrect.")
    user.password = hash_password(body.new_password)
    db.commit()
