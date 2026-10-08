from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..common import iso
from ..database import get_db
from ..security import create_access_token, get_current_user, hash_password, verify_password

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
    }


def _session(user: models.User) -> dict:
    return {"token": create_access_token(user.id), "user": user_out(user)}


def _username_taken(db: Session, username: str, except_id: int | None = None) -> bool:
    query = db.query(models.User).filter(func.lower(models.User.username) == username.lower())
    if except_id is not None:
        query = query.filter(models.User.id != except_id)
    return db.query(query.exists()).scalar()


@router.post("/register", status_code=201)
def register(body: Registration, db: Session = Depends(get_db)):
    if _username_taken(db, body.username):
        raise HTTPException(status_code=409, detail="That username is already taken.")
    user = models.User(username=body.username, password=hash_password(body.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return _session(user)


@router.post("/login")
def login(body: Credentials, db: Session = Depends(get_db)):
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
        if _username_taken(db, body.username, except_id=user.id):
            raise HTTPException(status_code=409, detail="That username is already taken.")
        user.username = body.username
    if body.daily_goal_minutes is not None:
        user.daily_goal_minutes = body.daily_goal_minutes
    db.commit()
    return user_out(user)


@router.post("/password", status_code=204)
def change_password(body: PasswordChange, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password):
        raise HTTPException(status_code=400, detail="Your current password is incorrect.")
    user.password = hash_password(body.new_password)
    db.commit()
