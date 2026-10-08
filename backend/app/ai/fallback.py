"""The AI engine: smart model choice, usage limits and automatic fallback.

Each request is matched to a model that suits it (see routing.py): a quick
question goes to a fast model, a hard one to a powerful model. A model that
has reached its usage limit or is failing is set aside and skipped; once the
limit resets it is used again on its own. If the chosen model fails, the next
best one answers instead.

All providers are reached through the OpenAI-compatible chat completions API,
which is why adding one is configuration only.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from collections import deque
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import httpx
from dotenv import dotenv_values

from ..config import ENV_FILE, settings
from .presets import PRESETS
from .routing import TIER_ORDER, classify_messages, guess_tier, normalise_tier

log = logging.getLogger("zyqra.ai")

Message = dict[str, str]

# Cooldown ladders (seconds), indexed by consecutive failures of the same slot.
RATE_LIMIT_BACKOFF = (60, 300, 900, 1800)
SERVER_ERROR_BACKOFF = (30, 120, 300)
DAILY_QUOTA_REPROBE = 3600  # re-check a day-limited model hourly until it resets
KEY_REJECTED_COOLDOWN = 3600
MODEL_MISSING_COOLDOWN = 6 * 3600
BILLING_COOLDOWN = 6 * 3600
MAX_COOLDOWN = 24 * 3600
DISCOVERY_TTL = 6 * 3600
STATE_SAVE_INTERVAL = 3.0  # seconds between writes of the usage / limit state file
# Requests per minute assumed for a model whose limit is unknown, when sharing
# load between models of the same tier.
ASSUMED_RPM = 15
# A model this close to its reported limit is saved for when nothing else fits.
NEARLY_EXHAUSTED = 0.15

_DAILY_QUOTA = re.compile(r"per[\s_-]?day|daily|\bRPD\b|\bTPD\b", re.IGNORECASE)
_DURATION = re.compile(r"(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:(\d+)ms)?")
_RETRY_HINTS = (
    re.compile(r"retry(?:ing)? in\s+([\dhms.]+)", re.IGNORECASE),
    re.compile(r"try again in\s+([\dhms.]+)", re.IGNORECASE),
    re.compile(r'"retryDelay"\s*:\s*"([\dhms.]+)"'),
)

# Models a provider lists that cannot hold a conversation.
_NON_CHAT = re.compile(
    r"embed|whisper|tts|speech|transcri|rerank|moderation|guard|imagen|image|dall-e|diffusion"
    r"|flux|sdxl|veo-|lyria|audio|\bbge\b|clip|\bocr\b|\baqa\b",
    re.IGNORECASE,
)
_NON_CHAT_TYPES = {"embedding", "embeddings", "image", "audio", "rerank", "moderation", "video", "transcribe", "tts"}
_CONTEXT_KEYS = ("context_length", "context_window", "inputTokenLimit", "max_context_length")
_PRICE_KEYS = ("prompt", "completion", "input", "output")


# ─── Errors & results ──────────────────────────────────────────────────
class AIError(Exception):
    """Base class for failures the API layer turns into a friendly message."""


class AIUnavailable(AIError):
    """No model in the chain could answer."""

    def __init__(self, message: str, retry_in: int | None = None):
        super().__init__(message)
        self.retry_in = retry_in


class AIInterrupted(AIError):
    """A stream broke after it had started; partial text was already sent."""


class ProviderError(Exception):
    def __init__(self, kind: str, detail: str, status: int | None = None, retry_after: float | None = None):
        super().__init__(detail)
        self.kind = kind  # rate_limit | daily_quota | auth | not_found | billing | bad_request | server | network | empty
        self.detail = detail
        self.status = status
        self.retry_after = retry_after


@dataclass
class AIResult:
    text: str
    provider: str
    model: str
    label: str
    fallback: bool  # True when the best-fitting model could not be used
    latency_ms: int = 0
    effort: str = ""  # how demanding the request was judged to be


    def meta(self) -> dict:
        return {
            "provider": self.provider,
            "model": self.model,
            "label": self.label,
            "fallback": self.fallback,
            "effort": self.effort,
        }


# ─── Configuration ─────────────────────────────────────────────────────
@dataclass
class Provider:
    id: str
    name: str
    base_url: str
    key_env: str
    daily_reset_utc_hour: int = 0
    max_input_chars: int | None = None
    headers: dict[str, str] = field(default_factory=dict)
    signup_url: str = ""
    free_tier: str = ""
    free: str = "auto"  # all | none | auto - see presets.py
    free_pattern: str = ""
    requires_key: bool = True
    local: bool = False
    custom: bool = False
    models_url: str = ""
    models_id_field: str = "id"
    fields: list[dict] = field(default_factory=list)  # extra .env values the URL needs
    rpm: int | None = None  # known requests-per-minute limit per model and key
    rpd: int | None = None  # known requests-per-day limit per model and key

    def real_keys(self) -> list[str]:
        return [k.strip() for k in os.getenv(self.key_env, "").split(",") if k.strip()]

    def keys(self) -> list[str]:
        """Keys to try in turn; a keyless (local) provider gets one empty slot."""
        return self.real_keys() or ([] if self.requires_key else [""])

    @staticmethod
    def _fill(template: str) -> str | None:
        """Fill {ENV_VAR} placeholders; None if one is unset."""
        missing = False

        def fill(match: re.Match) -> str:
            nonlocal missing
            value = os.getenv(match.group(1), "").strip()
            missing = missing or not value
            return value

        resolved = re.sub(r"\{([A-Z0-9_]+)\}", fill, template).rstrip("/")
        return None if missing else resolved

    def url(self) -> str | None:
        return self._fill(self.base_url)

    def models_endpoint(self) -> str | None:
        if self.models_url:
            return self._fill(self.models_url)
        base = self.url()
        return f"{base}/models" if base else None

    def ready(self) -> bool:
        return bool(self.keys()) and self.url() is not None

    def is_free(self, model: str, info: dict | None) -> bool | None:
        """True / False when known, None when it can't be told."""
        if self.free == "all":
            return True
        if self.free == "none":
            return False
        if self.free_pattern:
            return bool(re.search(self.free_pattern, model, re.IGNORECASE))
        if info and info.get("price_free") is not None:
            return info["price_free"]
        return True if model.endswith(":free") else None


@dataclass
class ModelEntry:
    provider: str
    model: str
    label: str
    tier: str = ""
    enabled: bool = True
    max_input_chars: int | None = None
    free: bool | None = None  # set to override what the provider reports
    rpm: int | None = None
    rpd: int | None = None

    @property
    def id(self) -> str:
        return f"{self.provider}:{self.model}"


@dataclass
class SlotState:
    """Cooldown bookkeeping for one model on one API key."""

    cooldown_until: float = 0.0
    reason: str = ""
    failures: int = 0
    kind: str = ""  # "limit": a usage limit was reached; "error": the provider is failing


@dataclass
class Usage:
    """How much one model has been used, and what the provider says is left."""

    day: str = ""  # the provider's quota day the count belongs to
    today: int = 0
    recent: deque = field(default_factory=lambda: deque(maxlen=400))  # request times, last minute
    limit: int | None = None  # as last reported by the provider's rate-limit headers
    remaining: int | None = None
    resets_at: float = 0.0


@dataclass
class ModelStats:
    ok: int = 0
    failed: int = 0
    last_used: float = 0.0
    last_latency_ms: int = 0
    last_error: str = ""
    last_error_at: float = 0.0


@dataclass
class Discovery:
    """A provider's own model list, as last fetched."""

    at: float = 0.0
    models: dict[str, dict] | None = None  # None: never fetched or the fetch failed
    error: str = ""


# ─── Helpers ───────────────────────────────────────────────────────────
def _parse_duration(text: str) -> float | None:
    """'37.5s', '7m12.5s', '1h2m', '450ms' or a bare number of seconds."""
    text = text.strip().rstrip(".,")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        pass
    match = _DURATION.fullmatch(text)
    if not match or not any(match.groups()):
        return None
    hours, minutes, seconds, millis = match.groups()
    return (
        int(hours or 0) * 3600
        + int(minutes or 0) * 60
        + float(seconds or 0)
        + int(millis or 0) / 1000
    )


def _retry_after(headers: httpx.Headers, body: str) -> float | None:
    header = headers.get("retry-after")
    if header:
        seconds = _parse_duration(header)
        if seconds is not None:
            return seconds
    for pattern in _RETRY_HINTS:
        match = pattern.search(body)
        if match:
            seconds = _parse_duration(match.group(1))
            if seconds is not None:
                return seconds
    return None


def _error_message(body: str) -> str:
    """Pull the human-readable message out of a provider error body."""
    try:
        data = json.loads(body)
        if isinstance(data, list) and data:
            data = data[0]
        err = data.get("error", data) if isinstance(data, dict) else data
        if isinstance(err, dict):
            message = err.get("message") or err.get("detail") or err.get("code")
            if message:
                return str(message)[:300]
        if isinstance(err, str):
            return err[:300]
    except (ValueError, AttributeError):
        pass
    return body.strip()[:300] or "no details"


def _classify(status: int, headers: httpx.Headers, body: str) -> ProviderError:
    message = _error_message(body)
    if status == 429:
        kind = "daily_quota" if _DAILY_QUOTA.search(body) else "rate_limit"
        return ProviderError(kind, message, status, _retry_after(headers, body))
    if status in (401, 403):
        return ProviderError("auth", message, status)
    if status == 402:
        return ProviderError("billing", message, status)
    if status == 404:
        return ProviderError("not_found", message, status)
    if status >= 500:
        return ProviderError("server", message, status, _retry_after(headers, body))
    return ProviderError("bad_request", message, status)


def _content_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):  # some APIs return a list of typed parts
        return "".join(part.get("text", "") for part in content if isinstance(part, dict))
    return ""


def _fit(messages: list[Message], limit: int | None) -> list[Message]:
    """Drop the oldest turns so the prompt stays under a provider's size limit."""
    if not limit or sum(len(m["content"]) for m in messages) <= limit:
        return messages
    system = [m for m in messages if m["role"] == "system"]
    turns = [m for m in messages if m["role"] != "system"]
    budget = limit - sum(len(m["content"]) for m in system)
    kept: list[Message] = []
    for message in reversed(turns):
        size = len(message["content"])
        if size > budget:
            if not kept:  # always keep the latest turn, truncated if it must be
                kept.append({**message, "content": message["content"][: max(budget, 2000)]})
            break
        kept.append(message)
        budget -= size
    return system + kept[::-1]


def _number(value) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_models(body, id_field: str = "id") -> dict[str, dict]:
    """Normalise a provider's model list into {id: {name, context, price_free, chat}}."""
    items = body
    if isinstance(body, dict):
        items = next((body[k] for k in ("data", "models", "result") if isinstance(body.get(k), list)), [])
    found: dict[str, dict] = {}
    for item in items if isinstance(items, list) else []:
        if isinstance(item, str):
            item = {"id": item}
        if not isinstance(item, dict):
            continue
        model_id = str(item.get(id_field) or item.get("id") or "").removeprefix("models/").strip()
        if not model_id:
            continue

        name = "" if id_field == "name" else item.get("name") or item.get("display_name") or item.get("displayName")
        name = str(name or "").removeprefix("models/")
        context = next(
            (int(value) for key in _CONTEXT_KEYS
             if isinstance(value := item.get(key), (int, float)) and value > 0),
            None,
        )
        price_free = None
        pricing = item.get("pricing")
        if isinstance(pricing, dict):
            prices = [n for key in _PRICE_KEYS if (n := _number(pricing.get(key))) is not None]
            if prices and min(prices) >= 0:  # negative means "varies" (routers)
                price_free = max(prices) == 0
        architecture = item.get("architecture")
        outputs = architecture.get("output_modalities") if isinstance(architecture, dict) else None
        chat = (
            str(item.get("type") or "").lower() not in _NON_CHAT_TYPES
            and not _NON_CHAT.search(model_id)
            and (not isinstance(outputs, list) or "text" in outputs)
        )
        found[model_id] = {
            "name": "" if name == model_id else name,
            "context": context,
            "price_free": price_free,
            "chat": chat,
        }
    return dict(sorted(found.items()))


def _discovery_error(status: int, body: str) -> str:
    if status in (401, 403):
        return "The API key was rejected."
    if status == 404:
        return "This provider does not publish a model list. Add models by their ID instead."
    return f"The provider answered {status}: {_error_message(body)}"


def _rate_headers(headers: httpx.Headers) -> tuple[int | None, int | None, float | None]:
    """(limit, remaining, seconds until reset) from the usual rate-limit headers."""
    def first(*names: str) -> str | None:
        return next((headers[n] for n in names if n in headers), None)

    def whole(value: str | None) -> int | None:
        number = _number(value)
        return None if number is None or number < 0 else int(number)

    reset = None
    raw = first("x-ratelimit-reset-requests", "x-ratelimit-reset")
    if raw:
        value = _parse_duration(raw)
        if value is not None:
            if value > 1e11:  # epoch milliseconds
                value = value / 1000 - time.time()
            elif value > 1e9:  # epoch seconds
                value -= time.time()
            reset = max(0.0, value)
    return (
        whole(first("x-ratelimit-limit-requests", "x-ratelimit-limit")),
        whole(first("x-ratelimit-remaining-requests", "x-ratelimit-remaining")),
        reset,
    )


def _quota_day(reset_hour_utc: int) -> str:
    """The provider's current quota day: it rolls over at its daily reset hour."""
    return (datetime.now(timezone.utc) - timedelta(hours=reset_hour_utc % 24)).date().isoformat()


def _seconds_until_hour_utc(hour: int) -> float:
    now = datetime.now(timezone.utc)
    target = now.replace(hour=hour % 24, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


def _iso(timestamp: float) -> str | None:
    if not timestamp:
        return None
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z")


# ─── Engine ────────────────────────────────────────────────────────────
class AIEngine:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._http = httpx.Client(
            timeout=httpx.Timeout(settings.ai_timeout_seconds, connect=10.0),
            limits=httpx.Limits(max_connections=20),
        )
        self._providers: dict[str, Provider] = {}
        self._chain: list[ModelEntry] = []
        self._config_mtime = 0.0
        self._config_error = ""
        self._slots: dict[tuple[str, str, int], SlotState] = {}
        self._key_blocks: dict[tuple[str, int], SlotState] = {}
        self._stats: dict[str, ModelStats] = {}
        self._discovered: dict[str, Discovery] = {}
        self._free_only = True
        self._usage: dict[str, Usage] = {}
        self._state_file = settings.ai_models_file.with_name(".ai_state.json")
        self._state_saved = 0.0
        self._state_timer: threading.Timer | None = None
        self._restore_state()

        self._env_mtime = self._mtime(ENV_FILE)
        self._env_keys = {k for k, v in dotenv_values(ENV_FILE).items() if v}

    # ── configuration ────────────────────────────────────────────────
    @staticmethod
    def _mtime(path) -> float:
        try:
            return path.stat().st_mtime
        except OSError:
            return 0.0

    def _reload_env(self) -> None:
        """Pick up API keys added to or removed from .env while the server runs."""
        mtime = self._mtime(ENV_FILE)
        if mtime == self._env_mtime:
            return
        with self._lock:
            self._env_mtime = mtime
            values = {k: v for k, v in dotenv_values(ENV_FILE).items() if v}
            for name in self._env_keys - values.keys():
                os.environ.pop(name, None)
            os.environ.update(values)
            self._env_keys = set(values)
            self._key_blocks.clear()  # a replaced key deserves a fresh try
        log.info(".env changed - API keys reloaded")

    def _load(self) -> None:
        """(Re)read ai_models.json when it changed on disk."""
        self._reload_env()
        path = settings.ai_models_file
        try:
            mtime = path.stat().st_mtime
        except OSError:
            self._config_error = f"{path.name} not found"
            return
        if mtime == self._config_mtime:
            return
        with self._lock:
            self._config_mtime = mtime
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                providers = {}
                for pid, raw in data["providers"].items():
                    # A known provider only has to state what differs from its preset.
                    preset = {} if raw.get("custom") else PRESETS.get(raw.get("preset", pid), {})
                    spec = {**preset, **raw}
                    free = spec.get("free", "auto")
                    if free not in ("all", "none", "auto"):
                        raise ValueError(f"provider '{pid}': free must be all, none or auto")
                    re.compile(spec.get("free_pattern", ""))
                    providers[pid] = Provider(
                        id=pid,
                        name=spec.get("name", pid),
                        base_url=spec["base_url"],
                        key_env=spec["key_env"],
                        daily_reset_utc_hour=int(spec.get("daily_reset_utc_hour", 0)),
                        max_input_chars=spec.get("max_input_chars"),
                        headers=dict(spec.get("headers", {})),
                        signup_url=spec.get("signup_url", ""),
                        free_tier=spec.get("free_tier", ""),
                        free=free,
                        free_pattern=spec.get("free_pattern", ""),
                        requires_key=bool(spec.get("requires_key", True)),
                        local=bool(spec.get("local", False)),
                        custom=bool(spec.get("custom", False)),
                        models_url=spec.get("models_url", ""),
                        models_id_field=spec.get("models_id_field", "id"),
                        fields=[dict(f) for f in spec.get("fields", [])],
                        rpm=spec.get("rpm"),
                        rpd=spec.get("rpd"),
                    )
                chain, seen = [], set()
                for item in data["chain"]:
                    if item["provider"] not in providers:
                        raise ValueError(f"chain uses unknown provider '{item['provider']}'")
                    entry = ModelEntry(
                        provider=item["provider"],
                        model=item["model"],
                        label=item.get("label", item["model"]),
                        tier=item.get("tier", ""),
                        enabled=bool(item.get("enabled", True)),
                        max_input_chars=item.get("max_input_chars"),
                        free=item.get("free") if isinstance(item.get("free"), bool) else None,
                        rpm=item.get("rpm"),
                        rpd=item.get("rpd"),
                    )
                    if entry.id not in seen:
                        seen.add(entry.id)
                        chain.append(entry)
                free_only = bool(data.get("settings", {}).get("free_only", True))
            except (ValueError, KeyError, TypeError, AttributeError, re.error) as exc:
                # Keep serving with the last good configuration.
                self._config_error = f"{path.name}: {exc}"
                log.error("could not load %s: %s", path.name, exc)
                return
            self._providers, self._chain, self._config_error = providers, chain, ""
            self._free_only = free_only
            log.info("AI chain loaded: %d models across %d providers", len(chain), len(providers))

    def reload(self) -> None:
        """Re-read the configuration and .env now (after Settings changed them)."""
        with self._lock:
            self._config_mtime = 0.0
            self._env_mtime = -1.0
        self._load()

    def forget(self, provider_id: str) -> None:
        """Drop what was learned about a provider whose key or URL just changed."""
        with self._lock:
            self._discovered.pop(provider_id, None)
            for key in [k for k in self._key_blocks if k[0] == provider_id]:
                del self._key_blocks[key]
            for key in [k for k in self._slots if k[0] == provider_id]:
                del self._slots[key]

    def _info(self, entry: ModelEntry) -> dict | None:
        models = self._discovered.get(entry.provider, Discovery()).models
        return models.get(entry.model) if models else None

    def _is_free(self, entry: ModelEntry) -> bool | None:
        if entry.free is not None:
            return entry.free
        return self._providers[entry.provider].is_free(entry.model, self._info(entry))

    def _blocked_as_paid(self, entry: ModelEntry) -> bool:
        return self._free_only and self._is_free(entry) is False

    def _find(self, model_id: str | None, chain: list[ModelEntry] | None = None) -> ModelEntry | None:
        source = self._chain if chain is None else chain
        return next((e for e in source if e.id == model_id), None) if model_id else None

    def build_chain(self, items: list[dict]) -> list[ModelEntry]:
        """A user's own model list as chain entries; models of removed providers are dropped."""
        self._load()
        chain, seen = [], set()
        for item in items:
            entry = ModelEntry(
                provider=str(item.get("provider", "")),
                model=str(item.get("model", "")),
                label=str(item.get("label") or item.get("model", "")),
                tier=str(item.get("tier") or ""),
                enabled=bool(item.get("enabled", True)),
            )
            if entry.provider in self._providers and entry.model and entry.id not in seen:
                seen.add(entry.id)
                chain.append(entry)
        return chain

    def default_items(self) -> list[dict]:
        """The default model list in the shape a personal list is stored in."""
        self._load()
        return [
            {
                "provider": e.provider, "model": e.model, "label": e.label,
                **({"tier": normalise_tier(e.tier)} if normalise_tier(e.tier) else {}),
                **({} if e.enabled else {"enabled": False}),
            }
            for e in self._chain
        ]

    # ── saved state ──────────────────────────────────────────────────
    def _restore_state(self) -> None:
        """Bring back usage counts and active limits from before a restart."""
        try:
            data = json.loads(self._state_file.read_text(encoding="utf-8"))
            now = time.time()
            for model_id, saved in data.get("usage", {}).items():
                self._usage[model_id] = Usage(
                    day=saved.get("day", ""), today=int(saved.get("today", 0)),
                    limit=saved.get("limit"), remaining=saved.get("remaining"),
                    resets_at=float(saved.get("resets_at", 0)),
                )
            for provider, model, index, until, reason, kind in data.get("cooldowns", []):
                if until > now:
                    self._slots[(provider, model, int(index))] = SlotState(float(until), reason, 1, kind)
        except (OSError, ValueError, TypeError, AttributeError):
            pass  # no state yet, or an unreadable file: start clean

    def _save_state(self, force: bool = False) -> None:
        """Write usage and limits to disk, at most once per STATE_SAVE_INTERVAL unless forced."""
        now = time.time()
        with self._lock:
            if not force and now - self._state_saved < STATE_SAVE_INTERVAL:
                # Too soon: write once the interval is over, so the latest counts are never lost.
                if self._state_timer is None:
                    self._state_timer = threading.Timer(STATE_SAVE_INTERVAL, self._flush_state)
                    self._state_timer.daemon = True
                    self._state_timer.start()
                return
            self._state_saved = now
            data = {
                "usage": {
                    model_id: {"day": u.day, "today": u.today, "limit": u.limit,
                               "remaining": u.remaining, "resets_at": u.resets_at}
                    for model_id, u in self._usage.items() if u.today or u.limit is not None
                },
                "cooldowns": [
                    [provider, model, index, slot.cooldown_until, slot.reason, slot.kind]
                    for (provider, model, index), slot in self._slots.items() if slot.cooldown_until > now
                ],
            }
        try:
            scratch = self._state_file.with_suffix(".tmp")
            scratch.write_text(json.dumps(data), encoding="utf-8")
            os.replace(scratch, self._state_file)
        except OSError as exc:
            log.warning("could not save AI state: %s", exc)

    def _flush_state(self) -> None:
        with self._lock:
            self._state_timer = None
        self._save_state(force=True)

    # ── usage and limits ─────────────────────────────────────────────
    def _used(self, entry: ModelEntry, provider: Provider) -> Usage:
        """The model's usage record, rolled over to the provider's current quota day."""
        usage = self._usage.setdefault(entry.id, Usage())
        day = _quota_day(provider.daily_reset_utc_hour)
        if usage.day != day:
            usage.day, usage.today = day, 0
        return usage

    def _count_request(self, entry: ModelEntry, provider: Provider) -> None:
        with self._lock:
            usage = self._used(entry, provider)
            usage.today += 1
            usage.recent.append(time.time())

    def _recent(self, entry: ModelEntry, now: float) -> int:
        usage = self._usage.get(entry.id)
        return sum(1 for at in usage.recent if at > now - 60) if usage else 0

    def _note_limits(self, entry: ModelEntry, provider: Provider, key_index: int, headers: httpx.Headers) -> None:
        """Learn the remaining quota from a response; set the model aside the moment it hits zero."""
        limit, remaining, reset = _rate_headers(headers)
        if remaining is None:
            return
        with self._lock:
            usage = self._used(entry, provider)
            usage.limit, usage.remaining = limit, remaining
            usage.resets_at = time.time() + reset if reset is not None else 0.0
            exhausted = remaining == 0 and bool(reset)
            if exhausted:
                slot = self._slot(entry, key_index)
                slot.cooldown_until = time.time() + min(max(reset, 1.0), MAX_COOLDOWN)
                slot.reason, slot.kind = "Usage limit reached", "limit"
        if exhausted:
            self._save_state(force=True)  # a limit must survive a restart

    def _over_known_limit(self, entry: ModelEntry, provider: Provider, now: float) -> bool:
        """True when a limit written in the configuration says not to send another request yet."""
        keys = max(1, len(provider.keys()))
        rpm = entry.rpm or provider.rpm
        if rpm and self._recent(entry, now) >= rpm * keys:
            return True  # busy for a few seconds; not worth showing as a limit
        rpd = entry.rpd or provider.rpd
        if rpd and self._used(entry, provider).today >= rpd * keys:
            until = now + _seconds_until_hour_utc(provider.daily_reset_utc_hour)
            for index in range(keys):
                slot = self._slot(entry, index)
                slot.cooldown_until, slot.reason, slot.kind = until, "Daily limit reached", "limit"
            return True
        return False

    # ── slot state ───────────────────────────────────────────────────
    def _slot(self, entry: ModelEntry, key_index: int) -> SlotState:
        return self._slots.setdefault((entry.provider, entry.model, key_index), SlotState())

    def _blocked_until(self, entry: ModelEntry, key_index: int) -> tuple[float, str, str]:
        """(until, reason, kind) while this model can't be used on this key, else (0, "", "")."""
        key_block = self._key_blocks.get((entry.provider, key_index))
        slot = self._slots.get((entry.provider, entry.model, key_index))
        candidates = [s for s in (key_block, slot) if s and s.cooldown_until > time.time()]
        if not candidates:
            return 0.0, "", ""
        worst = max(candidates, key=lambda s: s.cooldown_until)
        return worst.cooldown_until, worst.reason, worst.kind or "error"

    # ── choosing a model ─────────────────────────────────────────────
    def _tier(self, entry: ModelEntry) -> str:
        return normalise_tier(entry.tier) or guess_tier(entry.model, (self._info(entry) or {}).get("name", ""))

    def _pressure(self, entry: ModelEntry, now: float) -> int:
        """How hard a model is being used; among equals, the least pressed goes first."""
        rpm = entry.rpm or self._providers[entry.provider].rpm or ASSUMED_RPM
        pressure = self._recent(entry, now) // max(1, rpm // 3)
        usage = self._usage.get(entry.id)
        if usage and usage.limit and usage.remaining is not None and usage.resets_at > now:
            if usage.remaining / usage.limit < NEARLY_EXHAUSTED:
                pressure += 3
        return pressure

    def _plan(self, source: list[ModelEntry] | None, effort: str) -> list[ModelEntry]:
        """The models that may answer, best fit for this request first."""
        source = [e for e in (self._chain if source is None else source) if e.provider in self._providers]
        usable = [
            e for e in source
            if e.enabled and not self._blocked_as_paid(e) and self._providers[e.provider].ready()
        ]
        order = TIER_ORDER.get(effort, TIER_ORDER["standard"])
        now = time.time()
        with self._lock:
            # Stable sort: models that tie keep the order they have in the list.
            return sorted(usable, key=lambda e: (order.index(self._tier(e)), self._pressure(e, now)))

    def _candidates(self, prefer: str | None, source: list[ModelEntry] | None,
                    effort: str) -> Iterator[tuple[ModelEntry, Provider, int, str, bool]]:
        """Yield (entry, provider, key_index, key, second_best) for every slot worth trying.

        `second_best` is True when the model is not what this request would
        ideally get: not the one the user picked, or of a lesser-fitting tier.
        """
        plan = self._plan(source, effort)
        ideal_tier = self._tier(plan[0]) if plan else ""
        picked = next((e for e in plan if e.id == prefer), None) if prefer else None
        if picked:
            plan = [picked] + [e for e in plan if e is not picked]
        for entry in plan:
            provider = self._providers[entry.provider]
            with self._lock:
                if self._over_known_limit(entry, provider, time.time()):
                    continue
            for index, key in enumerate(provider.keys()):
                with self._lock:
                    until = self._blocked_until(entry, index)[0]
                if until:
                    continue
                second_best = entry is not picked if picked else self._tier(entry) != ideal_tier
                yield entry, provider, index, key, second_best

    def _record_success(self, entry: ModelEntry, key_index: int, latency_ms: int) -> None:
        with self._lock:
            slot = self._slots.get((entry.provider, entry.model, key_index))
            if slot and slot.cooldown_until <= time.time():  # keep a limit the response itself announced
                self._slots[(entry.provider, entry.model, key_index)] = SlotState()
            stats = self._stats.setdefault(entry.id, ModelStats())
            stats.ok += 1
            stats.last_used = time.time()
            stats.last_latency_ms = latency_ms
        self._save_state()

    def _record_failure(self, entry: ModelEntry, provider: Provider, key_index: int, err: ProviderError) -> None:
        with self._lock:
            stats = self._stats.setdefault(entry.id, ModelStats())
            stats.failed += 1
            stats.last_error = f"{err.kind}: {err.detail}"
            stats.last_error_at = time.time()

            slot = self._slot(entry, key_index)
            step = slot.failures
            cooldown, reason = 0.0, ""

            if err.kind == "rate_limit":
                cooldown = err.retry_after or RATE_LIMIT_BACKOFF[min(step, len(RATE_LIMIT_BACKOFF) - 1)]
                reason = "Rate limit reached"
            elif err.kind == "daily_quota":
                until_reset = _seconds_until_hour_utc(provider.daily_reset_utc_hour)
                cooldown = max(err.retry_after or 0, min(until_reset, DAILY_QUOTA_REPROBE))
                reason = "Daily quota used up"
            elif err.kind == "billing":
                cooldown, reason = BILLING_COOLDOWN, "Provider reports no credit"
            elif err.kind == "not_found":
                cooldown, reason = MODEL_MISSING_COOLDOWN, "Model not available on this provider"
            elif err.kind in ("server", "network"):
                cooldown = err.retry_after or SERVER_ERROR_BACKOFF[min(step, len(SERVER_ERROR_BACKOFF) - 1)]
                reason = "Provider error" if err.kind == "server" else "Provider unreachable"
            elif err.kind == "auth":
                # The key itself is rejected, so every model on it is affected.
                self._key_blocks[(entry.provider, key_index)] = SlotState(
                    cooldown_until=time.time() + KEY_REJECTED_COOLDOWN,
                    reason="API key rejected",
                )
            # bad_request / empty: this prompt didn't work here, the model itself is fine.

            if cooldown:
                cooldown = min(max(cooldown, 1.0), MAX_COOLDOWN)
                # Quotas are per key; an outage or a missing model affects every key alike.
                shared = err.kind in ("server", "network", "not_found")
                indexes = range(len(provider.keys())) if shared else [key_index]
                kind = "limit" if err.kind in ("rate_limit", "daily_quota", "billing") else "error"
                for index in indexes:
                    target = self._slot(entry, index)
                    target.cooldown_until = time.time() + cooldown
                    target.reason = reason
                    target.kind = kind
                    target.failures = step + 1

        log.warning(
            "%s failed (%s: %s)%s - falling back",
            entry.id, err.kind, err.detail[:120],
            f", cooling down {int(cooldown)}s" if cooldown else "",
        )
        self._save_state(force=bool(cooldown))

    # ── HTTP ─────────────────────────────────────────────────────────
    def _request(self, entry: ModelEntry, provider: Provider, key: str, messages: list[Message],
                 temperature: float, stream: bool) -> tuple[str, dict, dict]:
        limit = entry.max_input_chars or provider.max_input_chars
        payload = {
            "model": entry.model,
            "messages": _fit(messages, limit),
            "temperature": temperature,
            "stream": stream,
        }
        headers = {"Content-Type": "application/json", **provider.headers}
        if key:
            headers["Authorization"] = f"Bearer {key}"
        return f"{provider.url()}/chat/completions", headers, payload

    def _call(self, entry: ModelEntry, provider: Provider, index: int, key: str, messages: list[Message],
              temperature: float) -> str:
        url, headers, payload = self._request(entry, provider, key, messages, temperature, stream=False)
        self._count_request(entry, provider)
        try:
            response = self._http.post(url, headers=headers, json=payload)
        except httpx.HTTPError as exc:
            raise ProviderError("network", type(exc).__name__) from exc
        self._note_limits(entry, provider, index, response.headers)
        if response.status_code != 200:
            raise _classify(response.status_code, response.headers, response.text)
        try:
            data = response.json()
            text = _content_text(data["choices"][0]["message"].get("content"))
        except (ValueError, KeyError, IndexError, TypeError, AttributeError) as exc:
            raise ProviderError("server", "unreadable response") from exc
        if not text.strip():
            raise ProviderError("empty", "empty response")
        return text

    def _stream_call(self, entry: ModelEntry, provider: Provider, index: int, key: str, messages: list[Message],
                     temperature: float) -> Iterator[str]:
        url, headers, payload = self._request(entry, provider, key, messages, temperature, stream=True)
        self._count_request(entry, provider)
        try:
            with self._http.stream("POST", url, headers=headers, json=payload) as response:
                self._note_limits(entry, provider, index, response.headers)
                if response.status_code != 200:
                    body = response.read().decode("utf-8", "replace")
                    raise _classify(response.status_code, response.headers, body)
                for line in response.iter_lines():
                    if not line.startswith("data:"):
                        continue  # blank separators and ": keep-alive" comments
                    data = line[5:].strip()
                    if data == "[DONE]":
                        return
                    try:
                        chunk = json.loads(data)
                    except ValueError:
                        continue
                    if isinstance(chunk, dict) and chunk.get("error"):
                        raise ProviderError("server", _error_message(json.dumps(chunk)))
                    choices = chunk.get("choices") if isinstance(chunk, dict) else None
                    if not choices:
                        continue
                    text = _content_text((choices[0].get("delta") or {}).get("content"))
                    if text:
                        yield text
        except httpx.HTTPError as exc:
            raise ProviderError("network", type(exc).__name__) from exc

    # ── public API ───────────────────────────────────────────────────
    def complete(self, messages: list[Message], *, temperature: float = 0.7, prefer: str | None = None,
                 chain: list[ModelEntry] | None = None, effort: str | None = None) -> AIResult:
        """Return one full answer from the model that best fits the request.

        `chain` is the list of models to choose from (default: the shared one);
        `effort` says how demanding the request is, and is judged from the
        messages when not given.
        """
        self._load()
        effort = effort or classify_messages(messages)
        failed = False
        for entry, provider, index, key, second_best in self._candidates(prefer, chain, effort):
            started = time.time()
            try:
                text = self._call(entry, provider, index, key, messages, temperature)
            except ProviderError as err:
                self._record_failure(entry, provider, index, err)
                failed = True
                continue
            latency = int((time.time() - started) * 1000)
            self._record_success(entry, index, latency)
            return AIResult(text, entry.provider, entry.model, entry.label, second_best or failed, latency, effort)
        raise self._unavailable(chain)

    def stream(self, messages: list[Message], *, temperature: float = 0.7, prefer: str | None = None,
               chain: list[ModelEntry] | None = None, effort: str | None = None) -> Iterator[AIResult | str]:
        """Yield an AIResult header (text empty) once a model starts answering, then text chunks.

        Falling back is only possible before the first chunk; after that a
        failure raises AIInterrupted and the caller keeps what it received.
        """
        self._load()
        effort = effort or classify_messages(messages)
        failed = False
        for entry, provider, index, key, second_best in self._candidates(prefer, chain, effort):
            started = time.time()
            chunks = self._stream_call(entry, provider, index, key, messages, temperature)
            try:
                first = next(chunks)
            except StopIteration:
                self._record_failure(entry, provider, index, ProviderError("empty", "empty response"))
                failed = True
                continue
            except ProviderError as err:
                self._record_failure(entry, provider, index, err)
                failed = True
                continue
            self._record_success(entry, index, int((time.time() - started) * 1000))
            try:
                yield AIResult("", entry.provider, entry.model, entry.label, second_best or failed, effort=effort)
                yield first
                yield from chunks
            except ProviderError as err:
                raise AIInterrupted(f"{entry.label} stopped responding ({err.kind}).") from err
            finally:
                chunks.close()
            return
        raise self._unavailable(chain)

    def test(self, model_id: str, chain: list[ModelEntry] | None = None) -> dict:
        """Send a one-word prompt to a single model, ignoring its cooldown."""
        self._load()
        entry = self._find(model_id, chain)
        if entry is None or entry.provider not in self._providers:
            return {"ok": False, "error": "Unknown model."}
        provider = self._providers[entry.provider]
        if not provider.ready():
            return {"ok": False, "error": f"{provider.name} is not set up yet."}
        messages = [{"role": "user", "content": "Reply with the single word: ready"}]
        last_error = ""
        for index, key in enumerate(provider.keys()):
            started = time.time()
            try:
                text = self._call(entry, provider, index, key, messages, 0.0)
            except ProviderError as err:
                self._record_failure(entry, provider, index, err)
                last_error = f"{err.kind.replace('_', ' ')}: {err.detail}"
                continue
            latency = int((time.time() - started) * 1000)
            self._record_success(entry, index, latency)
            with self._lock:
                self._key_blocks.pop((entry.provider, index), None)
            return {"ok": True, "latency_ms": latency, "reply": text.strip()[:60]}
        return {"ok": False, "error": last_error}

    # ── status ───────────────────────────────────────────────────────
    def _unavailable(self, source: list[ModelEntry] | None = None) -> AIUnavailable:
        chain = [e for e in (self._chain if source is None else source) if e.provider in self._providers]
        if self._config_error and not self._chain:
            return AIUnavailable(f"The AI configuration could not be loaded ({self._config_error}).")
        if not any(p.ready() for p in self._providers.values()):
            return AIUnavailable(
                "No AI provider is set up yet. Add a provider and its API key in "
                "Settings > AI models, then try again."
            )
        usable = [e for e in chain if e.enabled and self._providers[e.provider].ready()]
        if not usable:
            return AIUnavailable("No AI model is selected. Choose the models to use in Settings > AI models.")
        if all(self._blocked_as_paid(e) for e in usable):
            return AIUnavailable(
                "Free-only mode is on and every selected model is a paid one. Add a free model "
                "or turn free-only off in Settings > AI models."
            )
        soonest = min(
            (until for entry in chain if entry.enabled
             for until in [self._model_cooldown(entry)[0]] if until),
            default=0.0,
        )
        if soonest:
            wait = max(1, int(soonest - time.time()))
            pretty = f"{wait} seconds" if wait < 90 else f"{round(wait / 60)} minutes"
            return AIUnavailable(
                f"Every AI model has reached its usage limit or is unavailable right now. The next one frees up in about {pretty}.",
                retry_in=wait,
            )
        return AIUnavailable("None of the AI models could answer this request. Please try again.")

    def _model_cooldown(self, entry: ModelEntry) -> tuple[float, str, str]:
        """(until, reason, kind) if every key for this model is set aside, else (0, "", "")."""
        provider = self._providers[entry.provider]
        blocks = [self._blocked_until(entry, i) for i in range(len(provider.keys()))]
        if not blocks or any(until == 0 for until, _, _ in blocks):
            return 0.0, "", ""
        return min(blocks, key=lambda b: b[0])

    def discover(self, force: bool = False, only: str | None = None) -> None:
        """Fetch each ready provider's model list (cached for DISCOVERY_TTL)."""
        self._load()

        def fetch(provider: Provider) -> None:
            found = Discovery(at=time.time())
            try:
                key = provider.keys()[0]
                headers = {**provider.headers, **({"Authorization": f"Bearer {key}"} if key else {})}
                response = self._http.get(provider.models_endpoint(), headers=headers, timeout=10.0)
                if response.status_code == 200:
                    found.models = _parse_models(response.json(), provider.models_id_field)
                else:
                    found.error = _discovery_error(response.status_code, response.text)
            except httpx.HTTPError:
                found.error = (
                    f"Could not connect. Is {provider.name} running on this computer?"
                    if provider.local else "Could not reach the provider."
                )
            except (ValueError, AttributeError, TypeError, IndexError):
                found.error = "The provider's model list could not be read."
            with self._lock:
                self._discovered[provider.id] = found

        threads = []
        for provider in self._providers.values():
            if only is not None and provider.id != only:
                continue
            cached_at = self._discovered.get(provider.id, Discovery()).at
            if provider.ready() and (force or time.time() - cached_at > DISCOVERY_TTL):
                thread = threading.Thread(target=fetch, args=(provider,), daemon=True)
                thread.start()
                threads.append(thread)
        for thread in threads:
            thread.join(timeout=12)

    def has_provider(self, provider_id: str) -> bool:
        self._load()
        return provider_id in self._providers

    def provider_models(self, provider_id: str, refresh: bool = False,
                        chain: list[ModelEntry] | None = None) -> dict:
        """Every chat model a provider offers, flagged free / added, for the model picker."""
        self.discover(force=refresh, only=provider_id)
        with self._lock:
            provider = self._providers[provider_id]
            found = self._discovered.get(provider_id, Discovery())
            added = {e.model for e in (self._chain if chain is None else chain) if e.provider == provider_id}
            models = [
                {
                    "id": model_id,
                    "name": info["name"],
                    "context": info["context"],
                    "free": provider.is_free(model_id, info),
                    "added": model_id in added,
                }
                for model_id, info in (found.models or {}).items()
                if info["chat"] or model_id in added
            ]
        return {
            "provider": provider_id,
            "models": models,
            "error": found.error if provider.ready() else "",
            "fetched_at": _iso(found.at),
        }

    def is_ready(self, provider_id: str) -> bool:
        self._load()
        provider = self._providers.get(provider_id)
        return provider is not None and provider.ready()

    def describe(self, provider_id: str, model: str) -> dict:
        """What the provider's own list says about one model (empty if unknown)."""
        with self._lock:
            models = self._discovered.get(provider_id, Discovery()).models or {}
            return dict(models.get(model) or {})

    def status(self, admin: bool = False, source: list[ModelEntry] | None = None) -> dict:
        """Live state of a user's own list, or of the shared default list when none is given."""
        self._load()
        now = time.time()
        chain = []
        personal = source is not None
        # What Auto would pick right now for each kind of request.
        routes = {
            effort: next((entry.id for entry, *_ in self._candidates(None, source, effort)), None)
            for effort in TIER_ORDER
        }
        with self._lock:
            source = [e for e in (self._chain if source is None else source) if e.provider in self._providers]
            for position, entry in enumerate(source, start=1):
                provider = self._providers[entry.provider]
                stats = self._stats.get(entry.id, ModelStats())
                listed_models = self._discovered.get(provider.id, Discovery()).models
                info = self._info(entry) or {}
                until, reason, kind = 0.0, "", ""
                usage = self._used(entry, provider)
                if not entry.enabled:
                    state = "disabled"
                elif not provider.ready():
                    state = "no_key"
                elif self._blocked_as_paid(entry):
                    state = "blocked"
                else:
                    until, reason, kind = self._model_cooldown(entry)
                    state = ("limit" if kind == "limit" else "cooldown") if until else "ready"
                chain.append({
                    "id": entry.id,
                    "position": position,
                    "provider": entry.provider,
                    "provider_name": provider.name,
                    "model": entry.model,
                    "label": entry.label,
                    "tier": self._tier(entry),
                    "tier_auto": not normalise_tier(entry.tier),
                    "used_today": usage.today,
                    # What the provider last reported, while that report is still current.
                    "limit": usage.limit if usage.resets_at > now else None,
                    "remaining": usage.remaining if usage.resets_at > now else None,
                    "free": self._is_free(entry),
                    "context": info.get("context"),
                    "state": state,
                    "reason": reason,
                    "cooldown_until": _iso(until),
                    "cooldown_seconds": max(0, int(until - now)) if until else 0,
                    "listed": None if listed_models is None else entry.model in listed_models,
                    "ok": stats.ok,
                    "failed": stats.failed,
                    "last_used_at": _iso(stats.last_used),
                    "last_latency_ms": stats.last_latency_ms,
                    "last_error": stats.last_error,
                    "last_error_at": _iso(stats.last_error_at),
                })
            providers = []
            for p in self._providers.values():
                found = self._discovered.get(p.id, Discovery())
                keys = p.real_keys()
                providers.append({
                    "id": p.id,
                    "name": p.name,
                    "custom": p.custom,
                    "local": p.local,
                    "requires_key": p.requires_key,
                    "base_url": p.base_url if admin else "",
                    "key_env": p.key_env if admin else "",
                    "configured": p.ready(),
                    "key_count": len(keys),
                    # Enough to recognise a key, never enough to use it.
                    "key_hint": keys[0][-4:] if admin and keys and len(keys[0]) >= 16 else "",
                    "fields": [
                        {"env": f["env"], "label": f.get("label", f["env"]), "set": bool(os.getenv(f["env"], "").strip())}
                        for f in p.fields
                    ],
                    "signup_url": p.signup_url,
                    "free_tier": p.free_tier,
                    "free": "some" if p.free == "auto" and p.free_pattern else p.free,
                    "model_count": (
                        None if found.models is None else sum(1 for m in found.models.values() if m["chat"])
                    ),
                    "added_count": sum(1 for e in source if e.provider == p.id),
                    "error": found.error if p.ready() else "",
                })
        return {
            "active": routes["standard"],
            "routes": routes,
            "chain": chain,
            "providers": providers,
            "free_only": self._free_only,
            "can_manage": admin,
            "personal": personal,
            "config_error": self._config_error,
            "config_file": settings.ai_models_file.name,
        }


engine = AIEngine()
