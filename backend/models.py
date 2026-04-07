import sqlalchemy
import sqlalchemy.orm
from database import Base


class User(Base):
    __tablename__ = "users"
    id = sqlalchemy.Column(sqlalchemy.Integer, primary_key=True, index=True)
    username = sqlalchemy.Column(sqlalchemy.String, unique=True, index=True)
    password = sqlalchemy.Column(sqlalchemy.String)
    chats = sqlalchemy.orm.relationship("Chat", back_populates="owner", cascade="all, delete")
    quiz_sessions = sqlalchemy.orm.relationship("QuizSession", back_populates="owner", cascade="all, delete")
    flashcard_decks = sqlalchemy.orm.relationship("FlashcardDeck", back_populates="owner", cascade="all, delete")
    notes = sqlalchemy.orm.relationship("Note", back_populates="owner", cascade="all, delete")


class Chat(Base):
    __tablename__ = "chats"
    id = sqlalchemy.Column(sqlalchemy.Integer, primary_key=True, index=True)
    title = sqlalchemy.Column(sqlalchemy.String, default="New Chat")
    user_id = sqlalchemy.Column(sqlalchemy.Integer, sqlalchemy.ForeignKey("users.id"))
    owner = sqlalchemy.orm.relationship("User", back_populates="chats")
    messages = sqlalchemy.orm.relationship("Message", back_populates="chat", cascade="all, delete")


class Message(Base):
    __tablename__ = "messages"
    id = sqlalchemy.Column(sqlalchemy.Integer, primary_key=True, index=True)
    role = sqlalchemy.Column(sqlalchemy.String)
    content = sqlalchemy.Column(sqlalchemy.Text)
    chat_id = sqlalchemy.Column(sqlalchemy.Integer, sqlalchemy.ForeignKey("chats.id"))
    chat = sqlalchemy.orm.relationship("Chat", back_populates="messages")


# ─── QUIZ ─────────────────────────────────────────────────────────────
class QuizSession(Base):
    """One quiz attempt = one session."""
    __tablename__ = "quiz_sessions"
    id = sqlalchemy.Column(sqlalchemy.Integer, primary_key=True, index=True)
    title = sqlalchemy.Column(sqlalchemy.String, default="Quiz")          # e.g. "Photosynthesis — Medium"
    topic = sqlalchemy.Column(sqlalchemy.String)
    difficulty = sqlalchemy.Column(sqlalchemy.String)
    score = sqlalchemy.Column(sqlalchemy.Integer, default=0)
    total = sqlalchemy.Column(sqlalchemy.Integer, default=0)
    user_id = sqlalchemy.Column(sqlalchemy.Integer, sqlalchemy.ForeignKey("users.id"))
    created_at = sqlalchemy.Column(sqlalchemy.DateTime, default=sqlalchemy.func.now())
    owner = sqlalchemy.orm.relationship("User", back_populates="quiz_sessions")
    questions = sqlalchemy.orm.relationship("QuizQuestion", back_populates="session", cascade="all, delete")


class QuizQuestion(Base):
    """Individual Q&A stored per session."""
    __tablename__ = "quiz_questions"
    id = sqlalchemy.Column(sqlalchemy.Integer, primary_key=True, index=True)
    question = sqlalchemy.Column(sqlalchemy.Text)
    options = sqlalchemy.Column(sqlalchemy.Text)   # JSON-encoded list
    answer = sqlalchemy.Column(sqlalchemy.String)
    user_answer = sqlalchemy.Column(sqlalchemy.String, default="")
    is_correct = sqlalchemy.Column(sqlalchemy.Boolean, default=False)
    session_id = sqlalchemy.Column(sqlalchemy.Integer, sqlalchemy.ForeignKey("quiz_sessions.id"))
    session = sqlalchemy.orm.relationship("QuizSession", back_populates="questions")


# ─── FLASHCARDS ────────────────────────────────────────────────────────
class FlashcardDeck(Base):
    """A named set of flashcards."""
    __tablename__ = "flashcard_decks"
    id = sqlalchemy.Column(sqlalchemy.Integer, primary_key=True, index=True)
    title = sqlalchemy.Column(sqlalchemy.String, default="New Deck")
    topic = sqlalchemy.Column(sqlalchemy.String, default="")
    user_id = sqlalchemy.Column(sqlalchemy.Integer, sqlalchemy.ForeignKey("users.id"))
    created_at = sqlalchemy.Column(sqlalchemy.DateTime, default=sqlalchemy.func.now())
    owner = sqlalchemy.orm.relationship("User", back_populates="flashcard_decks")
    cards = sqlalchemy.orm.relationship("Flashcard", back_populates="deck", cascade="all, delete")


class Flashcard(Base):
    __tablename__ = "flashcards"
    id = sqlalchemy.Column(sqlalchemy.Integer, primary_key=True, index=True)
    front = sqlalchemy.Column(sqlalchemy.Text)   # question / term
    back = sqlalchemy.Column(sqlalchemy.Text)    # answer / definition
    deck_id = sqlalchemy.Column(sqlalchemy.Integer, sqlalchemy.ForeignKey("flashcard_decks.id"))
    deck = sqlalchemy.orm.relationship("FlashcardDeck", back_populates="cards")


# ─── NOTES ─────────────────────────────────────────────────────────────
class Note(Base):
    __tablename__ = "notes"
    id = sqlalchemy.Column(sqlalchemy.Integer, primary_key=True, index=True)
    title = sqlalchemy.Column(sqlalchemy.String, default="Untitled Note")
    content = sqlalchemy.Column(sqlalchemy.Text, default="")
    user_id = sqlalchemy.Column(sqlalchemy.Integer, sqlalchemy.ForeignKey("users.id"))
    updated_at = sqlalchemy.Column(
        sqlalchemy.DateTime,
        default=sqlalchemy.func.now(),
        onupdate=sqlalchemy.func.now(),
    )
    owner = sqlalchemy.orm.relationship("User", back_populates="notes")