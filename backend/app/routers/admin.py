"""Administrator tools: the people using this installation and its sign-up policy."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..common import iso
from ..database import get_db
from ..security import hash_password, is_builtin_admin, require_admin
from .auth import registration_open

router = APIRouter(prefix="/api/admin", tags=["admin"])


class UserUpdate(BaseModel):
    is_admin: bool | None = None
    password: str | None = Field(default=None, min_length=6, max_length=128)


class AppSettings(BaseModel):
    registration_open: bool


def _counts(db: Session, model, column=None) -> dict[int, int]:
    """Rows per user for one table."""
    column = column if column is not None else model.user_id
    return dict(db.query(column, func.count(model.id)).group_by(column).all())


def _overview(db: Session) -> dict:
    chats = _counts(db, models.Chat)
    quizzes = _counts(db, models.QuizSession)
    notes = _counts(db, models.Note)
    decks = _counts(db, models.FlashcardDeck)
    focus = dict(
        db.query(models.FocusSession.user_id, func.coalesce(func.sum(models.FocusSession.minutes), 0))
        .group_by(models.FocusSession.user_id).all()
    )
    last_chat = dict(
        db.query(models.Chat.user_id, func.max(models.Chat.updated_at)).group_by(models.Chat.user_id).all()
    )
    users = db.query(models.User).order_by(models.User.id).all()
    return {
        "registration_open": registration_open(db),
        "totals": {
            "users": len(users),
            "admins": sum(1 for u in users if u.is_admin),
            "chats": sum(chats.values()),
            "messages": db.query(func.count(models.Message.id)).scalar() or 0,
            "quizzes": sum(quizzes.values()),
            "notes": sum(notes.values()),
            "decks": sum(decks.values()),
        },
        "users": [
            {
                "id": u.id,
                "username": u.username,
                "is_admin": bool(u.is_admin),
                "builtin": is_builtin_admin(u),
                "own_models": bool(u.ai_models) and not u.is_admin,
                "created_at": iso(u.created_at),
                "last_active_at": iso(last_chat.get(u.id)),
                "chats": chats.get(u.id, 0),
                "quizzes": quizzes.get(u.id, 0),
                "notes": notes.get(u.id, 0),
                "decks": decks.get(u.id, 0),
                "focus_minutes": int(focus.get(u.id, 0)),
            }
            for u in users
        ],
    }


def _target(db: Session, user_id: int, admin: models.User) -> models.User:
    user = db.get(models.User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found.")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="You can't change your own account here. Use Profile instead.")
    if is_builtin_admin(user):
        raise HTTPException(status_code=400, detail="The built-in administrator is managed from backend/.env.")
    return user


@router.get("/overview")
def overview(_: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    return _overview(db)


@router.put("/settings")
def update_settings(body: AppSettings, _: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    db.merge(models.Setting(key="registration_open", value="1" if body.registration_open else "0"))
    db.commit()
    return _overview(db)


@router.patch("/users/{user_id}")
def update_user(user_id: int, body: UserUpdate, admin: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    user = _target(db, user_id, admin)
    if body.is_admin is not None:
        user.is_admin = body.is_admin
    if body.password is not None:
        user.password = hash_password(body.password)
    db.commit()
    return _overview(db)


@router.delete("/users/{user_id}")
def delete_user(user_id: int, admin: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    """Remove an account together with everything it owns."""
    user = _target(db, user_id, admin)
    db.query(models.CardReview).filter(models.CardReview.user_id == user.id).delete()
    db.delete(user)
    db.commit()
    return _overview(db)
