"""Smart routing: match how demanding a request is to how capable a model is.

Two cheap judgements, neither of which costs an AI call:

  effort  how much the request asks for    simple | standard | complex
  tier    how capable a model is           light  | balanced | strong

A simple request goes to a light model first, a complex one to a strong model,
so the strong models' limited free quota is kept for work that needs it.
"""

from __future__ import annotations

import re

TIERS = ("strong", "balanced", "light")
EFFORTS = ("simple", "standard", "complex")

# Which tiers to try, best fit first, for each kind of request.
TIER_ORDER: dict[str, tuple[str, ...]] = {
    "simple": ("light", "balanced", "strong"),
    "standard": ("balanced", "strong", "light"),
    "complex": ("strong", "balanced", "light"),
}

# Names used by earlier versions of ai_models.json.
_LEGACY_TIERS = {"flagship": "strong", "fast": "balanced", "backup": "light"}


def normalise_tier(value: str | None) -> str:
    """A tier written in the configuration, or "" when none was set."""
    value = (value or "").strip().lower()
    value = _LEGACY_TIERS.get(value, value)
    return value if value in TIERS else ""


# ─── How capable is a model? ───────────────────────────────────────────
def _word(*words: str) -> re.Pattern:
    """Match any of the words as a whole token ("mini" but not "gemini")."""
    return re.compile(rf"(?<![a-z])(?:{'|'.join(words)})(?![a-z])")


_LIGHT = _word("lite", "mini", "nano", "small", "tiny", "haiku", "instant", "micro", "edge")
_STRONG = _word("pro", "large", "ultra", "opus", "max", "super", "reasoner", "reasoning", "thinking", "deep")
_PARAMETERS = re.compile(r"(?<![a-z\d.])(\d+(?:\.\d+)?)b(?![a-z])")  # "70b", "3.5b"


def guess_tier(model: str, name: str = "") -> str:
    """Estimate a model's tier from its id and display name."""
    text = f"{model} {name}".lower()
    if _LIGHT.search(text):
        return "light"
    if _STRONG.search(text):
        return "strong"
    sizes = [float(n) for n in _PARAMETERS.findall(text)]
    if sizes:
        size = max(sizes)
        return "strong" if size >= 60 else "balanced" if size >= 16 else "light"
    return "balanced"


# ─── How demanding is a request? ───────────────────────────────────────
_GREETING = re.compile(r"^\W*(hi|hello|hey|thanks|thank you|ok|okay|yes|no|bye|good (morning|afternoon|evening|night))\b", re.I)
_LOOKUP = re.compile(
    r"^\W*(what is|what's|what are|who is|who was|define|meaning of|when (is|was|did)|where is|"
    r"capital of|full form of|spell|translate|synonym|antonym)\b", re.I,
)
# Work that needs real reasoning...
_HARD = re.compile(
    r"\b(prove|proof|derive|derivation|theorem|integrat\w*|differentiat\w*|algorithm|complexity|"
    r"debug|optimi[sz]e|refactor|critique|justify|essay)\b", re.I,
)
# ...and work that needs care, but less of it.
_DEMANDING = re.compile(
    r"\b(solve|calculate|equation|implement|analy[sz]e|evaluate|compare|contrast|"
    r"step[- ]by[- ]step|in detail|detailed|explain why|reasoning)\b", re.I,
)
_CODE = re.compile(r"```|^\s*(def|class|function|import|from|return|#include|SELECT)\b.*[({:;]|[{};]\s*$", re.M)
_MATHS = re.compile(r"\\(frac|int|sum|sqrt)|[√∫∑≤≥]|\d\s*[\^*/+=-]\s*[\dxyn(]|\b[xyn]\s*=")

# Study modes that call for a more careful answer.
_CAREFUL_MODES = {"exam", "coding", "socratic"}


SHORT_FOLLOW_UP = 25  # "why?", "continue", "and then?" lean on the question before them


def classify(text: str, mode: str = "") -> str:
    """How demanding is this request? Looks only at its wording and length."""
    text = text.strip()
    length = len(text)
    hard = bool(_HARD.search(text))
    demanding = bool(_DEMANDING.search(text))
    code = bool(_CODE.search(text))
    maths = bool(_MATHS.search(text))

    if not (hard or demanding or code or maths):
        if length < 40 and _GREETING.search(text):
            return "simple"
        if length < 90 and _LOOKUP.search(text) and mode not in _CAREFUL_MODES:
            return "simple"

    score = 3 * hard + 2 * demanding + 2 * code + maths
    score += 2 if length > 600 else 1 if length > 200 else 0
    score += text.count("?") >= 2
    score += mode in _CAREFUL_MODES
    return "complex" if score >= 3 else "standard"


def classify_messages(messages: list[dict], mode: str = "") -> str:
    """Effort for a conversation: judged from the latest thing the user asked."""
    asked = [m.get("content", "") for m in messages if m.get("role") == "user"]
    if not asked:
        return "standard"
    effort = classify(asked[-1], mode)
    # "simple" here means a greeting or a self-contained lookup, which stands on its own.
    if effort != "simple" and len(asked[-1].strip()) < SHORT_FOLLOW_UP and len(asked) > 1:
        # A short follow-up continues the previous question, so it needs a model at least as capable.
        earlier = classify(asked[-2], mode)
        effort = max(effort, earlier, key=EFFORTS.index)
    return effort
