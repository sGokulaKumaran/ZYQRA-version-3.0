import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { PageProps } from "../../components/layout/AppShell";
import SplitView from "../../components/layout/SplitView";
import { Button, IconButton } from "../../components/ui/Button";
import Icon from "../../components/ui/Icon";
import Modal from "../../components/ui/Modal";
import { EmptyState, Loading, Menu, MenuItem, Segmented } from "../../components/ui/primitives";
import { useApp } from "../../context/AppContext";
import { useUI } from "../../context/UIContext";
import { api, errorMessage } from "../../lib/api";
import { plural } from "../../lib/format";
import type { Card, Deck, DeckDetail, Note, Rating } from "../../lib/types";
import "../quiz/quiz.css";
import "./flashcards.css";

type Source = "topic" | "note";
type Tab = "study" | "cards";

const COUNTS = [5, 10, 15, 20, 30];
const QUICK_TOPICS = ["DNA replication", "French Revolution", "React hooks", "Periodic table", "Trigonometry"];

const RATINGS: { value: Rating; label: string; key: string }[] = [
  { value: "again", label: "Again", key: "1" },
  { value: "hard", label: "Hard", key: "2" },
  { value: "good", label: "Good", key: "3" },
  { value: "easy", label: "Easy", key: "4" },
];

function intervalLabel(days: number): string {
  if (days < 1) return "10 min";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${(days / 365).toFixed(1)} y`;
}

function dueLabel(card: Card): string {
  if (card.is_new) return "New";
  if (card.is_due || !card.due_at) return "Due now";
  const days = Math.ceil((new Date(card.due_at).getTime() - Date.now()) / 86_400_000);
  return days <= 1 ? "Due within a day" : `Due in ${intervalLabel(days)}`;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

// ─── Add / edit a card ────────────────────────────────────────
function CardEditor({ card, onSave, onClose }: { card: Card | null; onSave: (front: string, back: string) => Promise<void>; onClose: () => void }) {
  const [front, setFront] = useState(card?.front ?? "");
  const [back, setBack] = useState(card?.back ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    await onSave(front.trim(), back.trim());
    setSaving(false);
  };

  return (
    <Modal title={card ? "Edit card" : "Add a card"} onClose={onClose}>
      <form className="field" style={{ gap: 14 }} onSubmit={submit}>
        <label className="field">
          <span className="label">Front — question or term</span>
          <textarea className="textarea" autoFocus rows={3} value={front} onChange={(e) => setFront(e.target.value)} maxLength={2000} />
        </label>
        <label className="field">
          <span className="label">Back — answer</span>
          <textarea className="textarea" rows={4} value={back} onChange={(e) => setBack(e.target.value)} maxLength={4000} />
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" loading={saving} disabled={!front.trim() || !back.trim()}>{card ? "Save" : "Add card"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Study session ────────────────────────────────────────────
interface StudyProps {
  deck: DeckDetail;
  active: boolean;
  onCardUpdated: (card: Card) => void;
}

function Study({ deck, active, onCardUpdated }: StudyProps) {
  const { toast } = useUI();
  // Mounted per deck (see `key` at the call site), so this starts each deck with its due cards.
  const [queue, setQueue] = useState<Card[]>(() => deck.cards.filter((c) => c.is_due));
  const [position, setPosition] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [practice, setPractice] = useState(false); // review everything, without rescheduling
  const [reviewed, setReviewed] = useState(0);
  const [busy, setBusy] = useState(false);

  const dueCards = useMemo(() => deck.cards.filter((c) => c.is_due), [deck.cards]);

  const begin = useCallback((cards: Card[], practiceMode: boolean) => {
    setQueue(cards);
    setPosition(0);
    setFlipped(false);
    setReviewed(0);
    setPractice(practiceMode);
  }, []);

  const card = queue[position];
  const finished = position >= queue.length;

  const advance = useCallback(() => {
    setFlipped(false);
    setPosition((p) => p + 1);
    setReviewed((n) => n + 1);
  }, []);

  const rate = useCallback(
    async (rating: Rating) => {
      if (!card || busy) return;
      if (practice) {
        if (rating === "again") setQueue((q) => [...q, card]);
        advance();
        return;
      }
      setBusy(true);
      try {
        const updated = await api.post<Card>(`/api/flashcards/cards/${card.id}/review`, { rating });
        onCardUpdated(updated);
        if (rating === "again") setQueue((q) => [...q, updated]); // see it again before the session ends
        advance();
      } catch (err) {
        toast.error(err);
      }
      setBusy(false);
    },
    [card, busy, practice, advance, onCardUpdated, toast],
  );

  useEffect(() => {
    if (!active || !card) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped) {
        const match = RATINGS.find((r) => r.key === event.key);
        if (match) void rate(match.value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, card, flipped, rate]);

  if (deck.cards.length === 0) {
    return <EmptyState icon="cards" title="This deck is empty" text="Add cards yourself or generate some with AI from the menu above." />;
  }

  if (finished || queue.length === 0) {
    const caughtUp = queue.length === 0;
    return (
      <EmptyState
        icon={caughtUp ? "checkCircle" : "trophy"}
        title={caughtUp ? "You're all caught up" : "Session complete"}
        text={
          caughtUp
            ? "No cards are due in this deck right now. Spaced repetition will bring them back at the right time."
            : `You reviewed ${plural(reviewed, "card")}. ${dueCards.length ? `${plural(dueCards.length, "card")} still due.` : "Nothing else is due for now."}`
        }
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {dueCards.length > 0 && <Button variant="primary" icon="play" onClick={() => begin(dueCards, false)}>Review {plural(dueCards.length, "due card")}</Button>}
          <Button icon="repeat" onClick={() => begin(deck.cards, true)}>Practise all {deck.cards.length} cards</Button>
        </div>
      </EmptyState>
    );
  }

  return (
    <div className="study">
      <div className="study-top">
        <span>{practice ? "Practice — not scheduled" : card.is_new ? "New card" : "Review"}</span>
        <div className="progress"><span style={{ width: `${(position / queue.length) * 100}%` }} /></div>
        <span>{position + 1} / {queue.length}</span>
      </div>

      <div className="flip-scene">
        <button type="button" className={`flip-card ${flipped ? "flipped" : ""}`} onClick={() => setFlipped((f) => !f)} aria-label={flipped ? "Show the question" : "Show the answer"}>
          <span className="flip-face front">
            <small>Question</small>
            <span className="flip-text">{card.front}</span>
            <em><kbd className="kbd">Space</kbd> to reveal</em>
          </span>
          <span className="flip-face back">
            <small>Answer</small>
            <span className="flip-text">{card.back}</span>
          </span>
        </button>
      </div>

      <div className="study-actions">
        {!flipped ? (
          <Button variant="primary" size="lg" icon="eye" onClick={() => setFlipped(true)}>Show answer</Button>
        ) : practice ? (
          <>
            <Button size="lg" icon="repeat" onClick={() => void rate("again")}>Still learning</Button>
            <Button variant="primary" size="lg" icon="check" onClick={() => void rate("good")}>Got it</Button>
          </>
        ) : (
          <div className="ratings">
            {RATINGS.map((r) => (
              <button key={r.value} type="button" className={`rating ${r.value}`} disabled={busy} onClick={() => void rate(r.value)}>
                <b>{r.label}</b>
                <span>{intervalLabel(r.value === "again" ? 0 : card.next_days[r.value])}</span>
                <kbd className="kbd">{r.key}</kbd>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function FlashcardsPage({ active }: PageProps) {
  const { intent, takeIntent } = useApp();
  const { toast, confirm, prompt } = useUI();

  const [decks, setDecks] = useState<Deck[]>([]);
  const [deck, setDeck] = useState<DeckDetail | null>(null);
  const [loadingDeck, setLoadingDeck] = useState(false);
  const [tab, setTab] = useState<Tab>("study");
  const [panelOpen, setPanelOpen] = useState(false);

  // generator
  const [source, setSource] = useState<Source>("topic");
  const [topic, setTopic] = useState("");
  const [noteId, setNoteId] = useState<number | null>(null);
  const [count, setCount] = useState(10);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);

  // cards tab
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Card | "new" | null>(null);
  const [addingMore, setAddingMore] = useState(false);

  const loadDecks = useCallback(async () => {
    try {
      setDecks(await api.get<Deck[]>("/api/flashcards/decks"));
    } catch (err) {
      toast.error(err);
    }
  }, [toast]);

  const openDeck = useCallback(async (id: number, nextTab: Tab = "study") => {
    setPanelOpen(false);
    setLoadingDeck(true);
    setSearch("");
    try {
      setDeck(await api.get<DeckDetail>(`/api/flashcards/decks/${id}`));
      setTab(nextTab);
    } catch (err) {
      toast.error(err);
    }
    setLoadingDeck(false);
  }, [toast]);

  useEffect(() => {
    if (!active) return;
    void loadDecks();
    api.get<Note[]>("/api/notes").then(setNotes).catch(() => {});
  }, [active, loadDecks]);

  useEffect(() => {
    if (!active || !intent) return;
    const next = takeIntent();
    if (next?.deckId) void openDeck(next.deckId);
    else if (next?.fromNoteId) {
      setDeck(null);
      setSource("note");
      setNoteId(next.fromNoteId);
    }
  }, [active, intent, takeIntent, openDeck]);

  const showGenerator = () => {
    setDeck(null);
    setError("");
    setPanelOpen(false);
  };

  const canGenerate = source === "topic" ? topic.trim().length > 0 : noteId !== null;

  const generate = async () => {
    if (!canGenerate) return;
    setError("");
    setGenerating(true);
    try {
      const created = await api.post<DeckDetail>("/api/flashcards/generate", {
        topic: topic.trim(),
        count,
        note_id: source === "note" ? noteId : null,
      });
      setDeck(created);
      setTab("study");
      setTopic("");
      void loadDecks();
    } catch (err) {
      setError(errorMessage(err));
    }
    setGenerating(false);
  };

  const createEmpty = async () => {
    const title = await prompt({ title: "New deck", label: "Deck name", placeholder: "e.g. Organic chemistry", confirmLabel: "Create" });
    if (!title) return;
    try {
      const created = await api.post<DeckDetail>("/api/flashcards/decks", { title });
      setDeck(created);
      setTab("cards");
      void loadDecks();
    } catch (err) {
      toast.error(err);
    }
  };

  // Refresh the open deck and the list counts after any change to its cards.
  const refreshDeck = useCallback(async (id: number) => {
    try {
      setDeck(await api.get<DeckDetail>(`/api/flashcards/decks/${id}`));
      void loadDecks();
    } catch (err) {
      toast.error(err);
    }
  }, [loadDecks, toast]);

  const onCardUpdated = useCallback((updated: Card) => {
    setDeck((d) => (d ? { ...d, cards: d.cards.map((c) => (c.id === updated.id ? updated : c)) } : d));
    void loadDecks();
  }, [loadDecks]);

  const saveCard = async (front: string, back: string) => {
    if (!deck || editing === null) return;
    try {
      if (editing === "new") await api.post(`/api/flashcards/decks/${deck.id}/cards`, { front, back });
      else await api.patch(`/api/flashcards/cards/${editing.id}`, { front, back });
      setEditing(null);
      await refreshDeck(deck.id);
    } catch (err) {
      toast.error(err);
    }
  };

  const deleteCard = async (card: Card) => {
    if (!deck) return;
    const ok = await confirm({ title: "Delete this card?", message: card.front, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.delete(`/api/flashcards/cards/${card.id}`);
      await refreshDeck(deck.id);
    } catch (err) {
      toast.error(err);
    }
  };

  const generateMore = async () => {
    if (!deck) return;
    setAddingMore(true);
    try {
      const updated = await api.post<DeckDetail & { added: number }>("/api/flashcards/generate", {
        topic: deck.topic || deck.title,
        count: 5,
        deck_id: deck.id,
      });
      setDeck(updated);
      toast.success(`${plural(updated.added, "card")} added.`);
      void loadDecks();
    } catch (err) {
      toast.error(err);
    }
    setAddingMore(false);
  };

  const renameDeck = async (target: Deck) => {
    const title = await prompt({ title: "Rename deck", label: "Deck name", initial: target.title });
    if (!title) return;
    try {
      await api.patch(`/api/flashcards/decks/${target.id}`, { title });
      setDeck((d) => (d && d.id === target.id ? { ...d, title } : d));
      void loadDecks();
    } catch (err) {
      toast.error(err);
    }
  };

  const deleteDeck = async (target: Deck) => {
    const ok = await confirm({
      title: "Delete this deck?",
      message: `“${target.title}” and its ${plural(target.card_count, "card")} will be permanently deleted.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/api/flashcards/decks/${target.id}`);
      if (deck?.id === target.id) setDeck(null);
      void loadDecks();
    } catch (err) {
      toast.error(err);
    }
  };

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deck ? deck.cards.filter((c) => !q || c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q)) : [];
  }, [deck, search]);

  const totalDue = decks.reduce((sum, d) => sum + d.due_count + d.new_count, 0);
  const deckDue = deck ? deck.cards.filter((c) => c.is_due).length : 0;

  const panel = (
    <>
      <div className="panel-head">
        <h2>Decks</h2>
        <Button size="sm" variant="soft" icon="plus" onClick={showGenerator}>New</Button>
      </div>
      <div className="panel-list">
        {decks.length === 0 && <p className="panel-empty">No decks yet.<br />Generate your first one.</p>}
        {totalDue > 0 && <div className="panel-group">{plural(totalDue, "card")} to study</div>}
        {decks.map((d) => {
          const waiting = d.due_count + d.new_count;
          return (
            <div
              key={d.id}
              role="button"
              tabIndex={0}
              className={`panel-item ${deck?.id === d.id ? "on" : ""}`}
              onClick={() => void openDeck(d.id)}
              onKeyDown={(e) => e.key === "Enter" && void openDeck(d.id)}
            >
              <div className="panel-item-title"><span>{d.title}</span></div>
              <div className="panel-item-meta">
                <span>{plural(d.card_count, "card")}</span>
                {waiting > 0 && <span className="badge accent">{waiting} to study</span>}
              </div>
              <div className="panel-item-actions" onClick={(e) => e.stopPropagation()}>
                <IconButton size="sm" icon="edit" label="Rename" onClick={() => void renameDeck(d)} />
                <IconButton size="sm" icon="trash" label="Delete" danger onClick={() => void deleteDeck(d)} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <SplitView panel={panel} panelOpen={panelOpen} onPanelClose={() => setPanelOpen(false)}>
      <div className="page flashcards">
        <header className="page-head">
          <IconButton className="only-narrow" icon="list" label="Show decks" onClick={() => setPanelOpen(true)} />
          {deck ? (
            <>
              <h1 className="truncate">{deck.title}</h1>
              <span className="badge">{plural(deck.cards.length, "card")}</span>
              {deckDue > 0 && <span className="badge accent">{deckDue} due</span>}
              <span className="spacer" />
              <Segmented
                label="Deck view"
                value={tab}
                onChange={setTab}
                options={[{ value: "study", label: "Study", icon: "play" }, { value: "cards", label: "Cards", icon: "grid" }]}
              />
              <Menu
                align="right"
                trigger={(toggle) => <IconButton icon="more" label="Deck actions" onClick={toggle} loading={addingMore} />}
              >
                {(close) => (
                  <>
                    <MenuItem icon="plus" label="Add a card" onClick={() => { close(); setTab("cards"); setEditing("new"); }} />
                    <MenuItem icon="sparkles" label="Generate 5 more with AI" onClick={() => { close(); void generateMore(); }} />
                    <MenuItem icon="edit" label="Rename deck" onClick={() => { close(); void renameDeck(deck); }} />
                    <MenuItem icon="trash" label="Delete deck" danger onClick={() => { close(); void deleteDeck({ ...deck, card_count: deck.cards.length }); }} />
                  </>
                )}
              </Menu>
            </>
          ) : (
            <h1>New deck</h1>
          )}
        </header>

        <div className="page-scroll">
          {loadingDeck ? (
            <Loading label="Opening deck…" />
          ) : deck && tab === "study" ? (
            <Study key={deck.id} deck={deck} active={active} onCardUpdated={onCardUpdated} />
          ) : deck ? (
            /* ── Cards tab ── */
            <div className="page-wide cards-tab">
              <div className="cards-toolbar">
                <div className="input-icon" style={{ flex: 1, maxWidth: 320 }}>
                  <Icon name="search" size={15} />
                  <input className="input" placeholder="Search cards" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>Add card</Button>
              </div>
              {deck.cards.length === 0 ? (
                <EmptyState icon="cards" title="No cards yet" text="Add your own cards, or let AI write some from the deck's topic.">
                  <Button variant="soft" icon="sparkles" loading={addingMore} onClick={() => void generateMore()}>Generate 5 with AI</Button>
                </EmptyState>
              ) : filteredCards.length === 0 ? (
                <p className="panel-empty">No cards match “{search}”.</p>
              ) : (
                <div className="cards-grid">
                  {filteredCards.map((card) => (
                    <article key={card.id} className="card mini-card">
                      <div className="mini-front">{card.front}</div>
                      <div className="mini-back">{card.back}</div>
                      <footer>
                        <span className="muted">{dueLabel(card)}</span>
                        <span>
                          <IconButton size="sm" icon="edit" label="Edit card" onClick={() => setEditing(card)} />
                          <IconButton size="sm" icon="trash" label="Delete card" danger onClick={() => void deleteCard(card)} />
                        </span>
                      </footer>
                    </article>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ── Generator ── */
            <div className="page-narrow">
              <div className="setup-intro">
                <div className="empty-icon"><Icon name="cards" size={26} /></div>
                <div>
                  <h2>Build a flashcard deck</h2>
                  <p className="muted">AI writes the cards; spaced repetition schedules each one right before you'd forget it.</p>
                </div>
              </div>

              <section className="card setup-card">
                <Segmented
                  label="Card source"
                  value={source}
                  onChange={setSource}
                  options={[{ value: "topic", label: "From a topic", icon: "idea" }, { value: "note", label: "From my notes", icon: "note" }]}
                />

                {source === "topic" ? (
                  <label className="field">
                    <span className="label">Topic</span>
                    <textarea
                      className="textarea"
                      rows={3}
                      value={topic}
                      disabled={generating}
                      placeholder="e.g. Mitosis — phases and what happens in each"
                      onChange={(e) => setTopic(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void generate(); }}
                    />
                    <div className="quick-topics">
                      {QUICK_TOPICS.map((t) => (
                        <button key={t} type="button" className="chip" disabled={generating} onClick={() => setTopic(t)}>{t}</button>
                      ))}
                    </div>
                  </label>
                ) : notes.length === 0 ? (
                  <p className="notice"><Icon name="info" size={16} /><span>You have no notes yet. Write one in <b>Notes</b> to turn it into flashcards.</span></p>
                ) : (
                  <label className="field">
                    <span className="label">Note to turn into cards</span>
                    <select className="select" value={noteId ?? ""} disabled={generating} onChange={(e) => setNoteId(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">Choose a note…</option>
                      {notes.map((n) => <option key={n.id} value={n.id}>{n.title} ({plural(n.word_count, "word")})</option>)}
                    </select>
                  </label>
                )}

                <div className="field">
                  <span className="label">Number of cards</span>
                  <div className="seg" style={{ alignSelf: "flex-start" }}>
                    {COUNTS.map((n) => (
                      <button key={n} type="button" className={count === n ? "on" : ""} onClick={() => setCount(n)}>{n}</button>
                    ))}
                  </div>
                </div>

                {error && <p className="notice danger" role="alert"><Icon name="alertCircle" size={16} />{error}</p>}

                <Button variant="primary" size="lg" icon="sparkles" block loading={generating} disabled={!canGenerate} onClick={() => void generate()}>
                  {generating ? `Writing ${count} cards…` : "Generate flashcards"}
                </Button>
                <Button variant="ghost" icon="plus" onClick={() => void createEmpty()}>Or create an empty deck and add cards yourself</Button>
              </section>
            </div>
          )}
        </div>
      </div>

      {editing !== null && (
        <CardEditor card={editing === "new" ? null : editing} onSave={saveCard} onClose={() => setEditing(null)} />
      )}
    </SplitView>
  );
}
