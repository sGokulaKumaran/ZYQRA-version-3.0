import { useState } from "react";

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

type QuizPhase = "setup" | "loading" | "active" | "submitted" | "result";

// ─── Constants ────────────────────────────────────────────
const DIFFICULTY_OPTIONS = ["Easy", "Medium", "Hard"] as const;
const COUNT_OPTIONS = [5, 10, 15, 20] as const;

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

  // ─── Generate Quiz ──────────────────────────────────────
  const handleGenerate = async () => {
    if (!topic.trim()) {
      setError("Please enter a topic first.");
      return;
    }
    setError("");
    setPhase("loading");

    try {
      const res = await fetch("http://127.0.0.1:8000/generate_quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim(), count, difficulty }),
      });

      const data = await res.json();

      if (!data.quiz || !Array.isArray(data.quiz) || data.quiz.length === 0) {
        setError(data.error || "Failed to generate quiz. Try again.");
        setPhase("setup");
        return;
      }

      // Validate each question
      const valid = data.quiz.filter(
        (q: any) =>
          q.question &&
          Array.isArray(q.options) &&
          q.options.length >= 2 &&
          q.answer
      );

      if (valid.length === 0) {
        setError("Quiz data was invalid. Please try again.");
        setPhase("setup");
        return;
      }

      setQuestions(valid);
      setUserAnswers(new Array(valid.length).fill(""));
      setPhase("active");
    } catch {
      setError("Server error. Make sure the backend is running.");
      setPhase("setup");
    }
  };

  // ─── Select Answer ──────────────────────────────────────
  const handleSelect = (qIndex: number, option: string) => {
    if (phase !== "active") return;
    setUserAnswers((prev) => {
      const updated = [...prev];
      updated[qIndex] = option;
      return updated;
    });
  };

  // ─── Submit Quiz ────────────────────────────────────────
  const handleSubmit = async () => {
    const unanswered = userAnswers.filter((a) => !a).length;
    if (unanswered > 0) {
      const confirm = window.confirm(
        `You have ${unanswered} unanswered question(s). Submit anyway?`
      );
      if (!confirm) return;
    }

    setSubmitting(true);
    setPhase("submitted");

    try {
      const res = await fetch("http://127.0.0.1:8000/submit_quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quiz: questions, answers: userAnswers }),
      });

      const data = await res.json();
      setResults(data.results || []);
      setScore(data.score ?? 0);
      setPhase("result");
    } catch {
      setError("Failed to submit quiz. Please try again.");
      setPhase("active");
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Reset ──────────────────────────────────────────────
  const handleReset = () => {
    setTopic("");
    setCount(10);
    setDifficulty("Medium");
    setPhase("setup");
    setQuestions([]);
    setUserAnswers([]);
    setResults([]);
    setScore(0);
    setError("");
  };

  // ─── Helpers ────────────────────────────────────────────
  const answeredCount = userAnswers.filter((a) => a !== "").length;
  const percentage = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;

  const getScoreColor = () => {
    if (percentage >= 80) return "#22c55e";
    if (percentage >= 60) return "#3b82f6";
    if (percentage >= 40) return "#f59e0b";
    return "#ef4444";
  };

  const getScoreLabel = () => {
    if (percentage >= 80) return "Excellent! 🏆";
    if (percentage >= 60) return "Good Job! 👍";
    if (percentage >= 40) return "Keep Practicing 📚";
    return "Needs Improvement 💪";
  };

  const difficultyColor = (d: string) => {
    if (d === "Easy") return difficulty === d ? "diff-easy-active" : "diff-easy";
    if (d === "Medium") return difficulty === d ? "diff-medium-active" : "diff-medium";
    return difficulty === d ? "diff-hard-active" : "diff-hard";
  };

  // ─── Render ─────────────────────────────────────────────
  return (
    <div className="quiz-root">
      <style>{CSS}</style>

      {/* ── SETUP PHASE ── */}
      {(phase === "setup" || phase === "loading") && (
        <div className="quiz-setup-layout">

          {/* LEFT: Config Panel */}
          <div className="config-panel">
            <div className="config-header">
              <span className="config-icon">🧪</span>
              <div>
                <h2 className="config-title">Quiz Generator</h2>
                <p className="config-sub">AI-powered questions on any topic</p>
              </div>
            </div>

            {/* Number of Questions */}
            <div className="config-section">
              <label className="config-label">Number of Questions</label>
              <div className="pill-row">
                {COUNT_OPTIONS.map((n) => (
                  <button
                    key={n}
                    className={`count-pill ${count === n ? "count-pill-active" : ""}`}
                    onClick={() => setCount(n)}
                    disabled={phase === "loading"}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Difficulty */}
            <div className="config-section">
              <label className="config-label">Difficulty</label>
              <div className="pill-row">
                {DIFFICULTY_OPTIONS.map((d) => (
                  <button
                    key={d}
                    className={`diff-pill ${difficultyColor(d)}`}
                    onClick={() => setDifficulty(d)}
                    disabled={phase === "loading"}
                  >
                    {d === "Easy" ? "🟢" : d === "Medium" ? "🟡" : "🔴"} {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div className="config-summary">
              <div className="summary-item">
                <span className="summary-key">Questions</span>
                <span className="summary-val">{count}</span>
              </div>
              <div className="summary-divider" />
              <div className="summary-item">
                <span className="summary-key">Difficulty</span>
                <span className="summary-val">{difficulty}</span>
              </div>
              <div className="summary-divider" />
              <div className="summary-item">
                <span className="summary-key">Topic</span>
                <span className="summary-val">{topic.trim() || "—"}</span>
              </div>
            </div>
          </div>

          {/* RIGHT: Topic Input + Generate */}
          <div className="topic-panel">
            <div className="topic-box">
              <label className="config-label" style={{ marginBottom: "10px", display: "block" }}>
                Enter your topic
              </label>
              <textarea
                className="topic-textarea"
                placeholder="e.g. Photosynthesis, World War 2, Python Functions, DNA Replication..."
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                disabled={phase === "loading"}
                rows={5}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.ctrlKey) handleGenerate();
                }}
              />
              <p className="topic-hint">Tip: Be specific for better questions. Press Ctrl+Enter to generate.</p>

              {error && <p className="quiz-error">{error}</p>}

              <button
                className="generate-btn"
                onClick={handleGenerate}
                disabled={phase === "loading" || !topic.trim()}
              >
                {phase === "loading" ? (
                  <span className="btn-loading">
                    <span className="spinner" /> Generating {count} questions...
                  </span>
                ) : (
                  "Generate Quiz ✦"
                )}
              </button>
            </div>

            {/* Quick topic suggestions */}
            <div className="suggestions-row">
              <span className="suggestions-label">Quick topics:</span>
              {["Biology", "History", "Python", "Chemistry", "Mathematics", "Physics"].map((s) => (
                <button
                  key={s}
                  className="suggestion-chip"
                  onClick={() => setTopic(s)}
                  disabled={phase === "loading"}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── ACTIVE QUIZ PHASE ── */}
      {(phase === "active" || phase === "submitted") && questions.length > 0 && (
        <div className="quiz-active-layout">

          {/* Quiz Header Bar */}
          <div className="quiz-topbar">
            <div className="quiz-topbar-left">
              <span className="quiz-badge topic-badge">{topic}</span>
              <span className={`quiz-badge diff-badge-${difficulty.toLowerCase()}`}>{difficulty}</span>
            </div>
            <div className="quiz-topbar-center">
              <span className="progress-text">
                {answeredCount} / {questions.length} answered
              </span>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${(answeredCount / questions.length) * 100}%` }}
                />
              </div>
            </div>
            <button className="quit-quiz-btn" onClick={handleReset}>
              ✕ Quit
            </button>
          </div>

          {/* Question Cards — Google Form style */}
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
                        <button
                          key={oi}
                          className={`option-item ${selected ? "option-selected" : ""}`}
                          onClick={() => handleSelect(qi, opt)}
                          disabled={phase === "submitted"}
                        >
                          <span className="option-radio">
                            {selected ? "◉" : "○"}
                          </span>
                          <span className="option-label-letter">
                            {String.fromCharCode(65 + oi)}
                          </span>
                          <span className="option-text">{opt}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Submit Button */}
              <div className="submit-section">
                {phase === "active" && (
                  <>
                    <div className="submit-info">
                      {answeredCount < questions.length && (
                        <p className="submit-warning">
                          ⚠ {questions.length - answeredCount} question(s) unanswered
                        </p>
                      )}
                      {answeredCount === questions.length && (
                        <p className="submit-ready">✓ All questions answered — ready to submit!</p>
                      )}
                    </div>
                    <button className="submit-btn" onClick={handleSubmit} disabled={submitting}>
                      Submit Quiz →
                    </button>
                  </>
                )}
                {phase === "submitted" && (
                  <div className="submitting-msg">
                    <span className="spinner" /> Evaluating your answers...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── RESULT PHASE ── */}
      {phase === "result" && results.length > 0 && (
        <div className="result-layout">

          {/* Score Card */}
          <div className="score-card">
            <div className="score-circle" style={{ borderColor: getScoreColor() }}>
              <span className="score-pct" style={{ color: getScoreColor() }}>{percentage}%</span>
              <span className="score-frac">{score}/{questions.length}</span>
            </div>
            <div className="score-info">
              <h2 className="score-label" style={{ color: getScoreColor() }}>{getScoreLabel()}</h2>
              <p className="score-meta">
                Topic: <strong>{topic}</strong> · Difficulty: <strong>{difficulty}</strong>
              </p>
              <div className="score-stats">
                <div className="stat-item correct-stat">
                  <span className="stat-num">{score}</span>
                  <span className="stat-lbl">Correct</span>
                </div>
                <div className="stat-item wrong-stat">
                  <span className="stat-num">{questions.length - score}</span>
                  <span className="stat-lbl">Wrong</span>
                </div>
                <div className="stat-item total-stat">
                  <span className="stat-num">{questions.length}</span>
                  <span className="stat-lbl">Total</span>
                </div>
              </div>
            </div>
          </div>

          {/* Review Section */}
          <div className="review-section">
            <h3 className="review-heading">Answer Review</h3>
            {results.map((r, i) => (
              <div
                key={i}
                className={`review-card ${r.is_correct ? "review-correct" : "review-wrong"}`}
              >
                <div className="review-top">
                  <span className={`review-badge ${r.is_correct ? "badge-correct" : "badge-wrong"}`}>
                    {r.is_correct ? "✓ Correct" : "✗ Wrong"}
                  </span>
                  <span className="review-qnum">Q{i + 1}</span>
                </div>
                <p className="review-question">{r.question}</p>
                {!r.is_correct && (
                  <div className="review-answers">
                    <div className="review-your">
                      <span className="review-ans-label">Your answer:</span>
                      <span className="review-ans-wrong">{r.your || "(no answer)"}</span>
                    </div>
                    <div className="review-correct-ans">
                      <span className="review-ans-label">Correct answer:</span>
                      <span className="review-ans-right">{r.correct}</span>
                    </div>
                  </div>
                )}
                {r.is_correct && (
                  <p className="review-correct-text">✓ {r.correct}</p>
                )}
              </div>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="result-actions">
            <button className="retry-btn" onClick={handleGenerate}>
              🔁 Retry Same Topic
            </button>
            <button className="new-quiz-btn" onClick={handleReset}>
              ✦ New Quiz
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────
const CSS = `
  .quiz-root {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    background: #0f172a;
    color: #e2e8f0;
    font-family: 'DM Sans', 'Segoe UI', sans-serif;
  }

  /* ───── SETUP LAYOUT ───── */
  .quiz-setup-layout {
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: 0;
    height: 100%;
    min-height: calc(100vh - 64px);
  }

  .config-panel {
    background: #020617;
    border-right: 1px solid rgba(255,255,255,0.06);
    padding: 32px 24px;
    display: flex;
    flex-direction: column;
    gap: 28px;
    overflow-y: auto;
  }

  .config-header {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .config-icon { font-size: 28px; }
  .config-title {
    font-size: 18px;
    font-weight: 700;
    margin: 0 0 2px;
    color: #f1f5f9;
  }
  .config-sub { font-size: 12px; color: #475569; margin: 0; }

  .config-section { display: flex; flex-direction: column; gap: 10px; }
  .config-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #475569;
  }

  .pill-row { display: flex; gap: 8px; flex-wrap: wrap; }

  .count-pill {
    padding: 7px 16px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04);
    color: #64748b;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .count-pill:hover { border-color: #3b82f6; color: #93c5fd; }
  .count-pill-active {
    background: rgba(59,130,246,0.2);
    border-color: #3b82f6;
    color: #93c5fd;
  }

  .diff-pill {
    padding: 7px 14px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04);
    color: #64748b;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .diff-easy:hover  { border-color: #22c55e; color: #86efac; }
  .diff-medium:hover { border-color: #eab308; color: #fde047; }
  .diff-hard:hover  { border-color: #ef4444; color: #fca5a5; }
  .diff-easy-active  { background: rgba(34,197,94,0.15);  border-color: #22c55e; color: #86efac; }
  .diff-medium-active { background: rgba(234,179,8,0.15);  border-color: #eab308; color: #fde047; }
  .diff-hard-active  { background: rgba(239,68,68,0.15);  border-color: #ef4444; color: #fca5a5; }

  .config-summary {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 12px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: auto;
  }
  .summary-item { display: flex; justify-content: space-between; align-items: center; }
  .summary-key { font-size: 12px; color: #475569; }
  .summary-val { font-size: 13px; font-weight: 600; color: #94a3b8; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; }
  .summary-divider { height: 1px; background: rgba(255,255,255,0.05); }

  /* ── Topic Panel ── */
  .topic-panel {
    padding: 40px 40px 32px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    overflow-y: auto;
  }
  .topic-box { display: flex; flex-direction: column; gap: 12px; }

  .topic-textarea {
    width: 100%;
    padding: 16px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.1);
    background: #1e293b;
    color: #e2e8f0;
    font-size: 15px;
    font-family: inherit;
    resize: vertical;
    outline: none;
    transition: border-color 0.2s;
    min-height: 120px;
    box-sizing: border-box;
  }
  .topic-textarea:focus { border-color: #3b82f6; }
  .topic-textarea::placeholder { color: #334155; }
  .topic-textarea:disabled { opacity: 0.6; cursor: not-allowed; }

  .topic-hint { font-size: 12px; color: #334155; margin: 0; }
  .quiz-error { color: #f87171; font-size: 13px; margin: 0; }

  .generate-btn {
    padding: 16px 28px;
    border-radius: 12px;
    background: #2563eb;
    border: none;
    color: white;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.2s, transform 0.15s;
    font-family: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .generate-btn:hover:not(:disabled) { background: #1d4ed8; transform: translateY(-1px); }
  .generate-btn:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }

  .btn-loading { display: flex; align-items: center; gap: 10px; }

  .spinner {
    display: inline-block;
    width: 16px; height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .suggestions-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .suggestions-label { font-size: 12px; color: #475569; }
  .suggestion-chip {
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.03);
    color: #64748b;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
    font-family: inherit;
  }
  .suggestion-chip:hover { border-color: #3b82f6; color: #93c5fd; background: rgba(59,130,246,0.08); }
  .suggestion-chip:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ───── ACTIVE QUIZ LAYOUT ───── */
  .quiz-active-layout {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: calc(100vh - 64px);
  }

  .quiz-topbar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 28px;
    background: #020617;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .quiz-topbar-left { display: flex; gap: 8px; align-items: center; }
  .quiz-badge {
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
  }
  .topic-badge {
    background: rgba(59,130,246,0.15);
    border: 1px solid rgba(59,130,246,0.3);
    color: #93c5fd;
  }
  .diff-badge-easy   { background: rgba(34,197,94,0.15);  border: 1px solid rgba(34,197,94,0.3);  color: #86efac; }
  .diff-badge-medium { background: rgba(234,179,8,0.15);  border: 1px solid rgba(234,179,8,0.3);  color: #fde047; }
  .diff-badge-hard   { background: rgba(239,68,68,0.15);  border: 1px solid rgba(239,68,68,0.3);  color: #fca5a5; }

  .quiz-topbar-center {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 120px;
  }
  .progress-text { font-size: 12px; color: #475569; }
  .progress-track {
    height: 4px;
    background: rgba(255,255,255,0.08);
    border-radius: 999px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #2563eb, #3b82f6);
    border-radius: 999px;
    transition: width 0.35s ease;
  }

  .quit-quiz-btn {
    background: none;
    border: none;
    color: #475569;
    font-size: 13px;
    cursor: pointer;
    font-family: inherit;
    padding: 4px 8px;
    border-radius: 6px;
    transition: color 0.15s;
    white-space: nowrap;
  }
  .quit-quiz-btn:hover { color: #f87171; }

  .questions-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 28px;
  }
  .questions-inner {
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  /* Google-form style question card */
  .question-card {
    background: #1e293b;
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 16px;
    padding: 24px 28px;
    transition: border-color 0.2s;
  }
  .question-card:hover { border-color: rgba(59,130,246,0.25); }

  .question-number {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #3b82f6;
    margin-bottom: 10px;
  }
  .question-text {
    font-size: 16px;
    font-weight: 600;
    color: #f1f5f9;
    line-height: 1.6;
    margin: 0 0 20px;
  }

  .options-grid {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .option-item {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 13px 18px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.07);
    background: rgba(255,255,255,0.03);
    color: #94a3b8;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
    font-family: inherit;
    width: 100%;
  }
  .option-item:hover:not(:disabled) {
    border-color: #3b82f6;
    background: rgba(59,130,246,0.08);
    color: #e2e8f0;
  }
  .option-item:disabled { cursor: default; }
  .option-selected {
    border-color: #2563eb !important;
    background: rgba(37,99,235,0.18) !important;
    color: #bfdbfe !important;
  }

  .option-radio { font-size: 16px; color: #3b82f6; flex-shrink: 0; }
  .option-label-letter {
    min-width: 24px; height: 24px;
    border-radius: 6px;
    background: rgba(255,255,255,0.06);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: #475569;
    flex-shrink: 0;
  }
  .option-text { flex: 1; }

  /* Submit section */
  .submit-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    padding: 8px 0 20px;
  }
  .submit-info { text-align: center; }
  .submit-warning { font-size: 13px; color: #f59e0b; margin: 0; }
  .submit-ready { font-size: 13px; color: #22c55e; margin: 0; }

  .submit-btn {
    padding: 15px 40px;
    border-radius: 12px;
    background: #2563eb;
    border: none;
    color: white;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.2s, transform 0.15s;
    font-family: inherit;
  }
  .submit-btn:hover:not(:disabled) { background: #1d4ed8; transform: translateY(-1px); }
  .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .submitting-msg {
    display: flex;
    align-items: center;
    gap: 10px;
    color: #64748b;
    font-size: 14px;
    padding: 16px 0;
  }

  /* ───── RESULT LAYOUT ───── */
  .result-layout {
    max-width: 720px;
    margin: 0 auto;
    padding: 36px 28px 60px;
    display: flex;
    flex-direction: column;
    gap: 28px;
  }

  .score-card {
    display: flex;
    gap: 28px;
    background: #1e293b;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 18px;
    padding: 28px;
    align-items: center;
    flex-wrap: wrap;
  }
  .score-circle {
    width: 110px; height: 110px;
    border-radius: 50%;
    border: 3px solid;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    flex-shrink: 0;
  }
  .score-pct { font-size: 26px; font-weight: 800; line-height: 1; }
  .score-frac { font-size: 12px; color: #475569; }

  .score-info { flex: 1; min-width: 180px; }
  .score-label { font-size: 22px; font-weight: 700; margin: 0 0 6px; }
  .score-meta { font-size: 13px; color: #475569; margin: 0 0 16px; }
  .score-meta strong { color: #94a3b8; }

  .score-stats {
    display: flex;
    gap: 20px;
  }
  .stat-item { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .stat-num { font-size: 20px; font-weight: 700; }
  .stat-lbl { font-size: 11px; color: #475569; }
  .correct-stat .stat-num { color: #22c55e; }
  .wrong-stat   .stat-num { color: #ef4444; }
  .total-stat   .stat-num { color: #3b82f6; }

  .review-section { display: flex; flex-direction: column; gap: 12px; }
  .review-heading {
    font-size: 15px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 0;
  }

  .review-card {
    border-radius: 12px;
    border: 1px solid;
    padding: 16px 20px;
  }
  .review-correct { background: rgba(34,197,94,0.06); border-color: rgba(34,197,94,0.2); }
  .review-wrong   { background: rgba(239,68,68,0.06);  border-color: rgba(239,68,68,0.2); }

  .review-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .review-badge {
    font-size: 11px;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 999px;
  }
  .badge-correct { background: rgba(34,197,94,0.2); color: #86efac; }
  .badge-wrong   { background: rgba(239,68,68,0.2);  color: #fca5a5; }
  .review-qnum   { font-size: 11px; color: #334155; }

  .review-question {
    font-size: 14px;
    font-weight: 600;
    color: #cbd5e1;
    line-height: 1.5;
    margin: 0 0 10px;
  }
  .review-answers { display: flex; flex-direction: column; gap: 6px; }
  .review-your, .review-correct-ans { display: flex; gap: 8px; align-items: flex-start; }
  .review-ans-label { font-size: 12px; color: #475569; min-width: 100px; }
  .review-ans-wrong  { font-size: 13px; color: #f87171; font-weight: 500; }
  .review-ans-right  { font-size: 13px; color: #86efac; font-weight: 500; }
  .review-correct-text { font-size: 13px; color: #86efac; margin: 0; font-weight: 500; }

  .result-actions { display: flex; gap: 12px; flex-wrap: wrap; }
  .retry-btn, .new-quiz-btn {
    flex: 1;
    min-width: 160px;
    padding: 14px 20px;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s;
    font-family: inherit;
  }
  .retry-btn {
    background: rgba(37,99,235,0.15);
    border: 1px solid rgba(37,99,235,0.35);
    color: #93c5fd;
  }
  .retry-btn:hover { background: rgba(37,99,235,0.25); }
  .new-quiz-btn {
    background: #2563eb;
    border: none;
    color: white;
  }
  .new-quiz-btn:hover { background: #1d4ed8; transform: translateY(-1px); }
`;