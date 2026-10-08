"""Known OpenAI-compatible providers, offered by name in Settings -> AI models.

A provider in ai_models.json whose id (or "preset") matches an entry here
inherits these values, so the file only has to state what differs.

"free" says how a model's Free / Paid label is decided:
  all   every model has a free tier (rate limited)
  none  the provider bills for every model
  auto  per model: "free_pattern" if set, else the price the provider reports
        in its model list, else unknown
Free tiers change often - "free_tier" is the note shown next to the provider.
"""

from __future__ import annotations

PRESETS: dict[str, dict] = {
    # ── Free tiers ────────────────────────────────────────────────
    "gemini": {
        "name": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "key_env": "GEMINI_API_KEY",
        "daily_reset_utc_hour": 8,
        "signup_url": "https://aistudio.google.com/apikey",
        "free": "auto",
        "free_pattern": r"flash|gemma",
        "free_tier": "Free, no card, for Flash, Flash-Lite and Gemma models. Limits are per model and shown in AI Studio.",
    },
    "groq": {
        "name": "Groq",
        "base_url": "https://api.groq.com/openai/v1",
        "key_env": "GROQ_API_KEY",
        "max_input_chars": 14000,
        "signup_url": "https://console.groq.com/keys",
        "free": "all",
        "free_tier": "Free, no card. About 30 requests/min and 1,000 requests/day per model; very fast.",
    },
    "nvidia": {
        "name": "NVIDIA NIM",
        "base_url": "https://integrate.api.nvidia.com/v1",
        "key_env": "NVIDIA_API_KEY",
        "signup_url": "https://build.nvidia.com",
        "free": "all",
        "free_tier": "Free endpoints, about 40 requests/min. Meant for prototyping.",
    },
    "mistral": {
        "name": "Mistral AI",
        "base_url": "https://api.mistral.ai/v1",
        "key_env": "MISTRAL_API_KEY",
        "signup_url": "https://console.mistral.ai/api-keys",
        "free": "all",
        "free_tier": "Free plan, no card. Monthly allowance; exact limits are shown in the Mistral console.",
    },
    "openrouter": {
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "key_env": "OPENROUTER_API_KEY",
        "headers": {"X-Title": "Zyqra"},
        "signup_url": "https://openrouter.ai/keys",
        "free": "auto",
        "free_tier": "Hundreds of models; the ones priced at zero are free: 20 requests/min, 50/day (1,000/day after a one-time $10 top-up).",
    },
    "cloudflare": {
        "name": "Cloudflare Workers AI",
        "base_url": "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
        "models_url": "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/models/search?task=Text%20Generation&per_page=200",
        "models_id_field": "name",
        "key_env": "CLOUDFLARE_API_TOKEN",
        "fields": [{"env": "CLOUDFLARE_ACCOUNT_ID", "label": "Account ID"}],
        "signup_url": "https://dash.cloudflare.com/profile/api-tokens",
        "free": "all",
        "free_tier": "10,000 Neurons/day shared across all models, resets 00:00 UTC.",
    },
    "sambanova": {
        "name": "SambaNova",
        "base_url": "https://api.sambanova.ai/v1",
        "key_env": "SAMBANOVA_API_KEY",
        "signup_url": "https://cloud.sambanova.ai/apis",
        "free": "all",
        "free_tier": "Small free allowance (about 20 requests/day).",
    },
    # ── On this computer ──────────────────────────────────────────
    "ollama": {
        "name": "Ollama",
        "base_url": "http://localhost:11434/v1",
        "key_env": "OLLAMA_API_KEY",
        "requires_key": False,
        "local": True,
        "signup_url": "https://ollama.com/download",
        "free": "all",
        "free_tier": "Runs models on this computer: free, private and works offline. Needs Ollama installed and running.",
    },
    "lmstudio": {
        "name": "LM Studio",
        "base_url": "http://localhost:1234/v1",
        "key_env": "LMSTUDIO_API_KEY",
        "requires_key": False,
        "local": True,
        "signup_url": "https://lmstudio.ai",
        "free": "all",
        "free_tier": "Runs models on this computer: free, private and works offline. Start LM Studio's local server first.",
    },
    # ── Paid / trial ──────────────────────────────────────────────
    "cerebras": {
        "name": "Cerebras",
        "base_url": "https://api.cerebras.ai/v1",
        "key_env": "CEREBRAS_API_KEY",
        "signup_url": "https://cloud.cerebras.ai",
        "free": "none",
        "free_tier": "Trial only: needs a card. Extremely fast.",
    },
    "huggingface": {
        "name": "Hugging Face",
        "base_url": "https://router.huggingface.co/v1",
        "key_env": "HF_TOKEN",
        "signup_url": "https://huggingface.co/settings/tokens",
        "free": "none",
        "free_tier": "A few cents of monthly credit, then pay as you go.",
    },
    "together": {
        "name": "Together AI",
        "base_url": "https://api.together.xyz/v1",
        "key_env": "TOGETHER_API_KEY",
        "signup_url": "https://api.together.ai/settings/api-keys",
        "free": "none",
        "free_tier": "Pay as you go.",
    },
    "deepinfra": {
        "name": "DeepInfra",
        "base_url": "https://api.deepinfra.com/v1/openai",
        "key_env": "DEEPINFRA_API_KEY",
        "signup_url": "https://deepinfra.com/dash/api_keys",
        "free": "none",
        "free_tier": "Pay as you go.",
    },
    "fireworks": {
        "name": "Fireworks AI",
        "base_url": "https://api.fireworks.ai/inference/v1",
        "key_env": "FIREWORKS_API_KEY",
        "signup_url": "https://fireworks.ai/account/api-keys",
        "free": "none",
        "free_tier": "Pay as you go.",
    },
    "deepseek": {
        "name": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
        "key_env": "DEEPSEEK_API_KEY",
        "signup_url": "https://platform.deepseek.com/api_keys",
        "free": "none",
        "free_tier": "Pay as you go (low prices).",
    },
    "openai": {
        "name": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "key_env": "OPENAI_API_KEY",
        "signup_url": "https://platform.openai.com/api-keys",
        "free": "none",
        "free_tier": "Pay as you go.",
    },
    "xai": {
        "name": "xAI",
        "base_url": "https://api.x.ai/v1",
        "key_env": "XAI_API_KEY",
        "signup_url": "https://console.x.ai",
        "free": "none",
        "free_tier": "Pay as you go.",
    },
}
