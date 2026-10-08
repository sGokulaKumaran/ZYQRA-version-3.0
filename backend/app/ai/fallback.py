"""Model chain with automatic fallback and recovery.

Every request walks the chain in ai_models.json from the best model down and
uses the first one that answers. A model that is rate limited or failing is
put on cooldown and skipped; once the cooldown passes it is tried again, so
traffic returns to the best model on its own as soon as its quota resets.

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
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import httpx
from dotenv import dotenv_values

from ..config import ENV_FILE, settings

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

_DAILY_QUOTA = re.compile(r"per[\s_-]?day|daily|\bRPD\b|\bTPD\b", re.IGNORECASE)
_DURATION = re.compile(r"(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:(\d+)ms)?")
_RETRY_HINTS = (
    re.compile(r"retry(?:ing)? in\s+([\dhms.]+)", re.IGNORECASE),
    re.compile(r"try again in\s+([\dhms.]+)", re.IGNORECASE),
    re.compile(r'"retryDelay"\s*:\s*"([\dhms.]+)"'),
)


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
    fallback: bool  # True when a higher-priority model had to be skipped
    latency_ms: int = 0

    def meta(self) -> dict:
        return {
            "provider": self.provider,
            "model": self.model,
            "label": self.label,
            "fallback": self.fallback,
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

    def keys(self) -> list[str]:
        return [k.strip() for k in os.getenv(self.key_env, "").split(",") if k.strip()]

    def url(self) -> str | None:
        """base_url with {ENV_VAR} placeholders filled; None if one is unset."""
        missing = False

        def fill(match: re.Match) -> str:
            nonlocal missing
            value = os.getenv(match.group(1), "").strip()
            missing = missing or not value
            return value

        resolved = re.sub(r"\{([A-Z0-9_]+)\}", fill, self.base_url).rstrip("/")
        return None if missing else resolved

    def ready(self) -> bool:
        return bool(self.keys()) and self.url() is not None


@dataclass
class ModelEntry:
    provider: str
    model: str
    label: str
    tier: str = "strong"
    enabled: bool = True
    max_input_chars: int | None = None

    @property
    def id(self) -> str:
        return f"{self.provider}:{self.model}"


@dataclass
class SlotState:
    """Cooldown bookkeeping for one model on one API key."""

    cooldown_until: float = 0.0
    reason: str = ""
    failures: int = 0


@dataclass
class ModelStats:
    ok: int = 0
    failed: int = 0
    last_used: float = 0.0
    last_latency_ms: int = 0
    last_error: str = ""
    last_error_at: float = 0.0


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
        self._discovered: dict[str, tuple[float, list[str] | None]] = {}

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
                providers = {
                    pid: Provider(
                        id=pid,
                        name=spec.get("name", pid),
                        base_url=spec["base_url"],
                        key_env=spec["key_env"],
                        daily_reset_utc_hour=int(spec.get("daily_reset_utc_hour", 0)),
                        max_input_chars=spec.get("max_input_chars"),
                        headers=dict(spec.get("headers", {})),
                        signup_url=spec.get("signup_url", ""),
                        free_tier=spec.get("free_tier", ""),
                    )
                    for pid, spec in data["providers"].items()
                }
                chain = []
                for item in data["chain"]:
                    if item["provider"] not in providers:
                        raise ValueError(f"chain uses unknown provider '{item['provider']}'")
                    chain.append(
                        ModelEntry(
                            provider=item["provider"],
                            model=item["model"],
                            label=item.get("label", item["model"]),
                            tier=item.get("tier", "strong"),
                            enabled=bool(item.get("enabled", True)),
                            max_input_chars=item.get("max_input_chars"),
                        )
                    )
            except (ValueError, KeyError, TypeError) as exc:
                # Keep serving with the last good configuration.
                self._config_error = f"{path.name}: {exc}"
                log.error("could not load %s: %s", path.name, exc)
                return
            self._providers, self._chain, self._config_error = providers, chain, ""
            log.info("AI chain loaded: %d models across %d providers", len(chain), len(providers))

    def _find(self, model_id: str | None) -> ModelEntry | None:
        return next((e for e in self._chain if e.id == model_id), None) if model_id else None

    # ── slot state ───────────────────────────────────────────────────
    def _slot(self, entry: ModelEntry, key_index: int) -> SlotState:
        return self._slots.setdefault((entry.provider, entry.model, key_index), SlotState())

    def _blocked_until(self, entry: ModelEntry, key_index: int) -> tuple[float, str]:
        key_block = self._key_blocks.get((entry.provider, key_index))
        slot = self._slots.get((entry.provider, entry.model, key_index))
        candidates = [s for s in (key_block, slot) if s and s.cooldown_until > time.time()]
        if not candidates:
            return 0.0, ""
        worst = max(candidates, key=lambda s: s.cooldown_until)
        return worst.cooldown_until, worst.reason

    def _candidates(self, prefer: str | None) -> Iterator[tuple[ModelEntry, Provider, int, str, bool]]:
        """Yield (entry, provider, key_index, key, is_first_choice) for usable slots."""
        chain = [e for e in self._chain if e.enabled]
        preferred = self._find(prefer)
        if preferred and preferred.enabled:
            chain = [preferred] + [e for e in chain if e is not preferred]
        top = next((e for e in chain if self._providers[e.provider].ready()), None)
        for entry in chain:
            provider = self._providers[entry.provider]
            if not provider.ready():
                continue
            for index, key in enumerate(provider.keys()):
                with self._lock:
                    until, _ = self._blocked_until(entry, index)
                if until:
                    continue
                yield entry, provider, index, key, entry is top

    def _record_success(self, entry: ModelEntry, key_index: int, latency_ms: int) -> None:
        with self._lock:
            self._slots[(entry.provider, entry.model, key_index)] = SlotState()
            stats = self._stats.setdefault(entry.id, ModelStats())
            stats.ok += 1
            stats.last_used = time.time()
            stats.last_latency_ms = latency_ms

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
                for index in indexes:
                    target = self._slot(entry, index)
                    target.cooldown_until = time.time() + cooldown
                    target.reason = reason
                    target.failures = step + 1

        log.warning(
            "%s failed (%s: %s)%s - falling back",
            entry.id, err.kind, err.detail[:120],
            f", cooling down {int(cooldown)}s" if cooldown else "",
        )

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
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json", **provider.headers}
        return f"{provider.url()}/chat/completions", headers, payload

    def _call(self, entry: ModelEntry, provider: Provider, key: str, messages: list[Message],
              temperature: float) -> str:
        url, headers, payload = self._request(entry, provider, key, messages, temperature, stream=False)
        try:
            response = self._http.post(url, headers=headers, json=payload)
        except httpx.HTTPError as exc:
            raise ProviderError("network", type(exc).__name__) from exc
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

    def _stream_call(self, entry: ModelEntry, provider: Provider, key: str, messages: list[Message],
                     temperature: float) -> Iterator[str]:
        url, headers, payload = self._request(entry, provider, key, messages, temperature, stream=True)
        try:
            with self._http.stream("POST", url, headers=headers, json=payload) as response:
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
    def complete(self, messages: list[Message], *, temperature: float = 0.7,
                 prefer: str | None = None) -> AIResult:
        """Return one full answer from the best model that is currently available."""
        self._load()
        for entry, provider, index, key, is_top in self._candidates(prefer):
            started = time.time()
            try:
                text = self._call(entry, provider, key, messages, temperature)
            except ProviderError as err:
                self._record_failure(entry, provider, index, err)
                continue
            latency = int((time.time() - started) * 1000)
            self._record_success(entry, index, latency)
            return AIResult(text, entry.provider, entry.model, entry.label, not is_top, latency)
        raise self._unavailable()

    def stream(self, messages: list[Message], *, temperature: float = 0.7,
               prefer: str | None = None) -> Iterator[AIResult | str]:
        """Yield an AIResult header (text empty) once a model starts answering, then text chunks.

        Falling back is only possible before the first chunk; after that a
        failure raises AIInterrupted and the caller keeps what it received.
        """
        self._load()
        for entry, provider, index, key, is_top in self._candidates(prefer):
            started = time.time()
            chunks = self._stream_call(entry, provider, key, messages, temperature)
            try:
                first = next(chunks)
            except StopIteration:
                self._record_failure(entry, provider, index, ProviderError("empty", "empty response"))
                continue
            except ProviderError as err:
                self._record_failure(entry, provider, index, err)
                continue
            self._record_success(entry, index, int((time.time() - started) * 1000))
            try:
                yield AIResult("", entry.provider, entry.model, entry.label, not is_top)
                yield first
                yield from chunks
            except ProviderError as err:
                raise AIInterrupted(f"{entry.label} stopped responding ({err.kind}).") from err
            finally:
                chunks.close()
            return
        raise self._unavailable()

    def test(self, model_id: str) -> dict:
        """Send a one-word prompt to a single model, ignoring its cooldown."""
        self._load()
        entry = self._find(model_id)
        if entry is None:
            return {"ok": False, "error": "Unknown model."}
        provider = self._providers[entry.provider]
        if not provider.ready():
            return {"ok": False, "error": f"No API key set ({provider.key_env})."}
        messages = [{"role": "user", "content": "Reply with the single word: ready"}]
        last_error = ""
        for index, key in enumerate(provider.keys()):
            started = time.time()
            try:
                text = self._call(entry, provider, key, messages, 0.0)
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
    def _unavailable(self) -> AIUnavailable:
        if self._config_error and not self._chain:
            return AIUnavailable(f"The AI configuration could not be loaded ({self._config_error}).")
        if not any(p.ready() for p in self._providers.values()):
            return AIUnavailable(
                "No AI provider is configured yet. Add at least one API key to backend/.env "
                "(see .env.example) and try again."
            )
        soonest = min(
            (until for entry in self._chain if entry.enabled
             for until in [self._model_cooldown(entry)[0]] if until),
            default=0.0,
        )
        if soonest:
            wait = max(1, int(soonest - time.time()))
            pretty = f"{wait} seconds" if wait < 90 else f"{round(wait / 60)} minutes"
            return AIUnavailable(
                f"Every AI model is rate-limited or unavailable right now. The next one frees up in about {pretty}.",
                retry_in=wait,
            )
        return AIUnavailable("None of the AI models could answer this request. Please try again.")

    def _model_cooldown(self, entry: ModelEntry) -> tuple[float, str]:
        """(until, reason) if every key for this model is cooling down, else (0, '')."""
        provider = self._providers[entry.provider]
        blocks = [self._blocked_until(entry, i) for i in range(len(provider.keys()))]
        if not blocks or any(until == 0 for until, _ in blocks):
            return 0.0, ""
        return min(blocks, key=lambda b: b[0])

    def discover(self, force: bool = False) -> None:
        """Ask each configured provider which model ids it currently serves."""
        self._load()

        def fetch(provider: Provider) -> None:
            listed: list[str] | None = None
            try:
                response = self._http.get(
                    f"{provider.url()}/models",
                    headers={"Authorization": f"Bearer {provider.keys()[0]}", **provider.headers},
                    timeout=10.0,
                )
                if response.status_code == 200:
                    body = response.json()
                    items = body.get("data", body) if isinstance(body, dict) else body
                    listed = sorted(
                        str(item.get("id", "")).removeprefix("models/")
                        for item in items if isinstance(item, dict) and item.get("id")
                    )
            except (httpx.HTTPError, ValueError, AttributeError, TypeError):
                listed = None
            with self._lock:
                self._discovered[provider.id] = (time.time(), listed)

        threads = []
        for provider in self._providers.values():
            cached_at = self._discovered.get(provider.id, (0.0, None))[0]
            if provider.ready() and (force or time.time() - cached_at > DISCOVERY_TTL):
                thread = threading.Thread(target=fetch, args=(provider,), daemon=True)
                thread.start()
                threads.append(thread)
        for thread in threads:
            thread.join(timeout=12)

    def status(self) -> dict:
        self._load()
        now = time.time()
        chain, active = [], None
        with self._lock:
            for position, entry in enumerate(self._chain, start=1):
                provider = self._providers[entry.provider]
                stats = self._stats.get(entry.id, ModelStats())
                listed_models = self._discovered.get(provider.id, (0.0, None))[1]
                until, reason = (0.0, "")
                if not entry.enabled:
                    state = "disabled"
                elif not provider.ready():
                    state = "no_key"
                else:
                    until, reason = self._model_cooldown(entry)
                    state = "cooldown" if until else "ready"
                if state == "ready" and active is None:
                    active = entry.id
                chain.append({
                    "id": entry.id,
                    "position": position,
                    "provider": entry.provider,
                    "provider_name": provider.name,
                    "model": entry.model,
                    "label": entry.label,
                    "tier": entry.tier,
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
            providers = [
                {
                    "id": p.id,
                    "name": p.name,
                    "key_env": p.key_env,
                    "configured": p.ready(),
                    "key_count": len(p.keys()),
                    "signup_url": p.signup_url,
                    "free_tier": p.free_tier,
                    "available_models": self._discovered.get(p.id, (0.0, None))[1],
                }
                for p in self._providers.values()
            ]
        return {
            "active": active,
            "chain": chain,
            "providers": providers,
            "config_error": self._config_error,
            "config_file": settings.ai_models_file.name,
        }


engine = AIEngine()
