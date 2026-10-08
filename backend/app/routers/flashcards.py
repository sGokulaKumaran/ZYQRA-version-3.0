from __future__ import annotations

from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import models
from ..ai import engine, prompts
from ..ai.parsing import extract_json_array
from ..common import iso, owned, resolve_source
from ..database import get_db
from ..models import utcnow
from ..security import get_current_user

router = APIRouter(prefix="/api/flashcards", tags=["flashcards"])

Rating = Literal["again", "hard", "good", "easy"]

MIN_EASE = 1.3
RELEARN_DELAY = timedelta(minutes=10)


class DeckCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    topic: str = ""


class DeckUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=120)


class GenerateRequest(BaseModel):
    topic: str = Field(default="", max_length=300)
    count: int = Field(default=10, ge=1, le=50)
    note_id: int | None = None
    source_text: str = ""
    deck_id: int | None = None  # add to an existing deck instead of creating one


class Mistake(BaseModel):
    question: str
    answer: str


class MistakesRequest(BaseModel):
    topic: str = ""
    items: list[Mistake] = Field(min_length=1, max_length=60)


class CardBody(BaseModel):
    front: str = Field(min_length=1, max_length=2000)
    back: str = Field(min_length=1, max_length=4000)


class Review(BaseModel):
    rating: Rating


def card_out(card: models.Flashcard) -> dict:
    now = utcnow()
    return {
        "id": card.id,
        "front": card.front,
        "back": card.back,
        "is_new": card.due_at is None,
        "is_due": card.due_at is None or card.due_at <= now,
        "due_at": iso(card.due_at),
        "interval_days": card.interval_days or 0,
        "repetitions": card.repetitions or 0,
        # Days until the next review for each rating, shown on the rating buttons.
        "next_days": {
            rating: next_state(card.ease or 2.5, card.interval_days or 0, card.repetitions or 0, rating)[1]
            for rating in ("hard", "good", "easy")
        },
    }


def deck_out(deck: models.FlashcardDeck, detail: bool = False) -> dict:
    now = utcnow()
    data = {
        "id": deck.id,
        "title": deck.title or "Untitled deck",
        "topic": deck.topic or "",
        "card_count": len(deck.cards),
        "new_count": sum(1 for c in deck.cards if c.due_at is None),
        "due_count": sum(1 for c in deck.cards if c.due_at is not None and c.due_at <= now),
        "created_at": iso(deck.created_at),
    }
    if detail:
        data["cards"] = [card_out(c) for c in deck.cards]
    return data


def _clean_cards(raw: list) -> list[tuple[str, str]]:
    cards = []
    for item in raw:
        if isinstance(item, dict):
            front, back = str(item.get("front", "")).strip(), str(item.get("back", "")).strip()
            if front and back:
                cards.append((front, back))
    return cards


def _owned_card(db: Session, card_id: int, user: models.User) -> models.Flashcard:
    card = db.get(models.Flashcard, card_id)
    if card is None or card.deck is None or card.deck.user_id != user.id:
        raise HTTPException(status_code=404, detail="Card not found.")
    return card


def next_state(ease: float, interval: int, reps: int, rating: Rating) -> tuple[float, int, int]:
    """SM-2 style step: (ease, interval_days, repetitions) after one rating."""
    if rating == "again":
        return max(MIN_EASE, ease - 0.2), 0, 0
    if rating == "hard":
        return max(MIN_EASE, ease - 0.15), max(1, round(interval * 1.2)), reps + 1
    if rating == "good":
        days = 1 if reps == 0 else 3 if reps == 1 else max(interval + 1, round(interval * ease))
        return ease, days, reps + 1
    ease += 0.15
    return ease, (3 if reps == 0 else max(interval + 2, round(interval * ease * 1.3))), reps + 1


def schedule(card: models.Flashcard, rating: Rating) -> None:
    """Grow the interval on success; on "again" relearn the card later this session."""
    now = utcnow()
    card.ease, card.interval_days, card.repetitions = next_state(
        card.ease or 2.5, card.interval_days or 0, card.repetitions or 0, rating
    )
    if rating == "again":
        card.lapses = (card.lapses or 0) + 1
        card.due_at = now + RELEARN_DELAY
    else:
        card.due_at = now + timedelta(days=card.interval_days)
    card.last_reviewed_at = now


# ─── Decks ─────────────────────────────────────────────────────────────
@router.get("/decks")
def list_decks(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    decks = (
        db.query(models.FlashcardDeck)
        .filter(models.FlashcardDeck.user_id == user.id)
        .order_by(models.FlashcardDeck.id.desc())
        .all()
    )
    return [deck_out(d) for d in decks]


@router.post("/decks", status_code=201)
def create_deck(body: DeckCreate, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    deck = models.FlashcardDeck(title=body.title.strip(), topic=body.topic.strip(), user_id=user.id)
    db.add(deck)
    db.commit()
    db.refresh(deck)
    return deck_out(deck, detail=True)


@router.get("/decks/{deck_id}")
def get_deck(deck_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    return deck_out(owned(db, models.FlashcardDeck, deck_id, user, "Deck"), detail=True)


@router.patch("/decks/{deck_id}")
def rename_deck(deck_id: int, body: DeckUpdate, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    deck = owned(db, models.FlashcardDeck, deck_id, user, "Deck")
    deck.title = body.title.strip()
    db.commit()
    return deck_out(deck)


@router.delete("/decks/{deck_id}", status_code=204)
def delete_deck(deck_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(owned(db, models.FlashcardDeck, deck_id, user, "Deck"))
    db.commit()


# ─── AI generation ─────────────────────────────────────────────────────
def _store(db: Session, user: models.User, cards: list[tuple[str, str]], title: str, topic: str,
           deck_id: int | None = None) -> models.FlashcardDeck:
    if deck_id is not None:
        deck = owned(db, models.FlashcardDeck, deck_id, user, "Deck")
    else:
        deck = models.FlashcardDeck(title=title[:120], topic=topic, user_id=user.id)
        db.add(deck)
    for front, back in cards:
        deck.cards.append(models.Flashcard(front=front, back=back))
    db.commit()
    db.refresh(deck)
    return deck


@router.post("/generate", status_code=201)
def generate(body: GenerateRequest, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    source, source_title = resolve_source(db, user, body.note_id, body.source_text)
    topic = body.topic.strip() or source_title
    if not topic and not source:
        raise HTTPException(status_code=422, detail="Enter a topic or choose a note to build cards from.")
    topic = topic or "Study material"

    result = engine.complete(
        [{"role": "user", "content": prompts.flashcards(topic, body.count, source)}], temperature=0.5
    )
    cards = _clean_cards(extract_json_array(result.text))[: body.count]
    if not cards:
        raise HTTPException(status_code=502, detail="The AI returned unusable flashcards. Please try again.")
    deck = _store(db, user, cards, topic, topic, body.deck_id)
    return {**deck_out(deck, detail=True), "added": len(cards), "model": result.meta()}


@router.post("/from-mistakes", status_code=201)
def from_mistakes(body: MistakesRequest, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    pairs = [(m.question, m.answer) for m in body.items]
    result = engine.complete(
        [{"role": "user", "content": prompts.flashcards_from_mistakes(pairs)}], temperature=0.4
    )
    # If the model's output can't be used, the raw question/answer pairs still make valid cards.
    cards = _clean_cards(extract_json_array(result.text)) or pairs
    topic = body.topic.strip()
    deck = _store(db, user, cards, f"Missed · {topic[:60] or 'Quiz'}", topic)
    return {**deck_out(deck, detail=True), "added": len(cards), "model": result.meta()}


# ─── Cards ─────────────────────────────────────────────────────────────
@router.post("/decks/{deck_id}/cards", status_code=201)
def add_card(deck_id: int, body: CardBody, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    deck = owned(db, models.FlashcardDeck, deck_id, user, "Deck")
    card = models.Flashcard(front=body.front.strip(), back=body.back.strip(), deck_id=deck.id)
    db.add(card)
    db.commit()
    db.refresh(card)
    return card_out(card)


@router.patch("/cards/{card_id}")
def edit_card(card_id: int, body: CardBody, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    card = _owned_card(db, card_id, user)
    card.front, card.back = body.front.strip(), body.back.strip()
    db.commit()
    return card_out(card)


@router.delete("/cards/{card_id}", status_code=204)
def delete_card(card_id: int, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(_owned_card(db, card_id, user))
    db.commit()


@router.post("/cards/{card_id}/review")
def review_card(card_id: int, body: Review, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    card = _owned_card(db, card_id, user)
    schedule(card, body.rating)
    db.add(models.CardReview(user_id=user.id, card_id=card.id, rating=body.rating))
    db.commit()
    return card_out(card)
