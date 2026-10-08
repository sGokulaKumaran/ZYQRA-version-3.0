from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..ai import engine, prompts
from ..ai.parsing import extract_json_array
from ..common import iso, owned, resolve_source
from ..ai.personal import complete_for
from ..database import get_db
from ..security import get_current_user

router = APIRouter(prefix="/api/quiz", tags=["quiz"])

Difficulty = Literal["Easy", "Medium", "Hard"]


class GenerateRequest(BaseModel):
    topic: str = Field(default="", max_length=300)
    count: int = Field(default=10, ge=1, le=30)
    difficulty: Difficulty = "Medium"
    note_id: int | None = None
    source_text: str = ""


class AnsweredQuestion(BaseModel):
    question: str
    options: list[str]
    answer: str
    explanation: str = ""
    user_answer: str = ""


class SessionCreate(BaseModel):
    topic: str = Field(default="", max_length=300)
    difficulty: Difficulty = "Medium"
    duration_seconds: int = Field(default=0, ge=0)
    questions: list[AnsweredQuestion] = Field(min_length=1, max_length=60)


class SessionUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=120)


def _clean_questions(raw: list) -> list[dict]:
    """Keep only well-formed questions and make `answer` match an option exactly."""
    questions = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        question = str(item.get("question", "")).strip()
        options = item.get("options")
        if not question or not isinstance(options, list):
            continue
        options = list(dict.fromkeys(str(o).strip() for o in options if str(o).strip()))
        if len(options) < 2:
            continue
        answer = str(item.get("answer", "")).strip()
        if answer not in options:
            # Models sometimes answer with a letter ("B") or differ only in case.
            by_case = {o.lower(): o for o in options}
            letter = answer.rstrip(".)").upper()
            if answer.lower() in by_case:
                answer = by_case[answer.lower()]
            elif len(letter) == 1 and 0 <= ord(letter) - 65 < len(options):
                answer = options[ord(letter) - 65]
            else:
                continue
        questions.append({
            "question": question,
            "options": options,
            "answer": answer,
            "explanation": str(item.get("explanation", "")).strip(),
        })
    return questions


def session_out(session: models.QuizSession, detail: bool = False) -> dict:
    data = {
        "id": session.id,
        "title": session.title or session.topic or "Quiz",
        "topic": session.topic or "",
        "difficulty": session.difficulty or "",
        "score": session.score or 0,
        "total": session.total or 0,
        "duration_seconds": session.duration_seconds or 0,
        "created_at": iso(session.created_at),
    }
    if detail:
        data["questions"] = [
            {
                "question": q.question,
                "options": json.loads(q.options) if q.options else [],
                "answer": q.answer,
                "explanation": q.explanation or "",
                "user_answer": q.user_answer or "",
                "is_correct": bool(q.is_correct),
            }
            for q in session.questions
        ]
    return data


@router.post("/generate")
def generate(body: GenerateRequest, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    source, source_title = resolve_source(db, user, body.note_id, body.source_text)
    topic = body.topic.strip() or source_title
    if not topic and not source:
        raise HTTPException(status_code=422, detail="Enter a topic or choose a note to build the quiz from.")
    topic = topic or "the study material provided"

    result = complete_for(
        user, "complex" if body.difficulty == "Hard" else "standard",
        [{"role": "user", "content": prompts.quiz(topic, body.count, body.difficulty, source)}],
        temperature=0.6,
    )
    questions = _clean_questions(extract_json_array(result.text))[: body.count]
    if not questions:
        raise HTTPException(status_code=502, detail="The AI returned an unusable quiz. Please try again.")
    return {"topic": topic, "questions": questions, "model": result.meta()}


@router.post("/sessions", status_code=201)
def save_session(body: SessionCreate, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    topic = body.topic.strip()
    session = models.QuizSession(
        title=f"{topic[:40] or 'Quiz'} · {body.difficulty}",
        topic=topic,
        difficulty=body.difficulty,
        total=len(body.questions),
        duration_seconds=body.duration_seconds,
        user_id=user.id,
    )
    score = 0
    for q in body.questions:
        chosen = q.user_answer.strip()
        correct = bool(chosen) and chosen == q.answer.strip()
        score += correct
        session.questions.append(models.QuizQuestion(
            question=q.question,
            options=json.dumps(q.options),
            answer=q.answer,
            explanation=q.explanation,
            user_answer=chosen,
            is_correct=correct,
        ))
    session.score = score
    db.add(session)
    db.commit()
    db.refresh(session)
    return session_out(session, detail=True)


@router.get("/sessions")
def list_sessions(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    sessions = (
        db.query(models.QuizSession)
        .filter(models.QuizSession.user_id == user.id)
        .order_by(models.QuizSession.id.desc())
        .all()
    )
    return [session_out(s) for s in sessions]


@router.get("/sessions/{session_id}")
def get_session(session_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    return session_out(owned(db, models.QuizSession, session_id, user, "Quiz"), detail=True)


@router.patch("/sessions/{session_id}")
def rename_session(session_id: int, body: SessionUpdate, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = owned(db, models.QuizSession, session_id, user, "Quiz")
    session.title = body.title.strip()
    db.commit()
    return session_out(session)


@router.delete("/sessions/{session_id}", status_code=204)
def delete_session(session_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(owned(db, models.QuizSession, session_id, user, "Quiz"))
    db.commit()
