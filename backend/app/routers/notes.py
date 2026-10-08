from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..ai import engine, prompts
from ..common import MAX_SOURCE_CHARS, iso, owned
from ..ai.personal import complete_for
from ..database import get_db
from ..security import get_current_user

router = APIRouter(prefix="/api/notes", tags=["notes"])

PREVIEW_CHARS = 140


class NoteCreate(BaseModel):
    title: str = Field(default="", max_length=200)
    content: str = ""


class NoteUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    content: str | None = None
    pinned: bool | None = None


class NoteAction(BaseModel):
    action: str


def note_out(note: models.Note, detail: bool = False) -> dict:
    content = note.content or ""
    data = {
        "id": note.id,
        "title": note.title or "Untitled note",
        "preview": " ".join(content.split())[:PREVIEW_CHARS],
        "word_count": len(content.split()),
        "pinned": bool(note.pinned),
        "updated_at": iso(note.updated_at or note.created_at),
    }
    if detail:
        data["content"] = content
    return data


@router.get("")
def list_notes(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    notes = db.query(models.Note).filter(models.Note.user_id == user.id).all()
    notes.sort(key=lambda n: (bool(n.pinned), n.updated_at or n.created_at or datetime.min, n.id), reverse=True)
    return [note_out(n) for n in notes]


@router.post("", status_code=201)
def create_note(body: NoteCreate, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    note = models.Note(title=body.title.strip() or "Untitled note", content=body.content, user_id=user.id)
    db.add(note)
    db.commit()
    db.refresh(note)
    return note_out(note, detail=True)


@router.get("/{note_id}")
def get_note(note_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    return note_out(owned(db, models.Note, note_id, user, "Note"), detail=True)


@router.patch("/{note_id}")
def update_note(note_id: int, body: NoteUpdate, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    note = owned(db, models.Note, note_id, user, "Note")
    if body.title is not None:
        note.title = body.title.strip() or "Untitled note"
    if body.content is not None:
        note.content = body.content
    if body.pinned is not None:
        note.pinned = body.pinned
    db.commit()
    return note_out(note)


@router.delete("/{note_id}", status_code=204)
def delete_note(note_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(owned(db, models.Note, note_id, user, "Note"))
    db.commit()


@router.post("/{note_id}/ai")
def run_action(note_id: int, body: NoteAction, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Run one of the note AI tools and return the text; the note itself is not changed."""
    if body.action not in prompts.NOTE_ACTIONS:
        raise HTTPException(status_code=422, detail="Unknown AI action.")
    note = owned(db, models.Note, note_id, user, "Note")
    content = (note.content or "").strip()
    if not content:
        raise HTTPException(status_code=422, detail="This note is empty — write something first.")
    result = complete_for(user, 
        [
            {"role": "system", "content": "You are a study assistant. Reply in Markdown with only the requested result."},
            {"role": "user", "content": prompts.note_action(body.action, note.title or "", content[:MAX_SOURCE_CHARS])},
        ],
        temperature=0.4,
    )
    return {"text": result.text.strip(), "model": result.meta()}
