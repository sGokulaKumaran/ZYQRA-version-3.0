from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..ai import engine, prompts
from ..ai.parsing import extract_json_array
from ..common import iso, owned
from ..ai.personal import complete_for
from ..database import get_db
from ..models import utcnow
from ..security import get_current_user

router = APIRouter(prefix="/api/tasks", tags=["planner"])

Priority = Literal["low", "medium", "high"]
MAX_PLAN_TASKS = 30


class TaskBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    details: str = Field(default="", max_length=2000)
    subject: str = Field(default="", max_length=80)
    priority: Priority = "medium"
    due_date: date | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    details: str | None = Field(default=None, max_length=2000)
    subject: str | None = Field(default=None, max_length=80)
    priority: Priority | None = None
    due_date: date | None = None
    clear_due_date: bool = False
    done: bool | None = None


class BulkCreate(BaseModel):
    tasks: list[TaskBody] = Field(min_length=1, max_length=60)


class PlanRequest(BaseModel):
    goal: str = Field(min_length=3, max_length=500)
    start: date
    deadline: date
    hours_per_day: float = Field(default=2, gt=0, le=16)


def task_out(task: models.Task) -> dict:
    return {
        "id": task.id,
        "title": task.title,
        "details": task.details or "",
        "subject": task.subject or "",
        "priority": task.priority or "medium",
        "due_date": iso(task.due_date),
        "done": bool(task.done),
        "completed_at": iso(task.completed_at),
        "created_at": iso(task.created_at),
    }


def _new_task(body: TaskBody, user: models.User) -> models.Task:
    return models.Task(
        title=body.title.strip(),
        details=body.details.strip(),
        subject=body.subject.strip(),
        priority=body.priority,
        due_date=body.due_date,
        user_id=user.id,
    )


@router.get("")
def list_tasks(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    tasks = db.query(models.Task).filter(models.Task.user_id == user.id).order_by(models.Task.id).all()
    return [task_out(t) for t in tasks]


@router.post("", status_code=201)
def create_task(body: TaskBody, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = _new_task(body, user)
    db.add(task)
    db.commit()
    db.refresh(task)
    return task_out(task)


@router.post("/bulk", status_code=201)
def create_many(body: BulkCreate, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    tasks = [_new_task(item, user) for item in body.tasks]
    db.add_all(tasks)
    db.commit()
    return [task_out(t) for t in tasks]


@router.delete("/completed", status_code=204)
def clear_completed(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(models.Task).filter(models.Task.user_id == user.id, models.Task.done.is_(True)).delete()
    db.commit()


@router.patch("/{task_id}")
def update_task(task_id: int, body: TaskUpdate, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = owned(db, models.Task, task_id, user, "Task")
    if body.title is not None:
        task.title = body.title.strip()
    if body.details is not None:
        task.details = body.details.strip()
    if body.subject is not None:
        task.subject = body.subject.strip()
    if body.priority is not None:
        task.priority = body.priority
    if body.clear_due_date:
        task.due_date = None
    elif body.due_date is not None:
        task.due_date = body.due_date
    if body.done is not None and body.done != bool(task.done):
        task.done = body.done
        task.completed_at = utcnow() if body.done else None
    db.commit()
    return task_out(task)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(owned(db, models.Task, task_id, user, "Task"))
    db.commit()


@router.post("/plan")
def draft_plan(body: PlanRequest, user: models.User = Depends(get_current_user)):
    """Draft a study plan as a list of tasks. Nothing is saved until the client posts them to /bulk."""
    if body.deadline < body.start:
        raise HTTPException(status_code=422, detail="The deadline must be today or later.")
    days = (body.deadline - body.start).days + 1
    max_tasks = max(3, min(MAX_PLAN_TASKS, days * 2))

    result = complete_for(
        user, "standard",
        [{"role": "user", "content": prompts.study_plan(
            body.goal.strip(), body.start.isoformat(), body.deadline.isoformat(), body.hours_per_day, max_tasks
        )}],
        temperature=0.5,
    )
    tasks = []
    for item in extract_json_array(result.text)[:max_tasks]:
        if not isinstance(item, dict) or not str(item.get("title", "")).strip():
            continue
        try:
            due = date.fromisoformat(str(item.get("due_date", ""))[:10])
        except ValueError:
            due = body.deadline
        priority = str(item.get("priority", "medium")).lower()
        tasks.append({
            "title": str(item["title"]).strip()[:200],
            "details": str(item.get("details", "")).strip()[:2000],
            "subject": str(item.get("subject", "")).strip()[:80],
            "priority": priority if priority in ("low", "medium", "high") else "medium",
            "due_date": min(max(due, body.start), body.deadline).isoformat(),
        })
    if not tasks:
        raise HTTPException(status_code=502, detail="The AI returned an unusable plan. Please try again.")
    tasks.sort(key=lambda t: t["due_date"])
    return {"tasks": tasks, "model": result.meta()}
