from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional

from database import SessionLocal, engine
import models
from auth import hash_password, verify_password

import google.generativeai as genai
from google.api_core.exceptions import ResourceExhausted
import re
import json

# =========================
# GEMINI CONFIG
# =========================
genai.configure(api_key="AIzaSyCr9fx-LRN8uG6o7xSoWUZ98km8-tkJMJ4")

model = genai.GenerativeModel("gemini-2.5-flash")

chat_session = model.start_chat(
    history=[
        {
            "role": "user",
            "parts": [
                """
You are Zyqra AI, an advanced intelligent tutor.

Explain concepts clearly, like a human teacher.
Use:
- Simple explanations
- Examples
- Step-by-step breakdown
- Friendly tone

Avoid robotic or copy-paste style.
Make responses engaging and natural.
"""
            ],
        }
    ]
)

# =========================
# APP INIT
# =========================
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

models.Base.metadata.create_all(bind=engine)


# =========================
# SCHEMAS
# =========================
class UserRequest(BaseModel):
    username: str
    password: str


class ChatPayload(BaseModel):
    message: str
    chat_id: int


class QuizRequest(BaseModel):
    topic: str
    count: int = 10
    difficulty: str = "Medium"


class QuizSubmit(BaseModel):
    quiz: List[dict]
    answers: List[str]
    user_id: int = 1


class FlashcardRequest(BaseModel):
    topic: str
    count: int = 10
    user_id: int = 1


class FlashcardFromWrongRequest(BaseModel):
    wrong_questions: List[dict]   # [{question, answer}, ...]
    topic: str
    user_id: int = 1


class NoteCreate(BaseModel):
    title: str = "Untitled Note"
    content: str = ""
    user_id: int = 1


class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None


# =========================
# DB DEPENDENCY
# =========================
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# =========================
# ROOT
# =========================
@app.get("/")
def root():
    return {"message": "Zyqra API running 🚀"}


# =========================
# SIGNUP / LOGIN
# =========================
@app.post("/signup")
def signup(user: UserRequest, db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(models.User.username == user.username).first()
    if existing:
        return {"status": "error", "message": "User already exists"}
    new_user = models.User(username=user.username, password=hash_password(user.password))
    db.add(new_user)
    db.commit()
    return {"status": "success", "message": "User created"}


@app.post("/login")
def login(user: UserRequest, db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(models.User.username == user.username).first()
    if not existing:
        return {"status": "error", "message": "User not found"}
    if not verify_password(user.password, existing.password):
        return {"status": "error", "message": "Wrong password"}
    return {"status": "success", "username": existing.username}


# =========================
# AI RESPONSE HELPER
# =========================
def generate_ai(prompt: str) -> str:
    try:
        response = chat_session.send_message(prompt)
        return response.text
    except ResourceExhausted:
        return "⚠ API limit reached. Please try again later."
    except Exception as e:
        return f"Error: {str(e)}"


# =========================
# CHAT
# =========================
@app.post("/chat")
def chat(req: ChatPayload, db: Session = Depends(get_db)):
    chat_obj = db.query(models.Chat).filter(models.Chat.id == req.chat_id).first()
    if not chat_obj:
        return {"error": "Chat not found"}
    db.add(models.Message(role="user", content=req.message, chat_id=req.chat_id))
    reply = generate_ai(req.message)
    db.add(models.Message(role="ai", content=reply, chat_id=req.chat_id))
    if chat_obj.title == "New Chat":
        chat_obj.title = req.message[:40]
    db.commit()
    return {"reply": reply}


@app.get("/get_messages/{chat_id}")
def get_messages(chat_id: int, db: Session = Depends(get_db)):
    msgs = db.query(models.Message).filter(models.Message.chat_id == chat_id).all()
    return [{"role": m.role, "text": m.content} for m in msgs]


@app.post("/create_chat")
def create_chat(user_id: int, db: Session = Depends(get_db)):
    chat_obj = models.Chat(user_id=user_id)
    db.add(chat_obj)
    db.commit()
    db.refresh(chat_obj)
    return {"chat_id": chat_obj.id}


@app.get("/get_chats/{user_id}")
def get_chats(user_id: int, db: Session = Depends(get_db)):
    chats = db.query(models.Chat).filter(models.Chat.user_id == user_id).order_by(models.Chat.id.desc()).all()
    return [{"id": c.id, "title": c.title} for c in chats]


@app.delete("/delete_chat/{chat_id}")
def delete_chat(chat_id: int, db: Session = Depends(get_db)):
    chat_obj = db.query(models.Chat).filter(models.Chat.id == chat_id).first()
    if not chat_obj:
        return {"error": "Chat not found"}
    db.delete(chat_obj)
    db.commit()
    return {"message": "Deleted"}


@app.put("/rename_chat/{chat_id}")
def rename_chat(chat_id: int, title: str, db: Session = Depends(get_db)):
    chat_obj = db.query(models.Chat).filter(models.Chat.id == chat_id).first()
    if not chat_obj:
        return {"error": "Chat not found"}
    chat_obj.title = title
    db.commit()
    return {"message": "Renamed"}


# =========================
# QUIZ HELPERS
# =========================
def extract_json_array(text: str) -> list:
    text = re.sub(r"```(?:json)?\s*", "", text)
    text = re.sub(r"```", "", text)
    text = text.strip()
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return parsed
    except json.JSONDecodeError:
        pass
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            pass
    return []


def validate_questions(raw: list) -> list:
    valid = []
    for q in raw:
        if not isinstance(q, dict):
            continue
        question = q.get("question", "").strip()
        options = q.get("options", [])
        answer = q.get("answer", "").strip()
        if question and isinstance(options, list) and len(options) >= 2 and answer and answer in options:
            valid.append({"question": question, "options": options, "answer": answer})
    return valid


# =========================
# QUIZ — GENERATE
# =========================
@app.post("/generate_quiz")
def generate_quiz(req: QuizRequest):
    if not req.topic.strip():
        return {"error": "Topic cannot be empty", "quiz": []}
    count = max(1, min(req.count, 30))
    difficulty = req.difficulty if req.difficulty in ("Easy", "Medium", "Hard") else "Medium"

    prompt = f"""
You are a quiz generator. Generate exactly {count} multiple choice questions about: "{req.topic}".
Difficulty: {difficulty}

Respond ONLY with a valid JSON array. No markdown, no extra text.

[
  {{
    "question": "...",
    "options": ["A", "B", "C", "D"],
    "answer": "A"
  }}
]

Rules:
- Exactly 4 options per question.
- "answer" must exactly match one option string.
- No text outside JSON.
"""
    try:
        response = model.generate_content(prompt)
        raw_list = extract_json_array(response.text)
        questions = validate_questions(raw_list)
        if not questions:
            return {"error": "AI returned invalid quiz data.", "quiz": []}
        return {"quiz": questions}
    except ResourceExhausted:
        return {"error": "API rate limit reached.", "quiz": []}
    except Exception as e:
        return {"error": f"Server error: {str(e)}", "quiz": []}


# =========================
# QUIZ — SUBMIT & SAVE HISTORY
# =========================
@app.post("/submit_quiz")
def submit_quiz(req: QuizSubmit, db: Session = Depends(get_db)):
    if not req.quiz:
        return {"error": "No quiz data provided"}

    answers = list(req.answers)
    while len(answers) < len(req.quiz):
        answers.append("")

    score = 0
    results = []
    wrong_questions = []

    for i, q in enumerate(req.quiz):
        correct = q.get("answer", "")
        user_ans = answers[i] if i < len(answers) else ""
        is_correct = correct.strip() == user_ans.strip() and user_ans.strip() != ""
        if is_correct:
            score += 1
        else:
            wrong_questions.append({"question": q.get("question", ""), "answer": correct})
        results.append({
            "question": q.get("question", ""),
            "correct": correct,
            "your": user_ans,
            "is_correct": is_correct,
        })

    # ── Save session to DB ─────────────────────────────
    topic = req.quiz[0].get("topic", "Quiz") if req.quiz else "Quiz"
    # Try to extract topic from context (passed as metadata or inferred)
    # We'll rely on frontend sending it; fall back to "Quiz"
    session_title = f"Quiz · {len(req.quiz)} Qs"

    session = models.QuizSession(
        title=session_title,
        topic="",           # frontend can send topic separately — see below
        difficulty="",
        score=score,
        total=len(req.quiz),
        user_id=req.user_id,
    )
    db.add(session)
    db.flush()  # get session.id

    for i, q in enumerate(req.quiz):
        db.add(models.QuizQuestion(
            question=q.get("question", ""),
            options=json.dumps(q.get("options", [])),
            answer=q.get("answer", ""),
            user_answer=answers[i] if i < len(answers) else "",
            is_correct=results[i]["is_correct"],
            session_id=session.id,
        ))

    db.commit()

    return {
        "score": score,
        "total": len(req.quiz),
        "percentage": round((score / len(req.quiz)) * 100) if req.quiz else 0,
        "results": results,
        "wrong_questions": wrong_questions,
        "session_id": session.id,
    }


# ── Update session with topic/difficulty after we know it ──
@app.put("/quiz_session/{session_id}")
def update_quiz_session(session_id: int, topic: str = "", difficulty: str = "", db: Session = Depends(get_db)):
    s = db.query(models.QuizSession).filter(models.QuizSession.id == session_id).first()
    if not s:
        return {"error": "Not found"}
    if topic:
        s.topic = topic
        s.title = f"{topic[:30]} — {difficulty or s.difficulty}"
    if difficulty:
        s.difficulty = difficulty
    db.commit()
    return {"message": "Updated"}


# =========================
# QUIZ HISTORY
# =========================
@app.get("/quiz_sessions/{user_id}")
def get_quiz_sessions(user_id: int, db: Session = Depends(get_db)):
    sessions = (
        db.query(models.QuizSession)
        .filter(models.QuizSession.user_id == user_id)
        .order_by(models.QuizSession.id.desc())
        .all()
    )
    return [
        {
            "id": s.id,
            "title": s.title,
            "topic": s.topic,
            "difficulty": s.difficulty,
            "score": s.score,
            "total": s.total,
        }
        for s in sessions
    ]


@app.get("/quiz_session_detail/{session_id}")
def get_quiz_session_detail(session_id: int, db: Session = Depends(get_db)):
    s = db.query(models.QuizSession).filter(models.QuizSession.id == session_id).first()
    if not s:
        return {"error": "Not found"}
    questions = [
        {
            "question": q.question,
            "options": json.loads(q.options) if q.options else [],
            "answer": q.answer,
            "user_answer": q.user_answer,
            "is_correct": q.is_correct,
        }
        for q in s.questions
    ]
    return {
        "id": s.id,
        "title": s.title,
        "topic": s.topic,
        "difficulty": s.difficulty,
        "score": s.score,
        "total": s.total,
        "questions": questions,
    }


@app.delete("/quiz_session/{session_id}")
def delete_quiz_session(session_id: int, db: Session = Depends(get_db)):
    s = db.query(models.QuizSession).filter(models.QuizSession.id == session_id).first()
    if not s:
        return {"error": "Not found"}
    db.delete(s)
    db.commit()
    return {"message": "Deleted"}


@app.put("/rename_quiz_session/{session_id}")
def rename_quiz_session(session_id: int, title: str, db: Session = Depends(get_db)):
    s = db.query(models.QuizSession).filter(models.QuizSession.id == session_id).first()
    if not s:
        return {"error": "Not found"}
    s.title = title
    db.commit()
    return {"message": "Renamed"}


# =========================
# FLASHCARDS — GENERATE (manual topic)
# =========================
@app.post("/generate_flashcards")
def generate_flashcards(req: FlashcardRequest, db: Session = Depends(get_db)):
    if not req.topic.strip():
        return {"error": "Topic cannot be empty", "deck_id": None}

    count = max(1, min(req.count, 50))

    prompt = f"""
Create exactly {count} flashcards about: "{req.topic}".

Respond ONLY with a JSON array. No markdown, no extra text.

[
  {{ "front": "Term or question", "back": "Definition or answer" }}
]

Rules:
- front: concise term or question (under 20 words)
- back: clear explanation (1-3 sentences)
- No text outside JSON.
"""
    try:
        response = model.generate_content(prompt)
        raw = extract_json_array(response.text)
        cards = [c for c in raw if isinstance(c, dict) and c.get("front") and c.get("back")]

        if not cards:
            return {"error": "AI returned invalid flashcard data.", "deck_id": None}

        deck = models.FlashcardDeck(
            title=req.topic[:50],
            topic=req.topic,
            user_id=req.user_id,
        )
        db.add(deck)
        db.flush()

        for c in cards:
            db.add(models.Flashcard(front=c["front"], back=c["back"], deck_id=deck.id))

        db.commit()
        db.refresh(deck)

        return {
            "deck_id": deck.id,
            "title": deck.title,
            "cards": [{"front": c["front"], "back": c["back"]} for c in cards],
        }

    except ResourceExhausted:
        return {"error": "API rate limit reached.", "deck_id": None}
    except Exception as e:
        return {"error": f"Server error: {str(e)}", "deck_id": None}


# =========================
# FLASHCARDS — FROM WRONG ANSWERS
# =========================
@app.post("/flashcards_from_wrong")
def flashcards_from_wrong(req: FlashcardFromWrongRequest, db: Session = Depends(get_db)):
    if not req.wrong_questions:
        return {"error": "No wrong questions provided", "deck_id": None}

    pairs = "\n".join(
        f'Q: {q["question"]}\nA: {q["answer"]}' for q in req.wrong_questions
    )

    prompt = f"""
Convert these quiz Q&A pairs into concise flashcards.

{pairs}

Respond ONLY with a JSON array. No markdown, no extra text.

[
  {{ "front": "Question or term", "back": "Answer or definition" }}
]
"""
    try:
        response = model.generate_content(prompt)
        raw = extract_json_array(response.text)
        cards = [c for c in raw if isinstance(c, dict) and c.get("front") and c.get("back")]

        if not cards:
            # Fallback: use raw wrong questions directly
            cards = [{"front": q["question"], "back": q["answer"]} for q in req.wrong_questions]

        deck_title = f"Missed — {req.topic[:30]}"
        deck = models.FlashcardDeck(
            title=deck_title,
            topic=req.topic,
            user_id=req.user_id,
        )
        db.add(deck)
        db.flush()

        for c in cards:
            db.add(models.Flashcard(front=c["front"], back=c["back"], deck_id=deck.id))

        db.commit()
        db.refresh(deck)

        return {
            "deck_id": deck.id,
            "title": deck.title,
            "cards": [{"front": c["front"], "back": c["back"]} for c in cards],
        }

    except Exception as e:
        return {"error": f"Server error: {str(e)}", "deck_id": None}


# =========================
# FLASHCARD DECKS HISTORY
# =========================
@app.get("/flashcard_decks/{user_id}")
def get_flashcard_decks(user_id: int, db: Session = Depends(get_db)):
    decks = (
        db.query(models.FlashcardDeck)
        .filter(models.FlashcardDeck.user_id == user_id)
        .order_by(models.FlashcardDeck.id.desc())
        .all()
    )
    return [{"id": d.id, "title": d.title, "topic": d.topic, "card_count": len(d.cards)} for d in decks]


@app.get("/flashcard_deck/{deck_id}")
def get_flashcard_deck(deck_id: int, db: Session = Depends(get_db)):
    deck = db.query(models.FlashcardDeck).filter(models.FlashcardDeck.id == deck_id).first()
    if not deck:
        return {"error": "Not found"}
    return {
        "id": deck.id,
        "title": deck.title,
        "topic": deck.topic,
        "cards": [{"id": c.id, "front": c.front, "back": c.back} for c in deck.cards],
    }


@app.delete("/flashcard_deck/{deck_id}")
def delete_flashcard_deck(deck_id: int, db: Session = Depends(get_db)):
    deck = db.query(models.FlashcardDeck).filter(models.FlashcardDeck.id == deck_id).first()
    if not deck:
        return {"error": "Not found"}
    db.delete(deck)
    db.commit()
    return {"message": "Deleted"}


@app.put("/rename_flashcard_deck/{deck_id}")
def rename_flashcard_deck(deck_id: int, title: str, db: Session = Depends(get_db)):
    deck = db.query(models.FlashcardDeck).filter(models.FlashcardDeck.id == deck_id).first()
    if not deck:
        return {"error": "Not found"}
    deck.title = title
    db.commit()
    return {"message": "Renamed"}


# =========================
# NOTES
# =========================
@app.post("/create_note")
def create_note(req: NoteCreate, db: Session = Depends(get_db)):
    note = models.Note(title=req.title, content=req.content, user_id=req.user_id)
    db.add(note)
    db.commit()
    db.refresh(note)
    return {"id": note.id, "title": note.title, "content": note.content}


@app.get("/notes/{user_id}")
def get_notes(user_id: int, db: Session = Depends(get_db)):
    notes = (
        db.query(models.Note)
        .filter(models.Note.user_id == user_id)
        .order_by(models.Note.id.desc())
        .all()
    )
    return [{"id": n.id, "title": n.title, "content": n.content} for n in notes]


@app.get("/note/{note_id}")
def get_note(note_id: int, db: Session = Depends(get_db)):
    note = db.query(models.Note).filter(models.Note.id == note_id).first()
    if not note:
        return {"error": "Not found"}
    return {"id": note.id, "title": note.title, "content": note.content}


@app.put("/note/{note_id}")
def update_note(note_id: int, req: NoteUpdate, db: Session = Depends(get_db)):
    note = db.query(models.Note).filter(models.Note.id == note_id).first()
    if not note:
        return {"error": "Not found"}
    if req.title is not None:
        note.title = req.title
    if req.content is not None:
        note.content = req.content
    db.commit()
    return {"message": "Updated"}


@app.delete("/note/{note_id}")
def delete_note(note_id: int, db: Session = Depends(get_db)):
    note = db.query(models.Note).filter(models.Note.id == note_id).first()
    if not note:
        return {"error": "Not found"}
    db.delete(note)
    db.commit()
    return {"message": "Deleted"}


@app.put("/rename_note/{note_id}")
def rename_note(note_id: int, title: str, db: Session = Depends(get_db)):
    note = db.query(models.Note).filter(models.Note.id == note_id).first()
    if not note:
        return {"error": "Not found"}
    note.title = title
    db.commit()
    return {"message": "Renamed"}