"""Small helpers shared by the routers."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import TypeVar

from fastapi import HTTPException
from sqlalchemy.orm import Session

from . import models

T = TypeVar("T")

# Longest study material passed to a model for "generate from my notes".
MAX_SOURCE_CHARS = 12000


def iso(value: datetime | date | None) -> str | None:
    """Serialize a naive-UTC datetime (or a date) for the client."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds") + "Z"
    return value.isoformat()


def owned(db: Session, model: type[T], item_id: int, user: models.User, name: str = "Item") -> T:
    """Fetch a row that belongs to `user`, or answer 404 (never reveal others' rows)."""
    item = db.get(model, item_id)
    if item is None or getattr(item, "user_id", None) != user.id:
        raise HTTPException(status_code=404, detail=f"{name} not found.")
    return item


def local_day(value: datetime, tz_offset_minutes: int) -> date:
    """The user's calendar day for a UTC timestamp (offset as JS getTimezoneOffset)."""
    return (value - timedelta(minutes=tz_offset_minutes)).date()


def resolve_source(db: Session, user: models.User, note_id: int | None, source_text: str) -> tuple[str, str]:
    """Study material for generation: (text, fallback_title) from a note or pasted text."""
    if note_id is not None:
        note = owned(db, models.Note, note_id, user, "Note")
        if not (note.content or "").strip():
            raise HTTPException(status_code=422, detail="That note is empty — add some content first.")
        return note.content[:MAX_SOURCE_CHARS], note.title or ""
    return source_text.strip()[:MAX_SOURCE_CHARS], ""
