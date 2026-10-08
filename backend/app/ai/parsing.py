"""Tolerant JSON extraction from model output."""

from __future__ import annotations

import json
import re

_FENCE = re.compile(r"```(?:json)?\s*|```", re.IGNORECASE)
_THINKING = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


def extract_json_array(text: str) -> list:
    """Return the first JSON array in `text`, or [] if there is none.

    Models wrap JSON in code fences, prepend reasoning, or return an object
    with the list inside — all of which are handled here.
    """
    text = _FENCE.sub("", _THINKING.sub("", text)).strip()
    candidates = [text]
    start, end = text.find("["), text.rfind("]")
    if start != -1 and end > start:
        candidates.append(text[start : end + 1])
    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except ValueError:
            continue
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            for value in parsed.values():
                if isinstance(value, list):
                    return value
    return []
