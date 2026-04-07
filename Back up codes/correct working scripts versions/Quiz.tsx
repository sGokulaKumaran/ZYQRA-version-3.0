import { useState, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────
interface QuizQuestion {
  question: string;
  options: string[];
  answer: string;
}

interface QuizResult {
  question: string;
  correct: string;
  your: string;
  is_correct: boolean;
}

interface QuizSessionMeta {
  id: number;
  title: string;
  topic: string;
  difficulty: string;
  score: number;
  total: number;
}

type QuizPhase = "setup" | "loading" | "active" | "submitted" | "result";

// ─── Constants ────────────────────────────────────────────
const DIFFICULTY_OPTIONS = ["Easy", "Medium", "Hard"] as const;
const COUNT_OPTIONS = [5, 10, 15, 20] as const;
const API = "http://127.0.0.1:8000";
const USER_ID = 1;

// ─── Component ────────────────────────────────────────────
export default function Quiz() {
  // Setup state
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState<number>(10);
  const [difficulty, setDifficulty] = useState<string>("Medium");
  const [phase, setPhase] = useState<QuizPhase>("setup");
  const [error, setError] = useState("");

  // Quiz state
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [userAnswers, setUserAnswers] = useState<string[]>([]);
  const [results, setResults] = useState<QuizResult[]>([]);
  const [score, setScore] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [wrongQuestions, setWrongQuestions] = useState<{ question: string; answer: string }[]>([]);
  const [flashcardMsg, setFlashcardMsg] = useState("");
  const [makingFlashcards, setMakingFlashcards] = useState(false);

  // History state
  const [history, setHistory] = useState<QuizSessionMeta[]>([]);
  const [viewSession, setViewSession] = useState<any | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);

  // ─── Load history on mount ──────────────────────────────
  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const res = await fetch(`${API}/quiz_sessions/${USER_ID}`);
      const data = await res.json();
      setHistory(Array.isArray(data) ? data : []);
    } catch {}
  };

  // ─── Generate Quiz ──────────────────────────────────────
  const handleGenerate = async () => {
    if (!topic.trim()) { setError("Please enter a topic first."); return; }
    setError("");
    setViewSession(null);
    setPhase("loading");

    try {
      const res = await fetch(`${API}/generate_quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), count, difficulty }),
      });
      const data = await res.json();

      if (!data.quiz || data.quiz.length === 0) {
        setError(data.error || "Failed to generate quiz.");
        setPhase("setup");
        return;
      }

      const valid = data.quiz.filter(
        (q: any) => q.question && Array.isArray(q.options) && q.options.length >= 2 && q.answer
      );
      if (valid.length === 0) { setError("Invalid quiz data."); setPhase("setup"); return; }

      setQuestions(valid);
      setUserAnswers(new Array(valid.length).fill(""));
      setPhase("active");
    } catch {
      setError("Server error.");
      setPhase("setup");
    }
  };

  // ─── Select Answer ──────────────────────────────────────
  const handleSelect = (qIndex: number, option: string) => {
    if (phase !== "active") return;
    setUserAnswers((prev) => { const u = [...prev]; u[qIndex] = option; return u; });
  };

  // ─── Submit Quiz ────────────────────────────────────────
  const handleSubmit = async () => {
    const unanswered = userAnswers.filter((a) => !a).length;
    if (unanswered > 0 && !window.confirm(`${unanswered} unanswered. Submit anyway?`)) return;

    setSubmitting(true);
    setPhase("submitted");

    try {
      const res = await fetch(`${API}/submit_quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quiz: questions, answers: userAnswers, user_id: USER_ID }),
      });
      const data = await res.json();
      setResults(data.results || []);
      setScore(data.score ?? 0);
      setWrongQuestions(data.wrong_questions || []);
      setFlashcardMsg("");

      // Update session with topic + difficulty
      if (data.session_id) {
        await fetch(`${API}/quiz_session/${data.session_id}?topic=${encodeURIComponent(topic)}&difficulty=${encodeURIComponent(difficulty)}`, {
          method: "PUT",
        });
      }

      setPhase("result");
      loadHistory();
    } catch {
      setError("Failed to submit."); setPhase("active");
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Make flashcards from wrong answers ─────────────────
  const handleMakeFlashcards = async () => {
    if (!wrongQuestions.length) return;
    setMakingFlashcards(true);
    setFlashcardMsg("");
    try {
      const res = await fetch(`${API}/flashcards_from_wrong`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wrong_questions: wrongQuestions, topic, user_id: USER_ID }),
      });
      const data = await res.json();
      if (data.deck_id) {
        setFlashcardMsg(`✓ ${data.cards?.length || 0} flashcards saved to "${data.title}"!`);
      } else {
        setFlashcardMsg("⚠ Failed to create flashcards.");
      }
    } catch {
      setFlashcardMsg("⚠ Server error.");
    } finally {
      setMakingFlashcards(false);
    }
  };

  // ─── History actions ────────────────────────────────────
  const deleteSession = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`${API}/quiz_session/${id}`, { method: "DELETE" });
    setHistory((prev) => prev.filter((s) => s.id !== id));
    if (viewSession?.id === id) setViewSession(null);
  };

  const renameSession = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const newName = prompt("Enter new name");
    if (!newName) return;
    await fetch(`${API}/rename_quiz_session/${id}?title=${encodeURIComponent(newName)}`, { method: "PUT" });
    setHistory((prev) => prev.map((s) => s.id === id ? { ...s, title: newName } : s));
  };

  const openSession = async (id: number) => {
    setLoadingSession(true);
    setViewSession(null);
    try {
      const res = await fetch(`${API}/quiz_session_detail/${id}`);
      const data = await res.json();
      setViewSession(data);
    } catch {}
    setLoadingSession(false);
  };

  // ─── Reset ──────────────────────────────────────────────
  const handleReset = () => {
    setTopic(""); setCount(10); setDifficulty("Medium"); setPhase("setup");
    setQuestions([]); setUserAnswers([]); setResults([]); setScore(0);
    setError(""); setWrongQuestions([]); setFlashcardMsg(""); setViewSession(null);
  };

  // ─── Helpers ────────────────────────────────────────────
  const answeredCount = userAnswers.filter((a) => a !== "").length;
  const percentage = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;
  const getScoreColor = () => percentage >= 80 ? "#22c55e" : percentage >= 60 ? "#3b82f6" : percentage >= 40 ? "#f59e0b" : "#ef4444";
  const getScoreLabel = () => percentage >= 80 ? "Excellent! 🏆" : percentage >= 60 ? "Good Job! 👍" : percentage >= 40 ? "Keep Practicing 📚" : "Needs Improvement 💪";
  const difficultyColor = (d: string) => {
    const active = difficulty === d;
    if (d === "Easy") return active ? "diff-easy-active" : "diff-easy";
    if (d === "Medium") return active ? "diff-medium-active" : "diff-medium";
    return active ? "diff-hard-active" : "diff-hard";
  };

  // ─── Render ─────────────────────────────────────────────
  return (
    <div className="quiz-root">
      <style>{CSS}</style>

      {/* ════ LAYOUT: sidebar + content ════ */}
      <div className="quiz-layout">

        {/* ── History Sidebar ── */}
        <div className="quiz-sidebar">
          <div className="qs-header">
            <span className="qs-title">📋 History</span>
            <button className="qs-new-btn" onClick={handleReset}>+ New</button>
          </div>
          <div className="qs-list">
            {history.length === 0 && (
              <p className="qs-empty">No quizzes yet.<br />Take one to see history!</p>
            )}
            {history.map((s) => (
              <div
                key={s.id}
                className={`qs-item group ${viewSession?.id === s.id ? "qs-item-active" : ""}`}
                onClick={() => openSession(s.id)}
              >
                <div className="qs-item-top">
                  <span className="qs-item-title">{s.title || s.topic || "Quiz"}</span>
                  <div className="qs-item-actions">
                    <button onClick={(e) => renameSession(s.id, e)} title="Rename">✏</button>
                    <button onClick={(e) => deleteSession(s.id, e)} title="Delete">🗑</button>
                  </div>
                </div>
                <div className="qs-item-meta">
                  <span className={`qs-diff-dot diff-dot-${(s.difficulty || "medium").toLowerCase()}`} />
                  <span>{s.score}/{s.total}</span>
                  {s.difficulty && <span>· {s.difficulty}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Main Content ── */}
        <div className="quiz-main">

          {/* SESSION VIEW */}
          {viewSession && phase === "setup" && (
            <div className="session-view">
              <div className="sv-header">
                <button className="sv-back" onClick={() => setViewSession(null)}>← Back</button>
                <h2 className="sv-title">{viewSession.title}</h2>
                <div className="sv-meta">
                  {viewSession.topic && <span className="sv-badge topic-badge">{viewSession.topic}</span>}
                  {viewSession.difficulty && <span className={`sv-badge diff-badge-${viewSession.difficulty.toLowerCase()}`}>{viewSession.difficulty}</span>}
                  <span className="sv-score-badge">{viewSession.score}/{viewSession.total} · {Math.round((viewSession.score / viewSession.total) * 100)}%</span>
                </div>
              </div>
              {loadingSession && <p className="sv-loading">Loading...</p>}
              <div className="sv-questions">
                {(viewSession.questions || []).map((q: any, i: number) => (
                  <div key={i} className={`sv-q-card ${q.is_correct ? "sv-q-correct" : "sv-q-wrong"}`}>
                    <div className="sv-q-top">
                      <span className={`sv-q-badge ${q.is_correct ? "badge-correct" : "badge-wrong"}`}>
                        {q.is_correct ? "✓ Correct" : "✗ Wrong"}
                      </span>
                      <span className="sv-q-num">Q{i + 1}</span>
                    </div>
                    <p className="sv-q-text">{q.question}</p>
                    {!q.is_correct && (
                      <div className="sv-q-answers">
                        <div><span className="sv-ans-label">Your answer:</span> <span className="sv-ans-wrong">{q.user_answer || "(none)"}</span></div>
                        <div><span className="sv-ans-label">Correct:</span> <span className="sv-ans-right">{q.answer}</span></div>
                      </div>
                    )}
                    {q.is_correct && <p className="sv-ans-right-inline">✓ {q.answer}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* SETUP PHASE */}
          {!viewSession && (phase === "setup" || phase === "loading") && (
            <div className="quiz-setup-layout">
              {/* Config Panel */}
              <div className="config-panel">
                <div className="config-header">
                  <span className="config-icon">🧪</span>
                  <div>
                    <h2 className="config-title">Quiz Generator</h2>
                    <p className="config-sub">AI-powered questions on any topic</p>
                  </div>
                </div>
                <div className="config-section">
                  <label className="config-label">Number of Questions</label>
                  <div className="pill-row">
                    {COUNT_OPTIONS.map((n) => (
                      <button key={n} className={`count-pill ${count === n ? "count-pill-active" : ""}`}
                        onClick={() => setCount(n)} disabled={phase === "loading"}>{n}</button>
                    ))}
                  </div>
                </div>
                <div className="config-section">
                  <label className="config-label">Difficulty</label>
                  <div className="pill-row">
                    {DIFFICULTY_OPTIONS.map((d) => (
                      <button key={d} className={`diff-pill ${difficultyColor(d)}`}
                        onClick={() => setDifficulty(d)} disabled={phase === "loading"}>
                        {d === "Easy" ? "🟢" : d === "Medium" ? "🟡" : "🔴"} {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="config-summary">
                  <div className="summary-item"><span className="summary-key">Questions</span><span className="summary-val">{count}</span></div>
                  <div className="summary-divider" />
                  <div className="summary-item"><span className="summary-key">Difficulty</span><span className="summary-val">{difficulty}</span></div>
                  <div className="summary-divider" />
                  <div className="summary-item"><span className="summary-key">Topic</span><span className="summary-val">{topic.trim() || "—"}</span></div>
                </div>
              </div>

              {/* Topic Input */}
              <div className="topic-panel">
                <div className="topic-box">
                  <label className="config-label" style={{ marginBottom: "10px", display: "block" }}>Enter your topic</label>
                  <textarea className="topic-textarea"
                    placeholder="e.g. Photosynthesis, World War 2, Python Functions..."
                    value={topic} onChange={(e) => setTopic(e.target.value)}
                    disabled={phase === "loading"} rows={5}
                    onKeyDown={(e) => { if (e.key === "Enter" && e.ctrlKey) handleGenerate(); }}
                  />
                  <p className="topic-hint">Tip: Be specific. Press Ctrl+Enter to generate.</p>
                  {error && <p className="quiz-error">{error}</p>}
                  <button className="generate-btn" onClick={handleGenerate} disabled={phase === "loading" || !topic.trim()}>
                    {phase === "loading" ? <span className="btn-loading"><span className="spinner" /> Generating {count} questions...</span> : "Generate Quiz ✦"}
                  </button>
                </div>
                <div className="suggestions-row">
                  <span className="suggestions-label">Quick topics:</span>
                  {["Biology", "History", "Python", "Chemistry", "Mathematics", "Physics"].map((s) => (
                    <button key={s} className="suggestion-chip" onClick={() => setTopic(s)} disabled={phase === "loading"}>{s}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ACTIVE QUIZ */}
          {(phase === "active" || phase === "submitted") && questions.length > 0 && (
            <div className="quiz-active-layout">
              <div className="quiz-topbar">
                <div className="quiz-topbar-left">
                  <span className="quiz-badge topic-badge">{topic}</span>
                  <span className={`quiz-badge diff-badge-${difficulty.toLowerCase()}`}>{difficulty}</span>
                </div>
                <div className="quiz-topbar-center">
                  <span className="progress-text">{answeredCount} / {questions.length} answered</span>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${(answeredCount / questions.length) * 100}%` }} />
                  </div>
                </div>
                <button className="quit-quiz-btn" onClick={handleReset}>✕ Quit</button>
              </div>
              <div className="questions-scroll">
                <div className="questions-inner">
                  {questions.map((q, qi) => (
                    <div key={qi} className="question-card">
                      <div className="question-number">Question {qi + 1}</div>
                      <p className="question-text">{q.question}</p>
                      <div className="options-grid">
                        {q.options.map((opt, oi) => {
                          const selected = userAnswers[qi] === opt;
                          return (
                            <button key={oi} className={`option-item ${selected ? "option-selected" : ""}`}
                              onClick={() => handleSelect(qi, opt)} disabled={phase === "submitted"}>
                              <span className="option-radio">{selected ? "◉" : "○"}</span>
                              <span className="option-label-letter">{String.fromCharCode(65 + oi)}</span>
                              <span className="option-text">{opt}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <div className="submit-section">
                    {phase === "active" && (
                      <>
                        <div className="submit-info">
                          {answeredCount < questions.length
                            ? <p className="submit-warning">⚠ {questions.length - answeredCount} unanswered</p>
                            : <p className="submit-ready">✓ All answered — ready!</p>}
                        </div>
                        <button className="submit-btn" onClick={handleSubmit} disabled={submitting}>Submit Quiz →</button>
                      </>
                    )}
                    {phase === "submitted" && <div className="submitting-msg"><span className="spinner" /> Evaluating...</div>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* RESULT */}
          {phase === "result" && results.length > 0 && (
            <div className="result-layout">
              <div className="score-card">
                <div className="score-circle" style={{ borderColor: getScoreColor() }}>
                  <span className="score-pct" style={{ color: getScoreColor() }}>{percentage}%</span>
                  <span className="score-frac">{score}/{questions.length}</span>
                </div>
                <div className="score-info">
                  <h2 className="score-label" style={{ color: getScoreColor() }}>{getScoreLabel()}</h2>
                  <p className="score-meta">Topic: <strong>{topic}</strong> · Difficulty: <strong>{difficulty}</strong></p>
                  <div className="score-stats">
                    <div className="stat-item correct-stat"><span className="stat-num">{score}</span><span className="stat-lbl">Correct</span></div>
                    <div className="stat-item wrong-stat"><span className="stat-num">{questions.length - score}</span><span className="stat-lbl">Wrong</span></div>
                    <div className="stat-item total-stat"><span className="stat-num">{questions.length}</span><span className="stat-lbl">Total</span></div>
                  </div>
                  {/* Flashcard prompt */}
                  {wrongQuestions.length > 0 && (
                    <div className="flashcard-prompt">
                      <p className="fp-text">You got {wrongQuestions.length} wrong. Turn them into flashcards?</p>
                      <button className="fp-btn" onClick={handleMakeFlashcards} disabled={makingFlashcards}>
                        {makingFlashcards ? <><span className="spinner" /> Creating...</> : "🃏 Make Flashcards"}
                      </button>
                      {flashcardMsg && <p className="fp-msg">{flashcardMsg}</p>}
                    </div>
                  )}
                </div>
              </div>

              <div className="review-section">
                <h3 className="review-heading">Answer Review</h3>
                {results.map((r, i) => (
                  <div key={i} className={`review-card ${r.is_correct ? "review-correct" : "review-wrong"}`}>
                    <div className="review-top">
                      <span className={`review-badge ${r.is_correct ? "badge-correct" : "badge-wrong"}`}>{r.is_correct ? "✓ Correct" : "✗ Wrong"}</span>
                      <span className="review-qnum">Q{i + 1}</span>
                    </div>
                    <p className="review-question">{r.question}</p>
                    {!r.is_correct && (
                      <div className="review-answers">
                        <div className="review-your"><span className="review-ans-label">Your answer:</span><span className="review-ans-wrong">{r.your || "(none)"}</span></div>
                        <div className="review-correct-ans"><span className="review-ans-label">Correct:</span><span className="review-ans-right">{r.correct}</span></div>
                      </div>
                    )}
                    {r.is_correct && <p className="review-correct-text">✓ {r.correct}</p>}
                  </div>
                ))}
              </div>

              <div className="result-actions">
                <button className="retry-btn" onClick={handleGenerate}>🔁 Retry Same Topic</button>
                <button className="new-quiz-btn" onClick={handleReset}>✦ New Quiz</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────
const CSS = `
  .quiz-root {
    width: 100%; height: 100%;
    background: #0f172a; color: #e2e8f0;
    font-family: 'DM Sans', 'Segoe UI', sans-serif;
    overflow: hidden;
  }

  .quiz-layout {
    display: flex;
    height: 100%;
  }

  /* ─── History Sidebar ─── */
  .quiz-sidebar {
    width: 220px;
    background: #020617;
    border-right: 1px solid rgba(255,255,255,0.06);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    overflow: hidden;
  }
  .qs-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 14px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    flex-shrink: 0;
  }
  .qs-title { font-size: 13px; font-weight: 700; color: #94a3b8; }
  .qs-new-btn {
    font-size: 11px; padding: 4px 10px;
    border-radius: 6px; border: 1px solid rgba(59,130,246,0.4);
    background: rgba(59,130,246,0.12); color: #93c5fd;
    cursor: pointer; font-family: inherit; transition: all 0.15s;
  }
  .qs-new-btn:hover { background: rgba(59,130,246,0.22); }
  .qs-list { flex: 1; overflow-y: auto; padding: 8px; }
  .qs-empty { font-size: 12px; color: #334155; text-align: center; padding: 20px 8px; line-height: 1.6; }
  .qs-item {
    padding: 10px 10px 8px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s;
    border: 1px solid transparent;
    margin-bottom: 4px;
  }
  .qs-item:hover { background: rgba(255,255,255,0.04); }
  .qs-item-active { background: rgba(59,130,246,0.12) !important; border-color: rgba(59,130,246,0.25) !important; }
  .qs-item-top { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
  .qs-item-title { font-size: 12px; font-weight: 600; color: #cbd5e1; truncate; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .qs-item-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
  .qs-item:hover .qs-item-actions { opacity: 1; }
  .qs-item-actions button {
    background: none; border: none; cursor: pointer; font-size: 11px;
    color: #475569; padding: 2px 3px; border-radius: 4px;
    transition: color 0.15s;
  }
  .qs-item-actions button:hover { color: #f87171; }
  .qs-item-meta { display: flex; align-items: center; gap: 5px; margin-top: 4px; font-size: 11px; color: #475569; }
  .qs-diff-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .diff-dot-easy   { background: #22c55e; }
  .diff-dot-medium { background: #eab308; }
  .diff-dot-hard   { background: #ef4444; }
  .diff-dot-       { background: #475569; }

  /* ─── Quiz Main ─── */
  .quiz-main {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  /* ─── Session View ─── */
  .session-view { padding: 28px; max-width: 720px; margin: 0 auto; width: 100%; }
  .sv-header { margin-bottom: 20px; }
  .sv-back { background: none; border: none; color: #475569; font-size: 13px; cursor: pointer; font-family: inherit; padding: 0; margin-bottom: 10px; display: block; }
  .sv-back:hover { color: #93c5fd; }
  .sv-title { font-size: 20px; font-weight: 700; color: #f1f5f9; margin: 0 0 10px; }
  .sv-meta { display: flex; gap: 8px; flex-wrap: wrap; }
  .sv-badge { padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .sv-score-badge { background: rgba(255,255,255,0.06); color: #94a3b8; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .sv-loading { color: #475569; font-size: 14px; padding: 16px; }
  .sv-questions { display: flex; flex-direction: column; gap: 12px; }
  .sv-q-card { border-radius: 12px; border: 1px solid; padding: 14px 18px; }
  .sv-q-correct { background: rgba(34,197,94,0.05); border-color: rgba(34,197,94,0.18); }
  .sv-q-wrong   { background: rgba(239,68,68,0.05);  border-color: rgba(239,68,68,0.18); }
  .sv-q-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .sv-q-badge { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px; }
  .sv-q-num { font-size: 11px; color: #334155; }
  .sv-q-text { font-size: 14px; font-weight: 600; color: #cbd5e1; margin: 0 0 8px; line-height: 1.5; }
  .sv-q-answers { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
  .sv-ans-label { color: #475569; margin-right: 6px; }
  .sv-ans-wrong { color: #f87171; font-weight: 500; }
  .sv-ans-right { color: #86efac; font-weight: 500; }
  .sv-ans-right-inline { font-size: 13px; color: #86efac; margin: 0; font-weight: 500; }

  /* ─── Flashcard prompt ─── */
  .flashcard-prompt {
    margin-top: 14px;
    padding: 12px 16px;
    border-radius: 10px;
    background: rgba(59,130,246,0.08);
    border: 1px solid rgba(59,130,246,0.2);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .fp-text { font-size: 13px; color: #93c5fd; margin: 0; }
  .fp-btn {
    padding: 8px 16px; border-radius: 8px;
    background: rgba(59,130,246,0.2); border: 1px solid rgba(59,130,246,0.4);
    color: #93c5fd; font-size: 13px; font-weight: 600;
    cursor: pointer; font-family: inherit;
    display: flex; align-items: center; gap: 8px;
    width: fit-content; transition: background 0.15s;
  }
  .fp-btn:hover:not(:disabled) { background: rgba(59,130,246,0.3); }
  .fp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .fp-msg { font-size: 12px; color: #22c55e; margin: 0; }

  /* ── SETUP LAYOUT ── */
  .quiz-setup-layout {
    display: grid;
    grid-template-columns: 300px 1fr;
    gap: 0;
    height: 100%;
    min-height: calc(100vh - 64px);
  }
  .config-panel {
    background: #020617;
    border-right: 1px solid rgba(255,255,255,0.06);
    padding: 28px 20px;
    display: flex; flex-direction: column; gap: 24px;
    overflow-y: auto;
  }
  .config-header { display: flex; align-items: center; gap: 12px; }
  .config-icon { font-size: 26px; }
  .config-title { font-size: 17px; font-weight: 700; margin: 0 0 2px; color: #f1f5f9; }
  .config-sub { font-size: 11px; color: #475569; margin: 0; }
  .config-section { display: flex; flex-direction: column; gap: 9px; }
  .config-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #475569; }
  .pill-row { display: flex; gap: 7px; flex-wrap: wrap; }
  .count-pill {
    padding: 6px 14px; border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04); color: #64748b;
    font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s;
  }
  .count-pill:hover { border-color: #3b82f6; color: #93c5fd; }
  .count-pill-active { background: rgba(59,130,246,0.2); border-color: #3b82f6; color: #93c5fd; }
  .diff-pill {
    padding: 6px 12px; border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04); color: #64748b;
    font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.15s;
    display: flex; align-items: center; gap: 5px;
  }
  .diff-easy:hover  { border-color: #22c55e; color: #86efac; }
  .diff-medium:hover { border-color: #eab308; color: #fde047; }
  .diff-hard:hover  { border-color: #ef4444; color: #fca5a5; }
  .diff-easy-active  { background: rgba(34,197,94,0.15);  border-color: #22c55e; color: #86efac; }
  .diff-medium-active { background: rgba(234,179,8,0.15);  border-color: #eab308; color: #fde047; }
  .diff-hard-active  { background: rgba(239,68,68,0.15);  border-color: #ef4444; color: #fca5a5; }
  .config-summary {
    background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);
    border-radius: 10px; padding: 14px;
    display: flex; flex-direction: column; gap: 9px; margin-top: auto;
  }
  .summary-item { display: flex; justify-content: space-between; align-items: center; }
  .summary-key { font-size: 11px; color: #475569; }
  .summary-val { font-size: 12px; font-weight: 600; color: #94a3b8; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
  .summary-divider { height: 1px; background: rgba(255,255,255,0.05); }

  .topic-panel { padding: 36px 36px 28px; display: flex; flex-direction: column; gap: 18px; overflow-y: auto; }
  .topic-box { display: flex; flex-direction: column; gap: 11px; }
  .topic-textarea {
    width: 100%; padding: 14px; border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.1); background: #1e293b;
    color: #e2e8f0; font-size: 14px; font-family: inherit;
    resize: vertical; outline: none; transition: border-color 0.2s;
    min-height: 110px; box-sizing: border-box;
  }
  .topic-textarea:focus { border-color: #3b82f6; }
  .topic-textarea::placeholder { color: #334155; }
  .topic-textarea:disabled { opacity: 0.6; cursor: not-allowed; }
  .topic-hint { font-size: 11px; color: #334155; margin: 0; }
  .quiz-error { color: #f87171; font-size: 13px; margin: 0; }
  .generate-btn {
    padding: 14px 24px; border-radius: 10px; background: #2563eb;
    border: none; color: white; font-size: 15px; font-weight: 700;
    cursor: pointer; transition: background 0.2s, transform 0.15s;
    font-family: inherit; display: flex; align-items: center; justify-content: center; gap: 8px;
  }
  .generate-btn:hover:not(:disabled) { background: #1d4ed8; transform: translateY(-1px); }
  .generate-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
  .btn-loading { display: flex; align-items: center; gap: 10px; }
  .spinner {
    display: inline-block; width: 14px; height: 14px;
    border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
    border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .suggestions-row { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; }
  .suggestions-label { font-size: 11px; color: #475569; }
  .suggestion-chip {
    padding: 4px 11px; border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03); color: #64748b;
    font-size: 11px; cursor: pointer; transition: all 0.15s; font-family: inherit;
  }
  .suggestion-chip:hover { border-color: #3b82f6; color: #93c5fd; background: rgba(59,130,246,0.08); }

  /* ── Active Quiz ── */
  .quiz-active-layout { display: flex; flex-direction: column; height: 100%; }
  .quiz-topbar {
    display: flex; align-items: center; gap: 14px; padding: 12px 24px;
    background: #020617; border-bottom: 1px solid rgba(255,255,255,0.06);
    flex-shrink: 0; flex-wrap: wrap;
  }
  .quiz-topbar-left { display: flex; gap: 8px; align-items: center; }
  .quiz-badge { padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .topic-badge { background: rgba(59,130,246,0.15); border: 1px solid rgba(59,130,246,0.3); color: #93c5fd; }
  .diff-badge-easy   { background: rgba(34,197,94,0.15);  border: 1px solid rgba(34,197,94,0.3);  color: #86efac; }
  .diff-badge-medium { background: rgba(234,179,8,0.15);  border: 1px solid rgba(234,179,8,0.3);  color: #fde047; }
  .diff-badge-hard   { background: rgba(239,68,68,0.15);  border: 1px solid rgba(239,68,68,0.3);  color: #fca5a5; }
  .quiz-topbar-center { flex: 1; display: flex; flex-direction: column; gap: 5px; min-width: 100px; }
  .progress-text { font-size: 11px; color: #475569; }
  .progress-track { height: 3px; background: rgba(255,255,255,0.08); border-radius: 999px; overflow: hidden; }
  .progress-fill { height: 100%; background: linear-gradient(90deg, #2563eb, #3b82f6); border-radius: 999px; transition: width 0.35s ease; }
  .quit-quiz-btn { background: none; border: none; color: #475569; font-size: 12px; cursor: pointer; font-family: inherit; padding: 4px 6px; border-radius: 6px; transition: color 0.15s; white-space: nowrap; }
  .quit-quiz-btn:hover { color: #f87171; }
  .questions-scroll { flex: 1; overflow-y: auto; padding: 24px; }
  .questions-inner { max-width: 680px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
  .question-card { background: #1e293b; border: 1px solid rgba(255,255,255,0.07); border-radius: 14px; padding: 20px 24px; transition: border-color 0.2s; }
  .question-card:hover { border-color: rgba(59,130,246,0.25); }
  .question-number { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #3b82f6; margin-bottom: 8px; }
  .question-text { font-size: 15px; font-weight: 600; color: #f1f5f9; line-height: 1.6; margin: 0 0 16px; }
  .options-grid { display: flex; flex-direction: column; gap: 8px; }
  .option-item {
    display: flex; align-items: center; gap: 12px; padding: 11px 16px;
    border-radius: 9px; border: 1px solid rgba(255,255,255,0.07);
    background: rgba(255,255,255,0.03); color: #94a3b8;
    font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.15s;
    text-align: left; font-family: inherit; width: 100%;
  }
  .option-item:hover:not(:disabled) { border-color: #3b82f6; background: rgba(59,130,246,0.08); color: #e2e8f0; }
  .option-selected { border-color: #2563eb !important; background: rgba(37,99,235,0.18) !important; color: #bfdbfe !important; }
  .option-radio { font-size: 14px; color: #3b82f6; flex-shrink: 0; }
  .option-label-letter { min-width: 22px; height: 22px; border-radius: 5px; background: rgba(255,255,255,0.06); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #475569; flex-shrink: 0; }
  .option-text { flex: 1; }
  .submit-section { display: flex; flex-direction: column; gap: 10px; align-items: center; padding: 8px 0 20px; }
  .submit-info { text-align: center; }
  .submit-warning { font-size: 12px; color: #f59e0b; margin: 0; }
  .submit-ready { font-size: 12px; color: #22c55e; margin: 0; }
  .submit-btn {
    padding: 13px 36px; border-radius: 10px; background: #2563eb;
    border: none; color: white; font-size: 15px; font-weight: 700;
    cursor: pointer; transition: background 0.2s, transform 0.15s; font-family: inherit;
  }
  .submit-btn:hover:not(:disabled) { background: #1d4ed8; transform: translateY(-1px); }
  .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .submitting-msg { display: flex; align-items: center; gap: 10px; color: #64748b; font-size: 13px; padding: 14px 0; }

  /* ── Result ── */
  .result-layout { max-width: 680px; margin: 0 auto; padding: 32px 24px 60px; display: flex; flex-direction: column; gap: 24px; }
  .score-card { display: flex; gap: 24px; background: #1e293b; border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 24px; align-items: center; flex-wrap: wrap; }
  .score-circle { width: 100px; height: 100px; border-radius: 50%; border: 3px solid; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; flex-shrink: 0; }
  .score-pct { font-size: 24px; font-weight: 800; line-height: 1; }
  .score-frac { font-size: 11px; color: #475569; }
  .score-info { flex: 1; min-width: 160px; }
  .score-label { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
  .score-meta { font-size: 12px; color: #475569; margin: 0 0 12px; }
  .score-meta strong { color: #94a3b8; }
  .score-stats { display: flex; gap: 16px; }
  .stat-item { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .stat-num { font-size: 18px; font-weight: 700; }
  .stat-lbl { font-size: 10px; color: #475569; }
  .correct-stat .stat-num { color: #22c55e; }
  .wrong-stat   .stat-num { color: #ef4444; }
  .total-stat   .stat-num { color: #3b82f6; }
  .review-section { display: flex; flex-direction: column; gap: 10px; }
  .review-heading { font-size: 13px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; margin: 0; }
  .review-card { border-radius: 10px; border: 1px solid; padding: 14px 18px; }
  .review-correct { background: rgba(34,197,94,0.06); border-color: rgba(34,197,94,0.2); }
  .review-wrong   { background: rgba(239,68,68,0.06);  border-color: rgba(239,68,68,0.2); }
  .review-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 7px; }
  .review-badge { font-size: 10px; font-weight: 700; padding: 3px 9px; border-radius: 999px; }
  .badge-correct { background: rgba(34,197,94,0.2); color: #86efac; }
  .badge-wrong   { background: rgba(239,68,68,0.2);  color: #fca5a5; }
  .review-qnum { font-size: 10px; color: #334155; }
  .review-question { font-size: 13px; font-weight: 600; color: #cbd5e1; line-height: 1.5; margin: 0 0 8px; }
  .review-answers { display: flex; flex-direction: column; gap: 5px; }
  .review-your, .review-correct-ans { display: flex; gap: 8px; align-items: flex-start; }
  .review-ans-label { font-size: 11px; color: #475569; min-width: 90px; }
  .review-ans-wrong  { font-size: 12px; color: #f87171; font-weight: 500; }
  .review-ans-right  { font-size: 12px; color: #86efac; font-weight: 500; }
  .review-correct-text { font-size: 12px; color: #86efac; margin: 0; font-weight: 500; }
  .result-actions { display: flex; gap: 10px; flex-wrap: wrap; }
  .retry-btn, .new-quiz-btn { flex: 1; min-width: 140px; padding: 12px 18px; border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer; transition: all 0.15s; font-family: inherit; }
  .retry-btn { background: rgba(37,99,235,0.15); border: 1px solid rgba(37,99,235,0.35); color: #93c5fd; }
  .retry-btn:hover { background: rgba(37,99,235,0.25); }
  .new-quiz-btn { background: #2563eb; border: none; color: white; }
  .new-quiz-btn:hover { background: #1d4ed8; transform: translateY(-1px); }
`;