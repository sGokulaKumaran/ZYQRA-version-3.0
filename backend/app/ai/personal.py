"""Each user's own choice of models.

Administrators curate the shared default list (ai_models.json). Any other
user may build a personal list from the providers the administrator has
connected; it is stored on their account and only affects them.
"""

from __future__ import annotations

import json

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models
from . import store
from .fallback import AIResult, ModelEntry, engine

MAX_MODELS = 60


def stored(user: models.User) -> list[dict] | None:
    """The user's saved list, or None when they use the default."""
    if user.is_admin or not user.ai_models:
        return None
    try:
        items = json.loads(user.ai_models)
    except ValueError:
        return None
    return items if isinstance(items, list) else None


def user_chain(user: models.User) -> list[ModelEntry] | None:
    """Chain entries for the user's own list; None means "use the default list"."""
    items = stored(user)
    return None if items is None else engine.build_chain(items)


def complete_for(user: models.User, messages: list[dict], **options) -> AIResult:
    return engine.complete(messages, chain=user_chain(user), **options)


# ─── Editing ───────────────────────────────────────────────────────────
def _editable(user: models.User) -> list[dict]:
    """The list to edit: the user's own, or a fresh copy of the default on first change."""
    items = stored(user)
    return engine.default_items() if items is None else [i for i in items if isinstance(i, dict)]


def _save(db: Session, user: models.User, items: list[dict]) -> None:
    user.ai_models = json.dumps(items)
    db.commit()


def _key(item: dict) -> str:
    return f"{item.get('provider')}:{item.get('model')}"


def _index(items: list[dict], model_id: str) -> int:
    for index, item in enumerate(items):
        if _key(item) == model_id:
            return index
    raise HTTPException(status_code=404, detail="That model is not in your list.")


def add(db: Session, user: models.User, provider: str, model: str) -> None:
    # Only models the provider really lists: a personal list can't be used to
    # reach arbitrary model ids on the administrator's key.
    info = engine.describe(provider, model)
    if not engine.is_ready(provider) or not info.get("chat"):
        raise HTTPException(status_code=400, detail="Choose a model from the provider's list.")
    items = _editable(user)
    if any(_key(i) == f"{provider}:{model}" for i in items):
        raise HTTPException(status_code=409, detail="That model is already in your list.")
    if len(items) >= MAX_MODELS:
        raise HTTPException(status_code=400, detail=f"A list can hold up to {MAX_MODELS} models.")
    items.append({"provider": provider, "model": model, "label": store.default_label(model, info.get("name", ""))})
    _save(db, user, items)


def update(db: Session, user: models.User, model_id: str, *, enabled: bool | None, label: str | None) -> None:
    items = _editable(user)
    item = items[_index(items, model_id)]
    if enabled is not None:
        item["enabled"] = enabled
    if label is not None and label.strip():
        item["label"] = label.strip()[:60]
    _save(db, user, items)


def remove(db: Session, user: models.User, model_id: str) -> None:
    items = _editable(user)
    del items[_index(items, model_id)]
    _save(db, user, items)


def reorder(db: Session, user: models.User, model_ids: list[str]) -> None:
    items = _editable(user)
    rank = {model_id: index for index, model_id in enumerate(model_ids)}
    items.sort(key=lambda item: rank.get(_key(item), len(rank)))
    _save(db, user, items)


def reset(db: Session, user: models.User) -> None:
    user.ai_models = None
    db.commit()
