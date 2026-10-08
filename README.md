# Zyqra

An AI study companion: tutor chat, quizzes, spaced-repetition flashcards, Markdown notes,
a study planner and a focus timer — backed by a multi-provider AI engine that falls back
automatically when a model hits its rate limit.

## Features

| Area | What it does |
|---|---|
| **AI Tutor** | Streaming chat with per-chat memory, five study modes (Tutor, Explain simply, Exam prep, Socratic, Code helper), maths and code rendering, save an answer to Notes or turn it into flashcards |
| **Quizzes** | Multiple-choice quizzes from a topic or from one of your notes, with an explanation for every answer, timing, history, and one-click flashcards from your mistakes |
| **Flashcards** | AI-generated or hand-written decks studied with spaced repetition (Again / Hard / Good / Easy) |
| **Notes** | Markdown editor with autosave, preview and AI tools (summarise, key points, simplify, improve, practice questions) |
| **Planner** | Tasks with due dates, subjects and priorities, plus an AI study plan built from a goal and a deadline |
| **Focus timer** | Draggable Pomodoro timer; finished blocks count toward a daily goal |
| **Dashboard** | Streak, activity heatmap, accuracy trend, weak topics, what to do next |
| **Search** | `Ctrl+K` searches chats, notes, decks, quizzes and tasks, and runs commands |

## Project layout

```
backend/
  main.py              entry point (uvicorn main:app)
  ai_models.json       your AI providers and models (edited from Settings)
  .env.example         copy to .env; API keys are saved here
  app/
    main.py            app factory, CORS, error handlers
    config.py          settings from the environment
    database.py        engine, sessions, additive migrations
    models.py          SQLAlchemy models
    security.py        password hashing, JWT, current-user dependency
    ai/                fallback engine, provider presets, config store, prompts
    routers/           auth, chats, quiz, flashcards, notes, planner, dashboard, ai, admin, system
frontend/
  src/
    components/ui/     Icon family, Button, Modal, Markdown, primitives
    components/layout/ app shell, sidebar, command palette
    context/           auth, theme, app (navigation + AI status), UI (toasts, dialogs)
    features/          one folder per page
    lib/               API client, types, formatting helpers
    styles/            design tokens (themes) and base styles
```

## Running it

**Backend** (Python 3.11+)

```bash
cd backend
pip install -r requirements.txt
copy .env.example .env        # keys can be added later in Settings
uvicorn main:app --reload
```

**Frontend** (Node 20+)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The API runs on http://127.0.0.1:8000 (interactive docs at `/docs`).
To point the frontend at another API, set `VITE_API_URL` in `frontend/.env.local`.

## Accounts and the administrator

The administrator signs in like anyone else, with a username and password you set in
`backend/.env`:

```
ADMIN_USERNAME=admin@zyqra.com
ADMIN_PASSWORD=choose-your-own      # at least 8 characters
```

The account is created, and its password updated, the next time you sign in — no restart.
Nobody else can register that username.

| | Everyone | Administrator |
|---|---|---|
| Use every study feature | yes | yes |
| Choose their own models from the connected providers | yes | edits the default list |
| Connect providers, enter API keys, add models by ID | | yes |
| "Free models only" switch | | yes |
| **Settings → Admin**: accounts and activity, make or remove administrators, set a new password, delete an account, open or close sign-ups | | yes |

## AI providers and models

Open **Settings → AI models**. Nothing here needs a restart.

1. **Add a provider** (administrator). Go to *Providers → Add provider* and type its name
   (Gemini, Groq, NVIDIA NIM, Mistral, OpenRouter, Cloudflare, Ollama, …) or paste the URL
   of any OpenAI-compatible API. Enter the API key.
2. **Choose models** (everyone). Open a provider to see every model it offers, each marked
   **Free** or **Paid** where that is known, and tick the ones you want.
3. **Use them.** Only the models you ticked appear in the chat's model menu, grouped by
   provider. Untick a model to remove it.

The administrator's list is the **default** everyone starts with. As soon as another user
changes anything, they get their own list, which affects only them; *Use the default* puts
it back.

**Free models only** (on by default) stops Zyqra from ever calling a model that is billed,
including as a fallback, for every user.

### Automatic fallback

The model list is also the fallback order. With the chat set to **Auto**, each request tries the
list from the top and uses the first model that answers.

- A model that returns a rate-limit error is put on **cooldown** for as long as the provider
  says (or an increasing back-off if it doesn't say) and the next model takes over.
- A daily quota error cools the model until the provider's daily reset, re-checking hourly.
- When the cooldown ends the model is used again, so traffic **returns to the best model
  automatically**.

Move a model up or down to change its priority, or switch it off without removing it.

### Where things are stored

- API keys go into `backend/.env` and nowhere else. The app never sends a saved key back to
  the browser. One variable may hold several comma-separated keys; each is tried in turn.
- Providers and the model list live in `backend/ai_models.json`, which you can also edit by
  hand. Built-in provider definitions are in `backend/app/ai/presets.py`.
- A user's own model list is stored on their account in the database.

## Notes

- `backend/.env`, the SQLite database and `backend/.secret_key` are git-ignored. Never commit API keys.
- The database upgrades itself in place on startup (columns and tables are only ever added).
- Model ids and free tiers change often. If a model shows "Not offered by provider" in
  Settings, remove it and tick a current one from that provider's list. Free / Paid labels
  follow each provider's published terms — confirm limits in the provider's own console.
