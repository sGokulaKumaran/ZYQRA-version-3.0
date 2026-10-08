from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..common import iso, local_day
from ..database import get_db
from ..models import utcnow
from ..security import get_current_user
from .planner import task_out
from .quiz import session_out

router = APIRouter(prefix="/api", tags=["dashboard"])

HEATMAP_DAYS = 119  # 17 weeks


class FocusLog(BaseModel):
    minutes: int = Field(ge=1, le=600)
    label: str = Field(default="", max_length=80)


@router.post("/focus/sessions", status_code=201)
def log_focus(body: FocusLog, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    session = models.FocusSession(minutes=body.minutes, label=body.label.strip(), user_id=user.id)
    db.add(session)
    db.commit()
    return {"id": session.id, "minutes": session.minutes}


def _streaks(active_days: set, today) -> tuple[int, int]:
    """(current, best). Today not being active yet does not break the current streak."""
    current, day = 0, today if today in active_days else today - timedelta(days=1)
    while day in active_days:
        current += 1
        day -= timedelta(days=1)
    best = run = 0
    previous = None
    for day in sorted(active_days):
        run = run + 1 if previous is not None and day - previous == timedelta(days=1) else 1
        best, previous = max(best, run), day
    return current, best


@router.get("/dashboard")
def dashboard(
    tz_offset: int = Query(default=0, ge=-840, le=840, description="JS Date.getTimezoneOffset() of the client"),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    now = utcnow()
    today = local_day(now, tz_offset)

    def mine(model):
        return db.query(model).filter(model.user_id == user.id)

    quizzes = mine(models.QuizSession).order_by(models.QuizSession.id).all()
    decks = mine(models.FlashcardDeck).all()
    notes = mine(models.Note).all()
    tasks = mine(models.Task).all()
    focus = mine(models.FocusSession).all()
    reviews = mine(models.CardReview).all()
    chat_count = mine(models.Chat).count()
    questions_asked = (
        db.query(models.Message)
        .join(models.Chat)
        .filter(models.Chat.user_id == user.id, models.Message.role == "user")
        .all()
    )

    # ── per-day activity (drives the heatmap and streaks) ────────────
    activity: dict = defaultdict(lambda: {"quizzes": 0, "reviews": 0, "focus_minutes": 0, "messages": 0})
    for q in quizzes:
        if q.created_at:
            activity[local_day(q.created_at, tz_offset)]["quizzes"] += 1
    for r in reviews:
        if r.created_at:
            activity[local_day(r.created_at, tz_offset)]["reviews"] += 1
    for f in focus:
        if f.created_at:
            activity[local_day(f.created_at, tz_offset)]["focus_minutes"] += f.minutes or 0
    for m in questions_asked:
        if m.created_at:
            activity[local_day(m.created_at, tz_offset)]["messages"] += 1

    def points(day_stats: dict) -> int:
        return (
            day_stats["quizzes"] * 5
            + day_stats["reviews"]
            + day_stats["focus_minutes"] // 5
            + day_stats["messages"]
        )

    current_streak, best_streak = _streaks(set(activity), today)
    heatmap = []
    for offset in range(HEATMAP_DAYS - 1, -1, -1):
        day = today - timedelta(days=offset)
        stats = activity.get(day)
        heatmap.append({"date": day.isoformat(), "points": points(stats) if stats else 0, **(stats or {})})

    week_start = today - timedelta(days=6)
    focus_today = activity[today]["focus_minutes"] if today in activity else 0
    focus_week = sum(s["focus_minutes"] for d, s in activity.items() if d >= week_start)

    # ── quiz analytics ───────────────────────────────────────────────
    total_questions = sum(q.total or 0 for q in quizzes)
    total_correct = sum(q.score or 0 for q in quizzes)

    def pct(score: int, total: int) -> int:
        return round(score / total * 100) if total else 0

    by_difficulty = {}
    for level in ("Easy", "Medium", "Hard"):
        group = [q for q in quizzes if q.difficulty == level]
        by_difficulty[level] = {
            "count": len(group),
            "accuracy": pct(sum(q.score or 0 for q in group), sum(q.total or 0 for q in group)),
        }

    topics: dict[str, dict] = {}
    for q in quizzes:
        name = (q.topic or "").strip()
        if not name:
            continue
        entry = topics.setdefault(name.lower(), {"topic": name, "count": 0, "score": 0, "total": 0})
        entry["count"] += 1
        entry["score"] += q.score or 0
        entry["total"] += q.total or 0
    topic_rows = [
        {"topic": t["topic"], "count": t["count"], "accuracy": pct(t["score"], t["total"])}
        for t in topics.values()
    ]

    # ── flashcards & tasks ───────────────────────────────────────────
    cards = [c for d in decks for c in d.cards]
    open_tasks = [t for t in tasks if not t.done]
    upcoming = sorted(
        (t for t in open_tasks if t.due_date is not None), key=lambda t: (t.due_date, t.id)
    )[:6]

    return {
        "streak": {"current": current_streak, "best": best_streak, "active_today": today in activity},
        "focus": {
            "today_minutes": focus_today,
            "week_minutes": focus_week,
            "total_minutes": sum(f.minutes or 0 for f in focus),
            "goal_minutes": user.daily_goal_minutes or 60,
        },
        "totals": {
            "quizzes": len(quizzes),
            "questions": total_questions,
            "correct": total_correct,
            "accuracy": pct(total_correct, total_questions),
            "decks": len(decks),
            "cards": len(cards),
            "cards_due": sum(1 for c in cards if c.due_at is not None and c.due_at <= now),
            "cards_new": sum(1 for c in cards if c.due_at is None),
            "reviews": len(reviews),
            "notes": len(notes),
            "note_words": sum(len((n.content or "").split()) for n in notes),
            "chats": chat_count,
            "tasks_open": len(open_tasks),
            "tasks_overdue": sum(1 for t in open_tasks if t.due_date is not None and t.due_date < today),
            "tasks_done": len(tasks) - len(open_tasks),
        },
        "heatmap": heatmap,
        "score_trend": [
            {"id": q.id, "title": q.title or q.topic or "Quiz", "accuracy": pct(q.score or 0, q.total or 0),
             "date": iso(q.created_at)}
            for q in quizzes[-12:]
        ],
        "by_difficulty": by_difficulty,
        "top_topics": sorted(topic_rows, key=lambda t: -t["count"])[:5],
        "weak_topics": sorted((t for t in topic_rows if t["accuracy"] < 70), key=lambda t: t["accuracy"])[:5],
        "upcoming_tasks": [task_out(t) for t in upcoming],
        "recent_quizzes": [session_out(q) for q in quizzes[-8:][::-1]],
    }
