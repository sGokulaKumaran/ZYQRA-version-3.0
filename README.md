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
  ai_models.json       the AI fallback chain — edit this to add models
  .env.example         copy to .env and add your API keys
  app/
    main.py            app factory, CORS, error handlers
    config.py          settings from the environment
    database.py        engine, sessions, additive migrations
    models.py          SQLAlchemy models
    security.py        password hashing, JWT, current-user dependency
    ai/                fallback engine, prompts, JSON parsing
    routers/           auth, chats, quiz, flashcards, notes, planner, dashboard, system
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
copy .env.example .env        # then add at least one API key
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

## The AI fallback chain

Every AI request walks the list in `backend/ai_models.json` from the top — best model first,
smallest last — and uses the first model that answers.

- A model that returns a rate-limit error is put on **cooldown** for as long as the provider
  says (or an increasing back-off if it doesn't say) and the next model takes over.
- A daily quota error cools the model until the provider's daily reset, re-checking hourly.
- When the cooldown ends the model is used again, so traffic **returns to the best model
  automatically**.
- Providers with no key in `.env` are skipped, so unused entries are harmless.

Live status, per-model **Test** buttons and each provider's current model list are in
**Settings → AI models**.

### Adding a model

Add one line to `"chain"` in `ai_models.json`, at the position it should be tried:

```json
{ "provider": "groq", "model": "openai/gpt-oss-120b", "label": "GPT-OSS 120B (Groq)", "tier": "strong" }
```

### Adding a provider

Any OpenAI-compatible API works. Add it to `"providers"`, put its key in `.env`, then list
its models in `"chain"`:

```json
"myprovider": {
  "name": "My Provider",
  "base_url": "https://api.example.com/v1",
  "key_env": "MYPROVIDER_API_KEY"
}
```

Both files are re-read when they change — no restart needed. One key variable may hold
several comma-separated keys; each is tried in turn.

## Notes

- `backend/.env`, the SQLite database and `backend/.secret_key` are git-ignored. Never commit API keys.
- The database upgrades itself in place on startup (columns and tables are only ever added).
- Model ids and free-tier limits change often. If a model shows "Not listed by provider"
  in Settings, pick a current id from that provider's model list and update `ai_models.json`.
