"""AI layer: a provider-agnostic model chain with automatic fallback."""

from .fallback import AIError, AIResult, AIUnavailable, engine

__all__ = ["AIError", "AIResult", "AIUnavailable", "engine"]
