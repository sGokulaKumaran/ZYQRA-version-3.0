"""SQLAlchemy models. All timestamps are naive UTC."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    password = Column(String)
    daily_goal_minutes = Column(Integer, default=60)
    created_at = Column(DateTime, default=utcnow)

    chats = relationship("Chat", back_populates="owner", cascade="all, delete")
    quiz_sessions = relationship("QuizSession", back_populates="owner", cascade="all, delete")
    flashcard_decks = relationship("FlashcardDeck", back_populates="owner", cascade="all, delete")
    notes = relationship("Note", back_populates="owner", cascade="all, delete")
    tasks = relationship("Task", back_populates="owner", cascade="all, delete")
    focus_sessions = relationship("FocusSession", back_populates="owner", cascade="all, delete")


# ─── Chat ──────────────────────────────────────────────────────────────
class Chat(Base):
    __tablename__ = "chats"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, default="New chat")
    mode = Column(String, default="tutor")
    pinned = Column(Boolean, default=False)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow)

    owner = relationship("User", back_populates="chats")
    messages = relationship(
        "Message", back_populates="chat", cascade="all, delete", order_by="Message.id"
    )


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    role = Column(String)  # "user" | "ai"
    content = Column(Text)
    model = Column(String)  # label of the model that answered (AI messages only)
    provider = Column(String)
    chat_id = Column(Integer, ForeignKey("chats.id"), index=True)
    created_at = Column(DateTime, default=utcnow)

    chat = relationship("Chat", back_populates="messages")


# ─── Quiz ──────────────────────────────────────────────────────────────
class QuizSession(Base):
    """One completed quiz attempt."""

    __tablename__ = "quiz_sessions"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, default="Quiz")
    topic = Column(String)
    difficulty = Column(String)
    score = Column(Integer, default=0)
    total = Column(Integer, default=0)
    duration_seconds = Column(Integer, default=0)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    created_at = Column(DateTime, default=utcnow)

    owner = relationship("User", back_populates="quiz_sessions")
    questions = relationship(
        "QuizQuestion", back_populates="session", cascade="all, delete", order_by="QuizQuestion.id"
    )


class QuizQuestion(Base):
    __tablename__ = "quiz_questions"

    id = Column(Integer, primary_key=True, index=True)
    question = Column(Text)
    options = Column(Text)  # JSON-encoded list
    answer = Column(String)
    explanation = Column(Text, default="")
    user_answer = Column(String, default="")
    is_correct = Column(Boolean, default=False)
    session_id = Column(Integer, ForeignKey("quiz_sessions.id"), index=True)

    session = relationship("QuizSession", back_populates="questions")


# ─── Flashcards ────────────────────────────────────────────────────────
class FlashcardDeck(Base):
    __tablename__ = "flashcard_decks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, default="New deck")
    topic = Column(String, default="")
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    created_at = Column(DateTime, default=utcnow)

    owner = relationship("User", back_populates="flashcard_decks")
    cards = relationship(
        "Flashcard", back_populates="deck", cascade="all, delete", order_by="Flashcard.id"
    )


class Flashcard(Base):
    __tablename__ = "flashcards"

    id = Column(Integer, primary_key=True, index=True)
    front = Column(Text)
    back = Column(Text)
    deck_id = Column(Integer, ForeignKey("flashcard_decks.id"), index=True)

    # Spaced repetition (SM-2). due_at NULL means the card has never been studied.
    ease = Column(Float, default=2.5)
    interval_days = Column(Integer, default=0)
    repetitions = Column(Integer, default=0)
    lapses = Column(Integer, default=0)
    due_at = Column(DateTime)
    last_reviewed_at = Column(DateTime)

    deck = relationship("FlashcardDeck", back_populates="cards")


class CardReview(Base):
    """One rating of one card — the raw log behind streaks and the heatmap."""

    __tablename__ = "card_reviews"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    card_id = Column(Integer, index=True)
    rating = Column(String)
    created_at = Column(DateTime, default=utcnow)


# ─── Notes ─────────────────────────────────────────────────────────────
class Note(Base):
    __tablename__ = "notes"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, default="Untitled note")
    content = Column(Text, default="")
    pinned = Column(Boolean, default=False)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)

    owner = relationship("User", back_populates="notes")


# ─── Planner ───────────────────────────────────────────────────────────
class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    details = Column(Text, default="")
    subject = Column(String, default="")
    priority = Column(String, default="medium")  # low | medium | high
    due_date = Column(Date)
    done = Column(Boolean, default=False)
    completed_at = Column(DateTime)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    created_at = Column(DateTime, default=utcnow)

    owner = relationship("User", back_populates="tasks")


# ─── Focus timer ───────────────────────────────────────────────────────
class FocusSession(Base):
    __tablename__ = "focus_sessions"

    id = Column(Integer, primary_key=True, index=True)
    minutes = Column(Integer, default=0)
    label = Column(String, default="")
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    created_at = Column(DateTime, default=utcnow)

    owner = relationship("User", back_populates="focus_sessions")
