"""Edits to ai_models.json and to the API keys in .env made from Settings.

The engine only ever reads those two files; everything that changes them
goes through here so the rules live in one place:
  - API keys are written to .env and nowhere else, and are never read back out.
  - A provider URL typed in Settings must be a plain http(s) endpoint.
"""

from __future__ import annotations

import ipaddress
import json
import os
import re
import threading
from collections.abc import Callable
from urllib.parse import urlsplit

from dotenv import set_key, unset_key

from ..config import ENV_FILE, settings
from .presets import PRESETS

_lock = threading.Lock()

_ENV_NAME = re.compile(r"[A-Z][A-Z0-9_]{2,63}")
# Variables the app itself depends on; a provider may never claim one of these.
_RESERVED_ENV = {
    "SECRET_KEY", "DATABASE_URL", "CORS_ORIGINS", "ACCESS_TOKEN_DAYS", "ADMIN_USERNAME", "ADMIN_PASSWORD",
    "AI_MODELS_FILE", "AI_TIMEOUT_SECONDS", "ZYQRA_ENV_FILE", "PATH", "HOME", "USERNAME",
}
_URL_TAILS = ("/chat/completions", "/completions", "/models")


class ConfigError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# ─── File access ───────────────────────────────────────────────────────
def _read() -> dict:
    try:
        data = json.loads(settings.ai_models_file.read_text(encoding="utf-8"))
        if not isinstance(data.get("providers"), dict) or not isinstance(data.get("chain"), list):
            raise ValueError("missing providers / chain")
    except (OSError, ValueError, AttributeError) as exc:
        name = settings.ai_models_file.name
        raise ConfigError(f"{name} could not be read ({exc}). Fix the file, then try again.", 500) from exc
    return data


def _dump(data: dict) -> str:
    """Pretty JSON with one model per line, so the chain stays easy to read."""
    head = {key: value for key, value in data.items() if key != "chain"}
    text = json.dumps(head, indent=2, ensure_ascii=False)
    lines = ",\n".join("    " + json.dumps(item, ensure_ascii=False) for item in data["chain"])
    return f'{text[:-2]},\n  "chain": [\n{lines}\n  ]\n}}\n'


def _update(change: Callable[[dict], object]):
    """Apply `change` to the configuration and save it atomically."""
    with _lock:
        data = _read()
        result = change(data)
        path = settings.ai_models_file
        scratch = path.with_suffix(path.suffix + ".tmp")
        scratch.write_text(_dump(data), encoding="utf-8")
        os.replace(scratch, path)
        return result


# ─── Validation ────────────────────────────────────────────────────────
def _is_local_host(host: str) -> bool:
    if host == "localhost" or host.endswith((".local", ".lan", ".localhost")) or "." not in host:
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return address.is_loopback or address.is_private


def clean_url(url: str) -> str:
    """Normalise a provider URL typed by a person; reject anything unsafe."""
    url = url.strip()
    if url and "://" not in url:
        host = url.split("/", 1)[0].rsplit(":", 1)[0]
        url = f"{'http' if _is_local_host(host) else 'https'}://{url}"
    url = url.rstrip("/")
    for tail in _URL_TAILS:  # people paste the full endpoint
        url = url.removesuffix(tail)
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ConfigError("Enter the provider's API URL, for example https://api.example.com/v1")
    if any(ch in url for ch in "{}\\@ \t\r\n") or parts.query or parts.fragment:
        raise ConfigError("The URL contains characters that are not allowed in a provider address.")
    if parts.scheme == "http" and not _is_local_host(parts.hostname):
        raise ConfigError("Use https:// for a provider on the internet, so your API key is not sent in the clear.")
    return url


def is_local_url(url: str) -> bool:
    return _is_local_host(urlsplit(url).hostname or "")


def _clean_secret(value: str, what: str = "API key") -> str:
    value = ",".join(part.strip() for part in value.split(",") if part.strip())
    if not value:
        raise ConfigError(f"Enter the {what}.")
    if re.search(r"[\s'\"\\#]", value) or len(value) > 4000:
        raise ConfigError(f"That doesn't look like a valid {what}.")
    return value


def _env_name(name: str) -> str:
    if not _ENV_NAME.fullmatch(name) or name in _RESERVED_ENV:
        raise ConfigError(f"'{name}' can't be used as a key variable name.")
    return name


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:28]


def _provider(data: dict, provider_id: str) -> dict:
    spec = data["providers"].get(provider_id)
    if spec is None:
        raise ConfigError("That provider is not set up.", 404)
    return spec


def _entry(data: dict, model_id: str) -> dict:
    for item in data["chain"]:
        if f"{item['provider']}:{item['model']}" == model_id:
            return item
    raise ConfigError("That model is not in your list.", 404)


def _resolved(provider_id: str, spec: dict) -> dict:
    """A provider's spec with its preset's values filled in."""
    preset = {} if spec.get("custom") else PRESETS.get(spec.get("preset", provider_id), {})
    return {**preset, **spec}


# ─── .env ──────────────────────────────────────────────────────────────
def _set_env(name: str, value: str) -> None:
    ENV_FILE.touch(exist_ok=True)
    set_key(str(ENV_FILE), _env_name(name), value, quote_mode="never")
    os.environ[name] = value


def _unset_env(name: str) -> None:
    if ENV_FILE.exists():
        unset_key(str(ENV_FILE), _env_name(name))
    os.environ.pop(name, None)


def _apply_secrets(provider_id: str, spec: dict, api_key: str | None, fields: dict[str, str]) -> None:
    """Store a provider's key (None = leave as is, "" = remove) and extra values."""
    resolved = _resolved(provider_id, spec)
    if api_key is not None:
        if api_key.strip():
            _set_env(resolved["key_env"], _clean_secret(api_key))
        else:
            _unset_env(resolved["key_env"])
    allowed = {f["env"]: f.get("label", f["env"]) for f in resolved.get("fields", [])}
    for name, value in fields.items():
        if name not in allowed:
            raise ConfigError("That setting does not belong to this provider.")
        if value.strip():
            _set_env(name, _clean_secret(value, allowed[name]))
        else:
            _unset_env(name)


# ─── Providers ─────────────────────────────────────────────────────────
def add_provider(*, preset: str | None, name: str, base_url: str, api_key: str,
                 free: str | None, fields: dict[str, str]) -> str:
    def change(data: dict) -> str:
        providers = data["providers"]
        if preset:
            if preset not in PRESETS:
                raise ConfigError("Unknown provider.", 404)
            if preset in providers:
                raise ConfigError(f"{PRESETS[preset]['name']} is already added.", 409)
            source = PRESETS[preset]
            # Enough to read the file on its own; the rest comes from the preset.
            providers[preset] = {key: source[key] for key in ("name", "base_url", "key_env")}
            return preset

        label = " ".join(name.split())
        if not 2 <= len(label) <= 40:
            raise ConfigError("Give the provider a name (2-40 characters).")
        url = clean_url(base_url)
        slug = _slug(label)
        if not slug:
            raise ConfigError("Use letters or numbers in the provider name.")
        taken_envs = {_resolved(pid, spec).get("key_env") for pid, spec in providers.items()}
        provider_id, n = slug, 2
        while (provider_id in providers or provider_id in PRESETS
               or f"{provider_id.upper().replace('-', '_')}_API_KEY" in taken_envs):
            provider_id, n = f"{slug}-{n}", n + 1
        local = is_local_url(url)
        providers[provider_id] = {
            "name": label,
            "base_url": url,
            "key_env": _env_name(f"{provider_id.upper().replace('-', '_')}_API_KEY"),
            "custom": True,
            "free": free or ("all" if local else "auto"),
            **({"local": True, "requires_key": False} if local else {}),
        }
        return provider_id

    with_key = api_key.strip()
    provider_id = _update(change)
    try:
        _apply_secrets(provider_id, _read()["providers"][provider_id], with_key or None, fields)
    except ConfigError:
        remove_provider(provider_id)  # don't leave a half-added provider behind
        raise
    return provider_id


def update_provider(provider_id: str, *, name: str | None, base_url: str | None, free: str | None,
                    api_key: str | None, fields: dict[str, str]) -> None:
    def change(data: dict) -> dict:
        spec = _provider(data, provider_id)
        if name is not None:
            label = " ".join(name.split())
            if not 2 <= len(label) <= 40:
                raise ConfigError("Give the provider a name (2-40 characters).")
            spec["name"] = label
        if base_url is not None or free is not None:
            if not spec.get("custom"):
                raise ConfigError("Only a custom provider's address and pricing can be changed here.")
            if base_url is not None:
                spec["base_url"] = clean_url(base_url)
                local = is_local_url(spec["base_url"])
                spec["requires_key"] = not local
                spec["local"] = local
            if free is not None:
                spec["free"] = free
        return dict(spec)

    _apply_secrets(provider_id, _update(change), api_key, fields)


def remove_provider(provider_id: str) -> None:
    """Remove a provider and its models. Its key stays in .env until removed explicitly."""
    def change(data: dict) -> None:
        _provider(data, provider_id)
        del data["providers"][provider_id]
        data["chain"] = [item for item in data["chain"] if item["provider"] != provider_id]

    _update(change)


# ─── Models ────────────────────────────────────────────────────────────
def default_label(model: str, name: str = "") -> str:
    """A short display name: the provider's own, else the last part of the id."""
    label = re.sub(r"\s*\(free\)\s*$", "", name, flags=re.IGNORECASE).strip()
    label = label.split(": ", 1)[-1] if label else model.rsplit("/", 1)[-1].removesuffix(":free")
    return label[:60] or model[:60]


def add_model(provider_id: str, model: str, label: str) -> str:
    model = model.strip()
    if not model or len(model) > 200 or re.search(r"\s", model):
        raise ConfigError("Enter the model's exact ID, as the provider writes it.")

    def change(data: dict) -> str:
        _provider(data, provider_id)
        model_id = f"{provider_id}:{model}"
        if any(f"{i['provider']}:{i['model']}" == model_id for i in data["chain"]):
            raise ConfigError("That model is already in your list.", 409)
        data["chain"].append({"provider": provider_id, "model": model, "label": label.strip()[:60] or model})
        return model_id

    return _update(change)


def update_model(model_id: str, *, enabled: bool | None, label: str | None, free: str | None) -> None:
    def change(data: dict) -> None:
        item = _entry(data, model_id)
        if enabled is not None:
            item["enabled"] = enabled
        if label is not None:
            if not label.strip():
                raise ConfigError("The name can't be empty.")
            item["label"] = label.strip()[:60]
        if free == "auto":
            item.pop("free", None)
        elif free is not None:
            item["free"] = free == "free"

    _update(change)


def remove_model(model_id: str) -> None:
    def change(data: dict) -> None:
        data["chain"].remove(_entry(data, model_id))

    _update(change)


def reorder(model_ids: list[str]) -> None:
    """Put the chain in the given order; models not mentioned keep their place at the end."""
    def change(data: dict) -> None:
        rank = {model_id: index for index, model_id in enumerate(model_ids)}
        data["chain"].sort(key=lambda i: rank.get(f"{i['provider']}:{i['model']}", len(rank)))

    _update(change)


def set_free_only(value: bool) -> None:
    def change(data: dict) -> None:
        data.setdefault("settings", {})["free_only"] = value

    _update(change)
