import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { PageProps } from "../../components/layout/AppShell";
import { Button } from "../../components/ui/Button";
import Icon from "../../components/ui/Icon";
import type { IconName } from "../../components/ui/Icon";
import { Loading, ProgressRing } from "../../components/ui/primitives";
import { useApp } from "../../context/AppContext";
import type { Intent, Route } from "../../context/AppContext";
import { useUser } from "../../context/AuthContext";
import { api, errorMessage } from "../../lib/api";
import { formatDueDate, formatMinutes, fromDateKey, plural, scoreTone, timeAgo } from "../../lib/format";
import type { DashboardData, HeatmapDay } from "../../lib/types";
import "./dashboard.css";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// ─── Building blocks ──────────────────────────────────────────
function Stat({ icon, label, value, sub, tone = "accent" }: { icon: IconName; label: string; value: ReactNode; sub: string; tone?: "accent" | "success" | "warning" | "danger" }) {
  return (
    <div className="card stat">
      <span className={`stat-icon ${tone}`}><Icon name={icon} size={20} /></span>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        <div className="stat-sub">{sub}</div>
      </div>
    </div>
  );
}

function Panel({ title, icon, action, children, className = "" }: { title: string; icon: IconName; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card dash-panel ${className}`}>
      <header>
        <h2 className="section-title"><Icon name={icon} size={15} />{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function heatLevel(points: number): number {
  if (points <= 0) return 0;
  if (points < 6) return 1;
  if (points < 15) return 2;
  if (points < 30) return 3;
  return 4;
}

function describeDay(day: HeatmapDay): string {
  const date = fromDateKey(day.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const parts = [
    day.focus_minutes ? `${day.focus_minutes} min focus` : "",
    day.quizzes ? plural(day.quizzes, "quiz", "quizzes") : "",
    day.reviews ? plural(day.reviews, "card review") : "",
    day.messages ? plural(day.messages, "question") : "",
  ].filter(Boolean);
  return `${date} — ${parts.length ? parts.join(", ") : "no activity"}`;
}

function Heatmap({ days }: { days: HeatmapDay[] }) {
  if (days.length === 0) return null;
  // Columns are weeks starting on Monday; pad the first column to line weekdays up.
  const lead = (fromDateKey(days[0].date).getDay() + 6) % 7;
  return (
    <div className="heatmap-wrap">
      <div className="heatmap" role="img" aria-label="Study activity over the last 17 weeks">
        {Array.from({ length: lead }, (_, i) => <span key={`pad-${i}`} className="heat pad" />)}
        {days.map((day) => (
          <span key={day.date} className={`heat l${heatLevel(day.points)}`} title={describeDay(day)} />
        ))}
      </div>
      <div className="heat-legend">
        Less {[0, 1, 2, 3, 4].map((level) => <span key={level} className={`heat l${level}`} />)} More
      </div>
    </div>
  );
}

function TrendChart({ points }: { points: DashboardData["score_trend"] }) {
  const W = 600;
  const H = 170;
  const PAD = { top: 12, right: 14, bottom: 22, left: 44 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (value: number) => PAD.top + innerH - (value / 100) * innerH;
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.accuracy).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z`;
  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Quiz accuracy over your recent quizzes">
      {[0, 50, 100].map((tick) => (
        <g key={tick}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} className="trend-grid" />
          <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" className="trend-axis">{tick}%</text>
        </g>
      ))}
      {points.length > 1 && <path d={area} className="trend-area" />}
      {points.length > 1 && <path d={line} className="trend-line" />}
      {points.map((p, i) => (
        <circle key={p.id} cx={x(i)} cy={y(p.accuracy)} r="4.5" className={`trend-dot ${scoreTone(p.accuracy)}`}>
          <title>{`${p.title} — ${p.accuracy}%`}</title>
        </circle>
      ))}
    </svg>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function DashboardPage({ active }: PageProps) {
  const { navigate, ai, openSettings } = useApp();
  const user = useUser();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api.get<DashboardData>(`/api/dashboard?tz_offset=${new Date().getTimezoneOffset()}`));
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  if (!data) {
    return (
      <div className="page">
        {error ? (
          <div className="empty">
            <p className="notice danger"><Icon name="alertTriangle" size={16} />{error}</p>
            <Button icon="refresh" onClick={() => void load()}>Try again</Button>
          </div>
        ) : <Loading label="Loading your dashboard…" />}
      </div>
    );
  }

  const { streak, focus, totals } = data;
  const toStudy = totals.cards_due + totals.cards_new;
  const goalPct = Math.min(100, Math.round((focus.today_minutes / focus.goal_minutes) * 100));
  const isNew = totals.quizzes === 0 && totals.cards === 0 && totals.notes === 0 && totals.chats === 0 && totals.tasks_open + totals.tasks_done === 0;
  const noProvider = ai !== null && !ai.providers.some((p) => p.configured);

  // What to do next, most urgent first.
  const next: { icon: IconName; title: string; text: string; route: Route; intent?: Intent }[] = [];
  if (totals.tasks_overdue > 0) next.push({ icon: "alertCircle", title: `${plural(totals.tasks_overdue, "overdue task")}`, text: "Catch up or reschedule them.", route: "planner" });
  if (totals.cards_due > 0) next.push({ icon: "cards", title: `Review ${plural(totals.cards_due, "due flashcard")}`, text: "They're scheduled for today — a few minutes keeps them in memory.", route: "flashcards" });
  if (data.weak_topics[0]) next.push({ icon: "target", title: `Practise ${data.weak_topics[0].topic}`, text: `Your accuracy there is ${data.weak_topics[0].accuracy}%. Take another quiz.`, route: "quiz", intent: { topic: data.weak_topics[0].topic } });
  if (totals.cards_new > 0 && totals.cards_due === 0) next.push({ icon: "cards", title: `Learn ${plural(totals.cards_new, "new flashcard")}`, text: "Cards you haven't studied yet.", route: "flashcards" });
  if (!streak.active_today) next.push({ icon: "flame", title: streak.current > 0 ? `Keep your ${streak.current}-day streak` : "Start a streak today", text: "Any quiz, review, focus block or question counts.", route: "chat" });
  if (next.length < 3) next.push({ icon: "chat", title: "Ask the AI tutor", text: "Stuck on something? Get a step-by-step explanation.", route: "chat" });

  const GET_STARTED: { icon: IconName; title: string; text: string; route: Route }[] = [
    { icon: "chat", title: "Ask your first question", text: "The AI tutor explains any topic step by step.", route: "chat" },
    { icon: "quiz", title: "Take a quiz", text: "Pick a topic and test what you know.", route: "quiz" },
    { icon: "cards", title: "Build a flashcard deck", text: "AI writes the cards, spaced repetition schedules them.", route: "flashcards" },
    { icon: "planner", title: "Plan for an exam", text: "Give a deadline and get day-by-day tasks.", route: "planner" },
  ];

  return (
    <div className="page dashboard">
      <div className="page-scroll">
        <div className="page-wide">
          <header className="dash-head">
            <div>
              <h1>{greeting()}, {user.username}</h1>
              <p className="muted">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
            </div>
            <span className={`badge ${streak.current > 0 ? "warning" : ""}`}>
              <Icon name="flame" size={13} />
              {streak.current > 0 ? `${streak.current}-day streak` : "No streak yet"}
            </span>
          </header>

          {noProvider && (
            <div className="notice warning dash-notice">
              <Icon name="key" size={17} />
              <span style={{ flex: 1 }}>AI features are off until you add an API key. It takes a minute and several providers are free.</span>
              <Button size="sm" variant="secondary" onClick={() => openSettings("ai")}>Set up AI</Button>
            </div>
          )}

          <div className="stat-grid">
            <Stat icon="flame" tone="warning" label="Study streak" value={plural(streak.current, "day")} sub={`Best: ${plural(streak.best, "day")}`} />
            <div className="card stat">
              <ProgressRing value={goalPct} size={52} stroke={6} tone={goalPct >= 100 ? "success" : "accent"}>
                <Icon name="timer" size={18} />
              </ProgressRing>
              <div>
                <div className="stat-label">Focus today</div>
                <div className="stat-value">{formatMinutes(focus.today_minutes)}</div>
                <div className="stat-sub">of {formatMinutes(focus.goal_minutes)} goal · {formatMinutes(focus.week_minutes)} this week</div>
              </div>
            </div>
            <Stat
              icon="target"
              tone={totals.quizzes ? scoreTone(totals.accuracy) : "accent"}
              label="Quiz accuracy"
              value={totals.quizzes ? `${totals.accuracy}%` : "—"}
              sub={totals.quizzes ? `${totals.correct}/${totals.questions} correct in ${plural(totals.quizzes, "quiz", "quizzes")}` : "No quizzes taken yet"}
            />
            <Stat icon="cards" tone={toStudy ? "accent" : "success"} label="Flashcards to study" value={toStudy} sub={`${totals.cards_due} due · ${totals.cards_new} new · ${totals.cards} total`} />
          </div>

          {isNew ? (
            <Panel title="Get started" icon="sparkles">
              <div className="next-grid">
                {GET_STARTED.map((step) => (
                  <button key={step.title} type="button" className="next-card" onClick={() => navigate(step.route)}>
                    <span className="stat-icon accent"><Icon name={step.icon} size={19} /></span>
                    <span><b>{step.title}</b><small>{step.text}</small></span>
                    <Icon name="arrowRight" size={16} />
                  </button>
                ))}
              </div>
            </Panel>
          ) : (
            <>
              <div className="dash-row two">
                <Panel title="Study activity" icon="activity">
                  <Heatmap days={data.heatmap} />
                </Panel>
                <Panel title="Up next" icon="bolt">
                  <div className="next-list">
                    {next.slice(0, 4).map((item) => (
                      <button key={item.title} type="button" className="next-card" onClick={() => navigate(item.route, item.intent)}>
                        <span className="stat-icon accent"><Icon name={item.icon} size={18} /></span>
                        <span><b>{item.title}</b><small>{item.text}</small></span>
                        <Icon name="arrowRight" size={16} />
                      </button>
                    ))}
                  </div>
                </Panel>
              </div>

              <div className="dash-row two">
                <Panel title="Quiz accuracy trend" icon="chart">
                  {data.score_trend.length === 0
                    ? <p className="dash-empty">Take a quiz to start tracking your accuracy.</p>
                    : <TrendChart points={data.score_trend} />}
                </Panel>
                <Panel title="Topics to strengthen" icon="target">
                  {data.weak_topics.length === 0 ? (
                    <p className="dash-empty">{totals.quizzes ? "No weak topics — every topic is at 70% or above." : "Your weakest quiz topics will appear here."}</p>
                  ) : (
                    <ul className="topic-list">
                      {data.weak_topics.map((t) => (
                        <li key={t.topic}>
                          <div className="topic-top">
                            <span className="truncate">{t.topic}</span>
                            <b className={scoreTone(t.accuracy)}>{t.accuracy}%</b>
                          </div>
                          <div className="progress"><span style={{ width: `${t.accuracy}%`, background: `var(--${scoreTone(t.accuracy)})` }} /></div>
                          <button type="button" className="topic-action" onClick={() => navigate("quiz", { topic: t.topic })}>
                            Quiz again <Icon name="arrowRight" size={13} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>

              <div className="dash-row two">
                <Panel title="Upcoming tasks" icon="planner" action={<Button size="sm" variant="ghost" iconRight="arrowRight" onClick={() => navigate("planner")}>Planner</Button>}>
                  {data.upcoming_tasks.length === 0 ? (
                    <p className="dash-empty">No dated tasks. Plan your week in the planner.</p>
                  ) : (
                    <ul className="dash-list">
                      {data.upcoming_tasks.map((task) => {
                        const label = task.due_date ? formatDueDate(task.due_date) : "";
                        return (
                          <li key={task.id}>
                            <Icon name="circle" size={16} />
                            <span className="truncate">{task.title}</span>
                            {task.subject && <span className="badge accent">{task.subject}</span>}
                            <span className={`badge ${label.includes("overdue") || label === "Yesterday" ? "danger" : ""}`}>{label}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Panel>
                <Panel title="Recent quizzes" icon="quiz" action={<Button size="sm" variant="ghost" iconRight="arrowRight" onClick={() => navigate("quiz")}>All quizzes</Button>}>
                  {data.recent_quizzes.length === 0 ? (
                    <p className="dash-empty">Finished quizzes show up here.</p>
                  ) : (
                    <ul className="dash-list">
                      {data.recent_quizzes.slice(0, 6).map((quiz) => {
                        const pct = quiz.total ? Math.round((quiz.score / quiz.total) * 100) : 0;
                        return (
                          <li key={quiz.id}>
                            <button type="button" className="dash-link truncate" onClick={() => navigate("quiz", { quizId: quiz.id })}>{quiz.title}</button>
                            <span className="muted">{timeAgo(quiz.created_at)}</span>
                            <span className={`badge ${scoreTone(pct)}`}>{quiz.score}/{quiz.total} · {pct}%</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Panel>
              </div>

              <div className="totals">
                {[
                  { icon: "chat" as const, label: "Chats", value: totals.chats },
                  { icon: "quiz" as const, label: "Questions answered", value: totals.questions },
                  { icon: "cards" as const, label: "Card reviews", value: totals.reviews },
                  { icon: "note" as const, label: "Notes", value: totals.notes },
                  { icon: "edit" as const, label: "Words written", value: totals.note_words.toLocaleString() },
                  { icon: "timer" as const, label: "Total focus", value: formatMinutes(focus.total_minutes) },
                  { icon: "checkCircle" as const, label: "Tasks done", value: totals.tasks_done },
                ].map((item) => (
                  <div key={item.label}>
                    <Icon name={item.icon} size={16} />
                    <b>{item.value}</b>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
