from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..ai import AIError, AIResult, engine, prompts
from ..ai.personal import user_chain
from ..ai.routing import classify_messages
from ..common import iso, owned
from ..database import SessionLocal, get_db
from ..models import utcnow
from ..security import get_current_user

router = APIRouter(prefix="/api/chats", tags=["chat"])

HISTORY_MESSAGES = 24  # turns of context sent with each question
UNTITLED = {"new chat", ""}


class ChatCreate(BaseModel):
    title: str = "New chat"
    mode: str = prompts.DEFAULT_MODE


class ChatUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    mode: str | None = None
    pinned: bool | None = None


class Ask(BaseModel):
    content: str = Field(default="", max_length=20000)
    regenerate: bool = False
    model: str | None = None  # "provider:model" to prefer; None = best available


def chat_out(chat: models.Chat) -> dict:
    return {
        "id": chat.id,
        "title": chat.title or "New chat",
        "mode": chat.mode or prompts.DEFAULT_MODE,
        "pinned": bool(chat.pinned),
        "updated_at": iso(chat.updated_at or chat.created_at),
    }


def message_out(message: models.Message) -> dict:
    return {
        "id": message.id,
        "role": message.role,
        "content": message.content or "",
        "model": message.model,
        "provider": message.provider,
        "created_at": iso(message.created_at),
    }


def _valid_mode(mode: str | None) -> str:
    return mode if mode in prompts.CHAT_MODES else prompts.DEFAULT_MODE


@router.get("")
def list_chats(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    chats = db.query(models.Chat).filter(models.Chat.user_id == user.id).all()
    chats.sort(key=lambda c: (bool(c.pinned), c.updated_at or c.created_at or datetime.min, c.id), reverse=True)
    return [chat_out(c) for c in chats]


@router.post("", status_code=201)
def create_chat(body: ChatCreate, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    chat = models.Chat(title=body.title.strip() or "New chat", mode=_valid_mode(body.mode), user_id=user.id)
    db.add(chat)
    db.commit()
    db.refresh(chat)
    return chat_out(chat)


@router.patch("/{chat_id}")
def update_chat(chat_id: int, body: ChatUpdate, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    chat = owned(db, models.Chat, chat_id, user, "Chat")
    if body.title is not None:
        chat.title = body.title.strip()
    if body.mode is not None:
        chat.mode = _valid_mode(body.mode)
    if body.pinned is not None:
        chat.pinned = body.pinned
    db.commit()
    return chat_out(chat)


@router.delete("/{chat_id}", status_code=204)
def delete_chat(chat_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(owned(db, models.Chat, chat_id, user, "Chat"))
    db.commit()


@router.get("/{chat_id}/messages")
def list_messages(chat_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    chat = owned(db, models.Chat, chat_id, user, "Chat")
    return [message_out(m) for m in chat.messages]


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


@router.post("/{chat_id}/stream")
def ask(chat_id: int, body: Ask, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Answer the next turn as a server-sent event stream.

    Events: `user_message`, `meta` (which model is answering), `delta` (text),
    `error`, and finally `done` with the stored AI message.
    """
    chat = owned(db, models.Chat, chat_id, user, "Chat")

    user_message = None
    if body.regenerate:
        newest_first = (
            db.query(models.Message)
            .filter(models.Message.chat_id == chat.id)
            .order_by(models.Message.id.desc())
        )
        last = newest_first.first()
        if last is not None and last.role == "ai":
            db.delete(last)
            db.flush()
            last = newest_first.first()
        if last is None or last.role != "user":
            raise HTTPException(status_code=400, detail="There is no question to answer again.")
    else:
        content = body.content.strip()
        if not content:
            raise HTTPException(status_code=422, detail="Type a message first.")
        user_message = models.Message(role="user", content=content, chat_id=chat.id)
        db.add(user_message)
        if (chat.title or "").strip().lower() in UNTITLED:
            chat.title = " ".join(content.split())[:60]
    chat.updated_at = utcnow()
    db.commit()
    db.refresh(chat)

    history = [{"role": "system", "content": prompts.chat_system(chat.mode or prompts.DEFAULT_MODE)}]
    history += [
        {"role": "assistant" if m.role == "ai" else "user", "content": m.content or ""}
        for m in chat.messages[-HISTORY_MESSAGES:]
    ]
    opening = {
        "type": "user_message",
        "message": message_out(user_message) if user_message else None,
        "chat": chat_out(chat),
    }

    effort = classify_messages(history, chat.mode or prompts.DEFAULT_MODE)
    own_models = user_chain(user)  # read now: the request's session is gone once streaming starts

    def save(parts: list[str], answered_by: AIResult | None) -> dict | None:
        text = "".join(parts)
        if not text.strip():
            return None
        # The request's session is gone by the time the stream ends.
        with SessionLocal() as session:
            message = models.Message(
                role="ai",
                content=text,
                chat_id=chat_id,
                model=answered_by.label if answered_by else None,
                provider=answered_by.provider if answered_by else None,
            )
            session.add(message)
            session.query(models.Chat).filter(models.Chat.id == chat_id).update({"updated_at": utcnow()})
            session.commit()
            session.refresh(message)
            return message_out(message)

    def events():
        parts: list[str] = []
        answered_by: AIResult | None = None
        error = None
        yield _sse(opening)
        try:
            for item in engine.stream(history, prefer=body.model, chain=own_models, effort=effort):
                if isinstance(item, AIResult):
                    answered_by = item
                    yield _sse({"type": "meta", **item.meta()})
                else:
                    parts.append(item)
                    yield _sse({"type": "delta", "text": item})
        except AIError as exc:
            error = str(exc)
        except GeneratorExit:
            save(parts, answered_by)  # the user pressed Stop: keep what was written
            raise
        saved = save(parts, answered_by)
        if error:
            yield _sse({"type": "error", "message": error})
        yield _sse({"type": "done", "message": saved})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
