import { useState, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────
interface Card { front: string; back: string; }
interface DeckMeta { id: number; title: string; topic: string; card_count: number; }

type FlashPhase = "setup" | "loading" | "study";
const COUNT_OPTIONS = [5, 10, 15, 20, 30] as const;
const API = "http://127.0.0.1:8000";
const USER_ID = 1;

// ─── Flip Card ────────────────────────────────────────────
function FlipCard({ card, index }: { card: Card; index: number }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className="fc-scene" onClick={() => setFlipped((f) => !f)}>
      <div className={`fc-card ${flipped ? "fc-flipped" : ""}`}>
        {/* Front */}
        <div className="fc-face fc-front">
          <div className="fc-corner">Q{index + 1}</div>
          <p className="fc-text">{card.front}</p>
          <div className="fc-hint">Click to reveal answer</div>
        </div>
        {/* Back */}
        <div className="fc-face fc-back">
          <div className="fc-corner fc-corner-back">Answer</div>
          <p className="fc-text fc-answer-text">{card.back}</p>
          <div className="fc-hint fc-hint-back">Click to flip back</div>
        </div>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────
export default function Flashcards() {
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState<number>(10);
  const [phase, setPhase] = useState<FlashPhase>("setup");
  const [error, setError] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [deckTitle, setDeckTitle] = useState("");

  // History
  const [history, setHistory] = useState<DeckMeta[]>([]);
  const [activeDeckId, setActiveDeckId] = useState<number | null>(null);

  // Study controls
  const [currentIdx, setCurrentIdx] = useState(0);
  const [viewMode, setViewMode] = useState<"single" | "grid">("single");

  useEffect(() => { loadHistory(); }, []);

  const loadHistory = async () => {
    try {
      const res = await fetch(`${API}/flashcard_decks/${USER_ID}`);
      const data = await res.json();
      setHistory(Array.isArray(data) ? data : []);
    } catch {}
  };

  // ─── Generate ───────────────────────────────────────────
  const handleGenerate = async () => {
    if (!topic.trim()) { setError("Please enter a topic."); return; }
    setError(""); setPhase("loading");
    try {
      const res = await fetch(`${API}/generate_flashcards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), count, user_id: USER_ID }),
      });
      const data = await res.json();
      if (!data.cards || data.cards.length === 0) {
        setError(data.error || "Failed to generate."); setPhase("setup"); return;
      }
      setCards(data.cards);
      setDeckTitle(data.title || topic);
      setActiveDeckId(data.deck_id || null);
      setCurrentIdx(0);
      setPhase("study");
      loadHistory();
    } catch {
      setError("Server error."); setPhase("setup");
    }
  };

  // ─── Open deck from history ──────────────────────────────
  const openDeck = async (id: number) => {
    try {
      const res = await fetch(`${API}/flashcard_deck/${id}`);
      const data = await res.json();
      if (data.error) return;
      setCards(data.cards || []);
      setDeckTitle(data.title);
      setActiveDeckId(id);
      setCurrentIdx(0);
      setPhase("study");
    } catch {}
  };

  const deleteDeck = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`${API}/flashcard_deck/${id}`, { method: "DELETE" });
    setHistory((prev) => prev.filter((d) => d.id !== id));
    if (activeDeckId === id) { setPhase("setup"); setCards([]); setActiveDeckId(null); }
  };

  const renameDeck = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const newName = prompt("Enter new name");
    if (!newName) return;
    await fetch(`${API}/rename_flashcard_deck/${id}?title=${encodeURIComponent(newName)}`, { method: "PUT" });
    setHistory((prev) => prev.map((d) => d.id === id ? { ...d, title: newName } : d));
    if (activeDeckId === id) setDeckTitle(newName);
  };

  const handleReset = () => {
    setTopic(""); setCount(10); setPhase("setup"); setCards([]);
    setError(""); setDeckTitle(""); setActiveDeckId(null); setCurrentIdx(0);
  };

  // ─── Render ─────────────────────────────────────────────
  return (
    <div className="fl-root">
      <style>{CSS}</style>

      <div className="fl-layout">
        {/* ── Sidebar ── */}
        <div className="fl-sidebar">
          <div className="fl-sb-header">
            <span className="fl-sb-title">🃏 Decks</span>
            <button className="fl-sb-new" onClick={handleReset}>+ New</button>
          </div>
          <div className="fl-sb-list">
            {history.length === 0 && <p className="fl-sb-empty">No decks yet.<br />Generate one!</p>}
            {history.map((d) => (
              <div
                key={d.id}
                className={`fl-deck-item ${activeDeckId === d.id ? "fl-deck-active" : ""}`}
                onClick={() => openDeck(d.id)}
              >
                <div className="fl-deck-top">
                  <span className="fl-deck-name">{d.title}</span>
                  <div className="fl-deck-actions">
                    <button onClick={(e) => renameDeck(d.id, e)} title="Rename">✏</button>
                    <button onClick={(e) => deleteDeck(d.id, e)} title="Delete">🗑</button>
                  </div>
                </div>
                <span className="fl-deck-count">{d.card_count} cards</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Main ── */}
        <div className="fl-main">

          {/* SETUP */}
          {phase === "setup" || phase === "loading" ? (
            <div className="fl-setup">
              <div className="fl-setup-card">
                <div className="fl-setup-icon">🃏</div>
                <h2 className="fl-setup-title">Generate Flashcards</h2>
                <p className="fl-setup-sub">AI-powered flashcards on any topic</p>

                <div className="fl-form">
                  <div className="fl-field">
                    <label className="fl-label">Topic</label>
                    <textarea
                      className="fl-textarea"
                      placeholder="e.g. Mitosis, French Revolution, React Hooks..."
                      value={topic}
                      onChange={(e) => setTopic(e.target.value)}
                      disabled={phase === "loading"}
                      rows={3}
                      onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) handleGenerate(); }}
                    />
                  </div>

                  <div className="fl-field">
                    <label className="fl-label">Number of Cards</label>
                    <div className="fl-pill-row">
                      {COUNT_OPTIONS.map((n) => (
                        <button
                          key={n}
                          className={`fl-pill ${count === n ? "fl-pill-active" : ""}`}
                          onClick={() => setCount(n)}
                          disabled={phase === "loading"}
                        >{n}</button>
                      ))}
                    </div>
                  </div>

                  {error && <p className="fl-error">{error}</p>}

                  <button
                    className="fl-gen-btn"
                    onClick={handleGenerate}
                    disabled={phase === "loading" || !topic.trim()}
                  >
                    {phase === "loading"
                      ? <><span className="spinner" /> Generating {count} cards...</>
                      : "Generate Flashcards ✦"}
                  </button>

                  <p className="fl-hint">Ctrl+Enter to generate</p>
                </div>

                <div className="fl-quick-row">
                  <span className="fl-quick-label">Quick:</span>
                  {["DNA", "WW2", "Algebra", "Atoms", "Python"].map((s) => (
                    <button key={s} className="fl-chip" onClick={() => setTopic(s)} disabled={phase === "loading"}>{s}</button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {/* STUDY */}
          {phase === "study" && cards.length > 0 && (
            <div className="fl-study">
              {/* Topbar */}
              <div className="fl-topbar">
                <div className="fl-topbar-left">
                  <span className="fl-deck-badge">{deckTitle}</span>
                  <span className="fl-count-badge">{cards.length} cards</span>
                </div>
                <div className="fl-topbar-right">
                  <button
                    className={`fl-view-btn ${viewMode === "single" ? "fl-view-active" : ""}`}
                    onClick={() => setViewMode("single")}
                  >☰ One</button>
                  <button
                    className={`fl-view-btn ${viewMode === "grid" ? "fl-view-active" : ""}`}
                    onClick={() => setViewMode("grid")}
                  >⊞ Grid</button>
                  <button className="fl-quit-btn" onClick={handleReset}>✕ Close</button>
                </div>
              </div>

              {/* SINGLE MODE */}
              {viewMode === "single" && (
                <div className="fl-single-mode">
                  <div className="fl-progress-bar">
                    <div className="fl-progress-fill" style={{ width: `${((currentIdx + 1) / cards.length) * 100}%` }} />
                  </div>
                  <div className="fl-single-area">
                    <FlipCard key={currentIdx} card={cards[currentIdx]} index={currentIdx} />
                  </div>
                  <div className="fl-nav">
                    <button
                      className="fl-nav-btn"
                      onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                      disabled={currentIdx === 0}
                    >← Prev</button>
                    <span className="fl-nav-count">{currentIdx + 1} / {cards.length}</span>
                    <button
                      className="fl-nav-btn"
                      onClick={() => setCurrentIdx((i) => Math.min(cards.length - 1, i + 1))}
                      disabled={currentIdx === cards.length - 1}
                    >Next →</button>
                  </div>
                </div>
              )}

              {/* GRID MODE */}
              {viewMode === "grid" && (
                <div className="fl-grid-mode">
                  <div className="fl-grid">
                    {cards.map((card, i) => (
                      <FlipCard key={i} card={card} index={i} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────
const CSS = `
  .fl-root {
    width: 100%; height: 100%; overflow: hidden;
    background: #0f172a; color: #e2e8f0;
    font-family: 'DM Sans', 'Segoe UI', sans-serif;
  }
  .fl-layout { display: flex; height: 100%; }

  /* ── Sidebar ── */
  .fl-sidebar {
    width: 220px; background: #020617;
    border-right: 1px solid rgba(255,255,255,0.06);
    display: flex; flex-direction: column; overflow: hidden; flex-shrink: 0;
  }
  .fl-sb-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 14px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;
  }
  .fl-sb-title { font-size: 13px; font-weight: 700; color: #94a3b8; }
  .fl-sb-new {
    font-size: 11px; padding: 4px 10px; border-radius: 6px;
    border: 1px solid rgba(59,130,246,0.4); background: rgba(59,130,246,0.12);
    color: #93c5fd; cursor: pointer; font-family: inherit; transition: all 0.15s;
  }
  .fl-sb-new:hover { background: rgba(59,130,246,0.22); }
  .fl-sb-list { flex: 1; overflow-y: auto; padding: 8px; }
  .fl-sb-empty { font-size: 12px; color: #334155; text-align: center; padding: 20px 8px; line-height: 1.6; }
  .fl-deck-item {
    padding: 10px; border-radius: 8px; cursor: pointer;
    transition: background 0.15s; border: 1px solid transparent; margin-bottom: 4px;
  }
  .fl-deck-item:hover { background: rgba(255,255,255,0.04); }
  .fl-deck-active { background: rgba(59,130,246,0.12) !important; border-color: rgba(59,130,246,0.25) !important; }
  .fl-deck-top { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
  .fl-deck-name { font-size: 12px; font-weight: 600; color: #cbd5e1; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fl-deck-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
  .fl-deck-item:hover .fl-deck-actions { opacity: 1; }
  .fl-deck-actions button { background: none; border: none; cursor: pointer; font-size: 11px; color: #475569; padding: 2px 3px; border-radius: 4px; transition: color 0.15s; }
  .fl-deck-actions button:hover { color: #f87171; }
  .fl-deck-count { font-size: 11px; color: #334155; margin-top: 3px; display: block; }

  /* ── Main ── */
  .fl-main { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }

  /* ── Setup ── */
  .fl-setup {
    flex: 1; display: flex; align-items: center; justify-content: center;
    padding: 40px 24px;
  }
  .fl-setup-card {
    background: #1e293b; border: 1px solid rgba(255,255,255,0.08);
    border-radius: 20px; padding: 36px 32px; width: 100%; max-width: 500px;
    display: flex; flex-direction: column; gap: 16px;
  }
  .fl-setup-icon { font-size: 36px; }
  .fl-setup-title { font-size: 22px; font-weight: 800; color: #f1f5f9; margin: 0; }
  .fl-setup-sub { font-size: 13px; color: #475569; margin: 0; }
  .fl-form { display: flex; flex-direction: column; gap: 14px; }
  .fl-field { display: flex; flex-direction: column; gap: 7px; }
  .fl-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #475569; }
  .fl-textarea {
    padding: 12px 14px; border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.1); background: #0f172a;
    color: #e2e8f0; font-size: 14px; font-family: inherit; resize: vertical;
    outline: none; transition: border-color 0.2s; min-height: 80px;
  }
  .fl-textarea:focus { border-color: #3b82f6; }
  .fl-textarea::placeholder { color: #334155; }
  .fl-pill-row { display: flex; gap: 7px; flex-wrap: wrap; }
  .fl-pill {
    padding: 6px 14px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04); color: #64748b;
    font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; font-family: inherit;
  }
  .fl-pill:hover { border-color: #3b82f6; color: #93c5fd; }
  .fl-pill-active { background: rgba(59,130,246,0.2); border-color: #3b82f6; color: #93c5fd; }
  .fl-error { color: #f87171; font-size: 12px; margin: 0; }
  .fl-gen-btn {
    padding: 13px 22px; border-radius: 10px; background: #2563eb;
    border: none; color: white; font-size: 15px; font-weight: 700;
    cursor: pointer; font-family: inherit; transition: background 0.2s, transform 0.15s;
    display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  .fl-gen-btn:hover:not(:disabled) { background: #1d4ed8; transform: translateY(-1px); }
  .fl-gen-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .fl-hint { font-size: 11px; color: #334155; margin: 0; text-align: center; }
  .fl-quick-row { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
  .fl-quick-label { font-size: 11px; color: #475569; }
  .fl-chip {
    padding: 4px 11px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03); color: #64748b; font-size: 11px;
    cursor: pointer; transition: all 0.15s; font-family: inherit;
  }
  .fl-chip:hover { border-color: #3b82f6; color: #93c5fd; background: rgba(59,130,246,0.08); }

  /* ── Study Topbar ── */
  .fl-study { display: flex; flex-direction: column; height: 100%; }
  .fl-topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 24px; background: #020617;
    border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0; flex-wrap: wrap; gap: 10px;
  }
  .fl-topbar-left { display: flex; align-items: center; gap: 8px; }
  .fl-deck-badge { padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; background: rgba(59,130,246,0.15); border: 1px solid rgba(59,130,246,0.3); color: #93c5fd; }
  .fl-count-badge { font-size: 11px; color: #475569; }
  .fl-topbar-right { display: flex; align-items: center; gap: 6px; }
  .fl-view-btn {
    padding: 5px 12px; border-radius: 7px; font-size: 12px; font-weight: 600;
    border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.04);
    color: #64748b; cursor: pointer; font-family: inherit; transition: all 0.15s;
  }
  .fl-view-btn:hover { border-color: #3b82f6; color: #93c5fd; }
  .fl-view-active { background: rgba(59,130,246,0.15); border-color: #3b82f6; color: #93c5fd; }
  .fl-quit-btn { background: none; border: none; color: #475569; font-size: 12px; cursor: pointer; font-family: inherit; padding: 4px 8px; border-radius: 6px; transition: color 0.15s; margin-left: 4px; }
  .fl-quit-btn:hover { color: #f87171; }

  /* ── Single Mode ── */
  .fl-single-mode { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .fl-progress-bar { height: 3px; background: rgba(255,255,255,0.06); flex-shrink: 0; }
  .fl-progress-fill { height: 100%; background: linear-gradient(90deg, #2563eb, #3b82f6); transition: width 0.4s ease; }
  .fl-single-area {
    flex: 1; display: flex; align-items: center; justify-content: center;
    padding: 32px 24px;
  }
  .fl-nav {
    display: flex; align-items: center; justify-content: center; gap: 20px;
    padding: 16px 24px; border-top: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;
  }
  .fl-nav-btn {
    padding: 10px 24px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04); color: #94a3b8; font-size: 14px; font-weight: 600;
    cursor: pointer; font-family: inherit; transition: all 0.15s;
  }
  .fl-nav-btn:hover:not(:disabled) { border-color: #3b82f6; color: #93c5fd; background: rgba(59,130,246,0.08); }
  .fl-nav-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .fl-nav-count { font-size: 14px; color: #475569; min-width: 60px; text-align: center; }

  /* ── Grid Mode ── */
  .fl-grid-mode { flex: 1; overflow-y: auto; padding: 24px; }
  .fl-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 20px;
    max-width: 1100px; margin: 0 auto;
  }

  /* ══ FLIP CARD ══ */
  .fc-scene {
    width: 100%;
    height: 220px;
    perspective: 1000px;
    cursor: pointer;
  }
  /* In single mode, make it bigger */
  .fl-single-area .fc-scene {
    width: 520px;
    max-width: 100%;
    height: 320px;
  }
  .fc-card {
    width: 100%; height: 100%;
    position: relative;
    transform-style: preserve-3d;
    transition: transform 0.55s cubic-bezier(0.4, 0, 0.2, 1);
    border-radius: 16px;
  }
  .fc-flipped { transform: rotateY(180deg); }
  .fc-face {
    position: absolute; inset: 0;
    border-radius: 16px;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    padding: 24px;
    text-align: center;
    border: 1px solid;
    overflow: hidden;
  }
  .fc-front {
    background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
    border-color: rgba(59,130,246,0.2);
  }
  .fc-back {
    background: linear-gradient(135deg, #0f2d1a 0%, #0f172a 100%);
    border-color: rgba(34,197,94,0.2);
    transform: rotateY(180deg);
  }
  .fc-corner {
    position: absolute; top: 12px; left: 14px;
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.1em; color: #3b82f6; opacity: 0.8;
  }
  .fc-corner-back { color: #22c55e; }
  .fc-text {
    font-size: 15px; font-weight: 600; color: #e2e8f0;
    line-height: 1.6; margin: 0; max-height: 160px; overflow-y: auto;
  }
  .fc-answer-text { color: #86efac; }
  .fc-hint {
    position: absolute; bottom: 10px;
    font-size: 10px; color: #334155; letter-spacing: 0.04em;
  }
  .fc-hint-back { color: #1a3a26; }

  .spinner {
    display: inline-block; width: 14px; height: 14px;
    border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
    border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
`;
