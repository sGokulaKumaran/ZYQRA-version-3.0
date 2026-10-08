import { useState, useEffect } from "react";

const API = "http://127.0.0.1:8000";
const USER_ID = 1;

interface QuizSession {
  id: number;
  title: string;
  topic: string;
  difficulty: string;
  score: number;
  total: number;
}

interface DeckMeta {
  id: number;
  title: string;
  topic: string;
  card_count: number;
}

interface NoteMeta {
  id: number;
  title: string;
  content: string;
}

// ─── Mini bar chart ───────────────────────────────────────
function BarChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="db-bar-chart">
      {data.map((d, i) => (
        <div key={i} className="db-bar-col">
          <div className="db-bar-track">
            <div
              className="db-bar-fill"
              style={{
                height: `${(d.value / max) * 100}%`,
                background: d.color,
              }}
            />
          </div>
          <span className="db-bar-label">{d.label}</span>
          <span className="db-bar-val">{d.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Donut chart ─────────────────────────────────────────
function DonutChart({
  correct,
  wrong,
  size = 120,
}: {
  correct: number;
  wrong: number;
  size?: number;
}) {
  const total = correct + wrong || 1;
  const pct = (correct / total) * 100;
  const circumference = 2 * Math.PI * 45;
  const strokeDasharray = circumference;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  const color =
    pct >= 80 ? "#22c55e" : pct >= 60 ? "#3b82f6" : pct >= 40 ? "#f59e0b" : "#ef4444";

  return (
    <div className="db-donut-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10" />
        <circle
          cx="50" cy="50" r="45" fill="none"
          stroke={color} strokeWidth="10"
          strokeDasharray={strokeDasharray}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
      </svg>
      <div className="db-donut-center">
        <span className="db-donut-pct" style={{ color }}>{Math.round(pct)}%</span>
        <span className="db-donut-sub">accuracy</span>
      </div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────
function StatCard({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: string;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <div className="db-stat-card" style={{ borderColor: color + "33" }}>
      <div className="db-stat-icon" style={{ background: color + "18", color }}>
        {icon}
      </div>
      <div className="db-stat-info">
        <div className="db-stat-value">{value}</div>
        <div className="db-stat-label">{label}</div>
        {sub && <div className="db-stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

// ─── Main Dashboard ───────────────────────────────────────
export default function Dashboard() {
  const [quizSessions, setQuizSessions] = useState<QuizSession[]>([]);
  const [decks, setDecks] = useState<DeckMeta[]>([]);
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/quiz_sessions/${USER_ID}`).then((r) => r.json()).catch(() => []),
      fetch(`${API}/flashcard_decks/${USER_ID}`).then((r) => r.json()).catch(() => []),
      fetch(`${API}/notes/${USER_ID}`).then((r) => r.json()).catch(() => []),
    ]).then(([q, d, n]) => {
      setQuizSessions(Array.isArray(q) ? q : []);
      setDecks(Array.isArray(d) ? d : []);
      setNotes(Array.isArray(n) ? n : []);
      setLoading(false);
    });
  }, []);

  // ── Computed stats ──────────────────────────────────────
  const totalQuizzes = quizSessions.length;
  const totalQuestions = quizSessions.reduce((s, q) => s + q.total, 0);
  const totalCorrect = quizSessions.reduce((s, q) => s + q.score, 0);
  const totalWrong = totalQuestions - totalCorrect;
  const overallAccuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
  const totalCards = decks.reduce((s, d) => s + d.card_count, 0);
  const totalNotes = notes.length;
  const totalNoteWords = notes.reduce((s, n) => s + (n.content ? n.content.trim().split(/\s+/).filter(Boolean).length : 0), 0);

  // Best/worst quiz
  const bestQuiz = quizSessions.length
    ? quizSessions.reduce((best, q) =>
        q.total > 0 && q.score / q.total > (best.score / best.total) ? q : best
      )
    : null;

  // Difficulty breakdown
  const diffBreakdown = { Easy: 0, Medium: 0, Hard: 0 };
  quizSessions.forEach((s) => {
    const d = s.difficulty as keyof typeof diffBreakdown;
    if (d in diffBreakdown) diffBreakdown[d]++;
  });

  // Last 7 quizzes for trend
  const last7 = quizSessions.slice(0, 7).reverse();
  const trendData = last7.map((s, i) => ({
    label: `Q${i + 1}`,
    value: s.total > 0 ? Math.round((s.score / s.total) * 100) : 0,
    color: (() => {
      const p = s.total > 0 ? (s.score / s.total) * 100 : 0;
      return p >= 80 ? "#22c55e" : p >= 60 ? "#3b82f6" : p >= 40 ? "#f59e0b" : "#ef4444";
    })(),
  }));

  // Topic frequency
  const topicCount: Record<string, number> = {};
  quizSessions.forEach((s) => {
    if (s.topic) topicCount[s.topic] = (topicCount[s.topic] || 0) + 1;
  });
  const topTopics = Object.entries(topicCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (loading) {
    return (
      <div className="db-loading">
        <div className="db-spinner" />
        <p>Loading your analytics…</p>
      </div>
    );
  }

  const isEmpty = totalQuizzes === 0 && decks.length === 0 && notes.length === 0;

  return (
    <div className="db-root">
      <style>{CSS}</style>

      <div className="db-scroll">
        {/* Header */}
        <div className="db-header">
          <div>
            <h1 className="db-title">📊 Dashboard</h1>
            <p className="db-subtitle">Your learning analytics at a glance</p>
          </div>
          <div className="db-header-badge">
            {overallAccuracy >= 80 ? "🏆 Top Performer" : overallAccuracy >= 60 ? "📈 Improving" : overallAccuracy > 0 ? "💪 Keep Going" : "🚀 Just Starting"}
          </div>
        </div>

        {isEmpty ? (
          <div className="db-empty">
            <div className="db-empty-icon">📊</div>
            <h2>No data yet</h2>
            <p>Take a quiz, create flashcards, or write notes to see your analytics here.</p>
          </div>
        ) : (
          <>
            {/* ── Top Stats Row ── */}
            <div className="db-stats-grid">
              <StatCard icon="🧪" label="Quizzes Taken" value={totalQuizzes} sub={`${totalQuestions} total questions`} color="#3b82f6" />
              <StatCard icon="✅" label="Correct Answers" value={totalCorrect} sub={`${totalWrong} wrong`} color="#22c55e" />
              <StatCard icon="🃏" label="Flashcard Decks" value={decks.length} sub={`${totalCards} cards total`} color="#a855f7" />
              <StatCard icon="📝" label="Notes Written" value={totalNotes} sub={`${totalNoteWords.toLocaleString()} words`} color="#f59e0b" />
            </div>

            {/* ── Middle Row: Donut + Trend ── */}
            <div className="db-mid-row">
              {/* Overall accuracy */}
              <div className="db-panel db-accuracy-panel">
                <h3 className="db-panel-title">Overall Accuracy</h3>
                {totalQuizzes === 0 ? (
                  <p className="db-no-data">No quizzes yet</p>
                ) : (
                  <>
                    <DonutChart correct={totalCorrect} wrong={totalWrong} size={140} />
                    <div className="db-acc-stats">
                      <div className="db-acc-row">
                        <span className="db-acc-dot" style={{ background: "#22c55e" }} />
                        <span>{totalCorrect} correct</span>
                      </div>
                      <div className="db-acc-row">
                        <span className="db-acc-dot" style={{ background: "#ef4444" }} />
                        <span>{totalWrong} wrong</span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Score trend */}
              <div className="db-panel db-trend-panel">
                <h3 className="db-panel-title">Recent Quiz Scores</h3>
                {trendData.length === 0 ? (
                  <p className="db-no-data">No quiz history yet</p>
                ) : (
                  <BarChart data={trendData} />
                )}
                <p className="db-trend-note">Last {trendData.length} quiz attempts (% score)</p>
              </div>

              {/* Difficulty breakdown */}
              <div className="db-panel db-diff-panel">
                <h3 className="db-panel-title">Difficulty Breakdown</h3>
                {totalQuizzes === 0 ? (
                  <p className="db-no-data">No quizzes yet</p>
                ) : (
                  <div className="db-diff-list">
                    {(["Easy", "Medium", "Hard"] as const).map((d) => {
                      const count = diffBreakdown[d];
                      const pct = totalQuizzes > 0 ? Math.round((count / totalQuizzes) * 100) : 0;
                      const color = d === "Easy" ? "#22c55e" : d === "Medium" ? "#f59e0b" : "#ef4444";
                      return (
                        <div key={d} className="db-diff-row">
                          <div className="db-diff-label-row">
                            <span className="db-diff-dot" style={{ background: color }} />
                            <span className="db-diff-name">{d}</span>
                            <span className="db-diff-count">{count} quiz{count !== 1 ? "zes" : ""}</span>
                          </div>
                          <div className="db-diff-track">
                            <div className="db-diff-fill" style={{ width: `${pct}%`, background: color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* ── Bottom Row ── */}
            <div className="db-bottom-row">
              {/* Top topics */}
              <div className="db-panel db-topics-panel">
                <h3 className="db-panel-title">🔥 Top Topics</h3>
                {topTopics.length === 0 ? (
                  <p className="db-no-data">No topics yet</p>
                ) : (
                  <div className="db-topic-list">
                    {topTopics.map(([topic, count], i) => (
                      <div key={topic} className="db-topic-row">
                        <span className="db-topic-rank">#{i + 1}</span>
                        <span className="db-topic-name">{topic}</span>
                        <span className="db-topic-pill">{count}x</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Best quiz */}
              <div className="db-panel db-best-panel">
                <h3 className="db-panel-title">🏆 Best Quiz</h3>
                {!bestQuiz ? (
                  <p className="db-no-data">No quizzes yet</p>
                ) : (
                  <div className="db-best-content">
                    <div className="db-best-score" style={{ color: "#22c55e" }}>
                      {bestQuiz.total > 0 ? Math.round((bestQuiz.score / bestQuiz.total) * 100) : 0}%
                    </div>
                    <p className="db-best-title">{bestQuiz.title || bestQuiz.topic || "Quiz"}</p>
                    <p className="db-best-sub">{bestQuiz.score}/{bestQuiz.total} correct · {bestQuiz.difficulty}</p>
                  </div>
                )}
              </div>

              {/* Activity summary */}
              <div className="db-panel db-activity-panel">
                <h3 className="db-panel-title">📋 Activity Summary</h3>
                <div className="db-activity-list">
                  <div className="db-activity-row">
                    <span className="db-activity-icon">🧪</span>
                    <span className="db-activity-label">Quizzes completed</span>
                    <span className="db-activity-val">{totalQuizzes}</span>
                  </div>
                  <div className="db-activity-row">
                    <span className="db-activity-icon">🃏</span>
                    <span className="db-activity-label">Flashcard decks</span>
                    <span className="db-activity-val">{decks.length}</span>
                  </div>
                  <div className="db-activity-row">
                    <span className="db-activity-icon">📝</span>
                    <span className="db-activity-label">Notes saved</span>
                    <span className="db-activity-val">{totalNotes}</span>
                  </div>
                  <div className="db-activity-row">
                    <span className="db-activity-icon">💬</span>
                    <span className="db-activity-label">Total questions</span>
                    <span className="db-activity-val">{totalQuestions}</span>
                  </div>
                  <div className="db-activity-row">
                    <span className="db-activity-icon">✍️</span>
                    <span className="db-activity-label">Words written</span>
                    <span className="db-activity-val">{totalNoteWords.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Recent Quizzes Table ── */}
            {quizSessions.length > 0 && (
              <div className="db-panel db-table-panel">
                <h3 className="db-panel-title">📅 Recent Quiz History</h3>
                <div className="db-table-wrap">
                  <table className="db-table">
                    <thead>
                      <tr>
                        <th>Quiz</th>
                        <th>Topic</th>
                        <th>Difficulty</th>
                        <th>Score</th>
                        <th>Accuracy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quizSessions.slice(0, 10).map((s) => {
                        const pct = s.total > 0 ? Math.round((s.score / s.total) * 100) : 0;
                        const color = pct >= 80 ? "#22c55e" : pct >= 60 ? "#3b82f6" : pct >= 40 ? "#f59e0b" : "#ef4444";
                        return (
                          <tr key={s.id}>
                            <td className="db-td-title">{s.title}</td>
                            <td className="db-td-topic">{s.topic || "—"}</td>
                            <td>
                              {s.difficulty ? (
                                <span className={`db-diff-tag db-diff-tag-${s.difficulty.toLowerCase()}`}>
                                  {s.difficulty}
                                </span>
                              ) : "—"}
                            </td>
                            <td>{s.score}/{s.total}</td>
                            <td>
                              <div className="db-pct-row">
                                <span style={{ color, fontWeight: 700 }}>{pct}%</span>
                                <div className="db-mini-bar">
                                  <div style={{ width: `${pct}%`, background: color, height: "100%", borderRadius: "2px" }} />
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────
const CSS = `
  .db-root {
    width: 100%; height: 100%;
    background: var(--bg-base, #0f172a);
    color: var(--text-primary, #f1f5f9);
    font-family: 'DM Sans', 'Segoe UI', sans-serif;
    overflow: hidden;
  }
  .db-scroll { height: 100%; overflow-y: auto; padding: 28px 32px 60px; }

  .db-loading {
    height: 100%; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 12px;
    color: var(--text-muted, #475569); font-size: 14px;
    background: var(--bg-base, #0f172a);
    font-family: 'DM Sans', sans-serif;
  }
  .db-spinner {
    width: 32px; height: 32px;
    border: 3px solid rgba(255,255,255,0.1);
    border-top-color: var(--accent, #2563eb);
    border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .db-header {
    display: flex; align-items: flex-start; justify-content: space-between;
    margin-bottom: 28px; flex-wrap: wrap; gap: 12px;
  }
  .db-title { font-size: 26px; font-weight: 800; margin: 0 0 4px; color: var(--text-primary); }
  .db-subtitle { font-size: 14px; color: var(--text-muted); margin: 0; }
  .db-header-badge {
    padding: 6px 14px; border-radius: 999px;
    background: var(--accent-soft); border: 1px solid var(--border-accent);
    color: var(--accent-text); font-size: 13px; font-weight: 600;
    white-space: nowrap;
  }

  .db-empty { text-align: center; padding: 60px 20px; }
  .db-empty-icon { font-size: 52px; margin-bottom: 16px; }
  .db-empty h2 { font-size: 20px; font-weight: 700; margin: 0 0 8px; color: var(--text-primary); }
  .db-empty p { font-size: 14px; color: var(--text-muted); margin: 0; }

  /* ── Stat Cards ── */
  .db-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 14px; margin-bottom: 20px;
  }
  .db-stat-card {
    background: var(--bg-card); border: 1px solid;
    border-radius: 14px; padding: 18px;
    display: flex; align-items: center; gap: 14px;
    transition: transform 0.15s;
  }
  .db-stat-card:hover { transform: translateY(-2px); }
  .db-stat-icon {
    width: 44px; height: 44px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    font-size: 20px; flex-shrink: 0;
  }
  .db-stat-info { flex: 1; min-width: 0; }
  .db-stat-value { font-size: 22px; font-weight: 800; line-height: 1; color: var(--text-primary); }
  .db-stat-label { font-size: 12px; color: var(--text-secondary); margin-top: 3px; }
  .db-stat-sub { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

  /* ── Panels ── */
  .db-panel {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 14px; padding: 20px;
  }
  .db-panel-title {
    font-size: 13px; font-weight: 700; color: var(--text-secondary);
    text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 16px;
  }
  .db-no-data { font-size: 13px; color: var(--text-muted); }

  .db-mid-row {
    display: grid;
    grid-template-columns: 1fr 2fr 1fr;
    gap: 14px; margin-bottom: 20px;
  }
  .db-bottom-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 14px; margin-bottom: 20px;
  }

  /* ── Accuracy ── */
  .db-accuracy-panel { display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .db-donut-wrap { position: relative; flex-shrink: 0; }
  .db-donut-center {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
  }
  .db-donut-pct { font-size: 22px; font-weight: 800; line-height: 1; }
  .db-donut-sub { font-size: 10px; color: var(--text-muted); }
  .db-acc-stats { display: flex; flex-direction: column; gap: 6px; width: 100%; }
  .db-acc-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); }
  .db-acc-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

  /* ── Bar Chart ── */
  .db-bar-chart {
    display: flex; align-items: flex-end; gap: 6px; height: 100px;
    padding-bottom: 4px;
  }
  .db-bar-col { display: flex; flex-direction: column; align-items: center; gap: 3px; flex: 1; height: 100%; }
  .db-bar-track { flex: 1; width: 100%; display: flex; align-items: flex-end; background: rgba(255,255,255,0.04); border-radius: 4px; overflow: hidden; }
  .db-bar-fill { width: 100%; border-radius: 4px 4px 0 0; transition: height 0.6s ease; min-height: 2px; }
  .db-bar-label { font-size: 9px; color: var(--text-muted); }
  .db-bar-val { font-size: 9px; color: var(--text-secondary); font-weight: 600; }
  .db-trend-note { font-size: 11px; color: var(--text-dim); margin-top: 8px; }

  /* ── Difficulty ── */
  .db-diff-list { display: flex; flex-direction: column; gap: 14px; }
  .db-diff-row { display: flex; flex-direction: column; gap: 5px; }
  .db-diff-label-row { display: flex; align-items: center; gap: 7px; }
  .db-diff-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .db-diff-name { font-size: 13px; font-weight: 600; color: var(--text-secondary); flex: 1; }
  .db-diff-count { font-size: 11px; color: var(--text-muted); }
  .db-diff-track { height: 6px; background: rgba(255,255,255,0.06); border-radius: 3px; overflow: hidden; }
  .db-diff-fill { height: 100%; border-radius: 3px; transition: width 0.8s ease; }

  /* ── Topics ── */
  .db-topic-list { display: flex; flex-direction: column; gap: 8px; }
  .db-topic-row { display: flex; align-items: center; gap: 9px; }
  .db-topic-rank { font-size: 11px; font-weight: 700; color: var(--text-muted); width: 20px; }
  .db-topic-name { flex: 1; font-size: 13px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .db-topic-pill { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent-text); }

  /* ── Best Quiz ── */
  .db-best-content { display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
  .db-best-score { font-size: 42px; font-weight: 900; line-height: 1; }
  .db-best-title { font-size: 14px; font-weight: 600; color: var(--text-secondary); margin: 0; }
  .db-best-sub { font-size: 12px; color: var(--text-muted); margin: 0; }

  /* ── Activity ── */
  .db-activity-list { display: flex; flex-direction: column; gap: 10px; }
  .db-activity-row { display: flex; align-items: center; gap: 10px; }
  .db-activity-icon { font-size: 16px; width: 24px; text-align: center; }
  .db-activity-label { flex: 1; font-size: 13px; color: var(--text-secondary); }
  .db-activity-val { font-size: 14px; font-weight: 700; color: var(--text-primary); }

  /* ── Table ── */
  .db-table-panel { margin-bottom: 0; }
  .db-table-wrap { overflow-x: auto; }
  .db-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .db-table th {
    text-align: left; padding: 8px 12px;
    color: var(--text-muted); font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.06em;
    border-bottom: 1px solid var(--border);
  }
  .db-table td { padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.03); color: var(--text-secondary); vertical-align: middle; }
  .db-table tr:last-child td { border-bottom: none; }
  .db-table tr:hover td { background: var(--bg-hover); }
  .db-td-title { font-weight: 600; color: var(--text-primary); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .db-td-topic { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .db-diff-tag { padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .db-diff-tag-easy   { background: rgba(34,197,94,0.15);  color: #86efac; }
  .db-diff-tag-medium { background: rgba(234,179,8,0.15);  color: #fde047; }
  .db-diff-tag-hard   { background: rgba(239,68,68,0.15);  color: #fca5a5; }
  .db-pct-row { display: flex; align-items: center; gap: 8px; }
  .db-mini-bar { width: 50px; height: 4px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden; }

  @media (max-width: 900px) {
    .db-mid-row { grid-template-columns: 1fr; }
    .db-bottom-row { grid-template-columns: 1fr; }
    .db-scroll { padding: 20px 16px 40px; }
  }
`;
