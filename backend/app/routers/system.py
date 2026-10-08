"""AI engine status, app metadata and global search."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import __version__, models
from ..ai import engine, prompts
from ..database import get_db
from ..security import get_current_user

router = APIRouter(prefix="/api", tags=["system"])

SEARCH_LIMIT = 5


class ModelTest(BaseModel):
    id: str  # "provider:model"


@router.get("/health")
def health():
    return {"status": "ok", "version": __version__}


@router.get("/meta")
def meta(_: models.User = Depends(get_current_user)):
    return {
        "version": __version__,
        "chat_modes": [{"id": key, "label": m["label"], "hint": m["hint"]} for key, m in prompts.CHAT_MODES.items()],
        "note_actions": [{"id": key, "label": a["label"]} for key, a in prompts.NOTE_ACTIONS.items()],
    }


@router.get("/ai/status")
def ai_status(refresh: bool = False, _: models.User = Depends(get_current_user)):
    """The fallback chain with each model's live state. `refresh` re-reads provider model lists."""
    engine.discover(force=refresh)
    return engine.status()


@router.post("/ai/test")
def ai_test(body: ModelTest, _: models.User = Depends(get_current_user)):
    return engine.test(body.id)


@router.get("/search")
def search(q: str = Query(min_length=1, max_length=80), user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    like = f"%{q.strip()}%"

    def find(model, *columns):
        return (
            db.query(model)
            .filter(model.user_id == user.id, or_(*(c.ilike(like) for c in columns)))
            .order_by(model.id.desc())
            .limit(SEARCH_LIMIT)
            .all()
        )

    def snippet(text: str) -> str:
        text = " ".join((text or "").split())
        at = text.lower().find(q.strip().lower())
        start = max(0, at - 30) if at > 0 else 0
        return ("…" if start else "") + text[start : start + 90]

    results = [{"type": "chat", "id": c.id, "title": c.title or "New chat", "snippet": ""}
               for c in find(models.Chat, models.Chat.title)]
    results += [{"type": "note", "id": n.id, "title": n.title or "Untitled note", "snippet": snippet(n.content)}
                for n in find(models.Note, models.Note.title, models.Note.content)]
    results += [{"type": "deck", "id": d.id, "title": d.title or "Deck", "snippet": d.topic or ""}
                for d in find(models.FlashcardDeck, models.FlashcardDeck.title, models.FlashcardDeck.topic)]
    results += [{"type": "quiz", "id": s.id, "title": s.title or "Quiz", "snippet": f"{s.score}/{s.total}"}
                for s in find(models.QuizSession, models.QuizSession.title, models.QuizSession.topic)]
    results += [{"type": "task", "id": t.id, "title": t.title, "snippet": t.subject or ""}
                for t in find(models.Task, models.Task.title, models.Task.subject)]
    return {"results": results}
