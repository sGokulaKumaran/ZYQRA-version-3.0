"""AI engine status, and choosing providers and models from Settings.

Every signed-in user can browse the connected providers and build their own
list of models. Connecting a provider, storing its key and editing the default
list are for administrators only: they make the server call a URL and keep a
secret on everyone's behalf.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..ai import engine, personal, store
from ..ai.presets import PRESETS
from ..database import get_db
from ..security import get_current_user, require_admin

router = APIRouter(prefix="/api/ai", tags=["ai"])

FreeRule = Literal["auto", "all", "none"]


class ModelRef(BaseModel):
    id: str = Field(max_length=260)  # "provider:model"


class ProviderCreate(BaseModel):
    preset: str | None = Field(default=None, max_length=40)
    name: str = Field(default="", max_length=60)
    base_url: str = Field(default="", max_length=300)
    api_key: str = Field(default="", max_length=4000)
    free: FreeRule | None = None
    extras: dict[str, str] = Field(default_factory=dict)  # values for the provider's extra fields


class ProviderUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=60)
    base_url: str | None = Field(default=None, max_length=300)
    api_key: str | None = Field(default=None, max_length=4000)  # "" removes the key
    free: FreeRule | None = None
    extras: dict[str, str] = Field(default_factory=dict)  # values for the provider's extra fields


class ModelAdd(BaseModel):
    provider: str = Field(max_length=40)
    model: str = Field(max_length=200)
    label: str = Field(default="", max_length=60)


class ModelUpdate(ModelRef):
    enabled: bool | None = None
    label: str | None = Field(default=None, max_length=60)
    free: Literal["auto", "free", "paid"] | None = None
    tier: Literal["auto", "strong", "balanced", "light"] | None = None


class EngineSettings(BaseModel):
    free_only: bool


# ─── Helpers ───────────────────────────────────────────────────────────
def _apply(change, *args, **kwargs):
    """Run a configuration change, turning its errors into HTTP ones."""
    try:
        return change(*args, **kwargs)
    except store.ConfigError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc


def _status(user: models.User) -> dict:
    """The engine status as this user sees it: their own models, or the default list."""
    engine.reload()
    engine.discover()
    return engine.status(admin=bool(user.is_admin), source=personal.user_chain(user))


def _known_provider(provider_id: str) -> str:
    if not engine.has_provider(provider_id):
        raise HTTPException(status_code=404, detail="That provider is not set up.")
    return provider_id


# ─── Status ────────────────────────────────────────────────────────────
@router.get("/status")
def ai_status(refresh: bool = False, user: models.User = Depends(get_current_user)):
    """The user's models with their live state. `refresh` re-reads provider model lists."""
    engine.discover(force=refresh and bool(user.is_admin))
    return engine.status(admin=bool(user.is_admin), source=personal.user_chain(user))


@router.post("/test")
def ai_test(body: ModelRef, user: models.User = Depends(get_current_user)):
    return engine.test(body.id, personal.user_chain(user))


@router.put("/settings")
def update_settings(body: EngineSettings, admin: models.User = Depends(require_admin)):
    _apply(store.set_free_only, body.free_only)
    return _status(admin)


# ─── Providers ─────────────────────────────────────────────────────────
@router.get("/presets")
def list_presets(_: models.User = Depends(require_admin)):
    """Providers Zyqra already knows how to reach, for the "Add provider" list."""
    return [
        {
            "id": preset_id,
            "name": spec["name"],
            "base_url": spec["base_url"],
            "signup_url": spec.get("signup_url", ""),
            "free_tier": spec.get("free_tier", ""),
            "free": "some" if spec.get("free") == "auto" and spec.get("free_pattern") else spec.get("free", "auto"),
            "local": bool(spec.get("local")),
            "requires_key": bool(spec.get("requires_key", True)),
            "fields": [{"env": f["env"], "label": f.get("label", f["env"])} for f in spec.get("fields", [])],
            "added": engine.has_provider(preset_id),
        }
        for preset_id, spec in PRESETS.items()
    ]


@router.post("/providers", status_code=201)
def add_provider(body: ProviderCreate, admin: models.User = Depends(require_admin)):
    provider_id = _apply(
        store.add_provider,
        preset=body.preset, name=body.name, base_url=body.base_url,
        api_key=body.api_key, free=body.free, fields=body.extras,
    )
    engine.forget(provider_id)
    return {"id": provider_id, "status": _status(admin)}


@router.patch("/providers/{provider_id}")
def update_provider(provider_id: str, body: ProviderUpdate, admin: models.User = Depends(require_admin)):
    _apply(
        store.update_provider, provider_id,
        name=body.name, base_url=body.base_url, free=body.free, api_key=body.api_key, fields=body.extras,
    )
    if body.api_key is not None or body.base_url is not None or body.extras:
        engine.forget(provider_id)
    return _status(admin)


@router.delete("/providers/{provider_id}")
def remove_provider(provider_id: str, admin: models.User = Depends(require_admin)):
    _apply(store.remove_provider, provider_id)
    engine.forget(provider_id)
    return _status(admin)


@router.get("/providers/{provider_id}/models")
def provider_models(provider_id: str, refresh: bool = False, user: models.User = Depends(get_current_user)):
    """Every chat model the provider offers, each flagged free / already in the user's list."""
    _known_provider(provider_id)
    if not user.is_admin and not engine.is_ready(provider_id):
        raise HTTPException(status_code=404, detail="That provider is not connected yet.")
    return engine.provider_models(
        provider_id, refresh=refresh and bool(user.is_admin), chain=personal.user_chain(user),
    )


# ─── Models ────────────────────────────────────────────────────────────
# An administrator edits the default list everyone starts from; any other user
# edits their own list, which begins as a copy of the default.
@router.post("/models", status_code=201)
def add_model(body: ModelAdd, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    _known_provider(body.provider)
    model = body.model.strip()
    if user.is_admin:
        label = body.label or store.default_label(model, engine.describe(body.provider, model).get("name", ""))
        _apply(store.add_model, body.provider, model, label)
    else:
        personal.add(db, user, body.provider, model)
    return _status(user)


@router.patch("/models")
def update_model(body: ModelUpdate, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.is_admin:
        _apply(store.update_model, body.id, enabled=body.enabled, label=body.label, free=body.free, tier=body.tier)
    else:
        personal.update(db, user, body.id, enabled=body.enabled, label=body.label, tier=body.tier)
    return _status(user)


@router.post("/models/remove")
def remove_model(body: ModelRef, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.is_admin:
        _apply(store.remove_model, body.id)
    else:
        personal.remove(db, user, body.id)
    return _status(user)


@router.post("/models/reset")
def reset_models(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Drop the user's own list and go back to the default one."""
    personal.reset(db, user)
    return _status(user)
