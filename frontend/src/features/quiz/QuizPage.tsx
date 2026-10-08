import { useCallback, useEffect, useState } from "react";
import type { PageProps } from "../../components/layout/AppShell";
import SplitView from "../../components/layout/SplitView";
import { Button, IconButton } from "../../components/ui/Button";
import Icon from "../../components/ui/Icon";
import { Loading, ModelBadge, ProgressRing, Segmented } from "../../components/ui/primitives";
import { useApp } from "../../context/AppContext";
import { useUI } from "../../context/UIContext";
import { api, errorMessage } from "../../lib/api";
import { formatClock, plural, scoreTone, timeAgo } from "../../lib/format";
import type { AnsweredQuestion, DeckDetail, Difficulty, ModelMeta, Note, QuizQuestion, QuizSession, QuizSessionDetail } from "../../lib/types";
import "./quiz.css";

type Phase = "setup" | "loading" | "active" | "saving" | "result";
type Source = "topic" | "note";

const COUNTS = [5, 10, 15, 20];
const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: "Easy", label: "Easy" },
  { value: "Medium", label: "Medium" },
  { value: "Hard", label: "Hard" },
];
const QUICK_TOPICS = ["Cell biology", "World War II", "Python functions", "Chemical bonding", "Algebra", "Newton's laws"];

const percent = (score: number, total: number) => (total ? Math.round((score / total) * 100) : 0);

function verdict(pct: number): string {
  if (pct >= 80) return "Excellent work";
  if (pct >= 60) return "Good job";
  if (pct >= 40) return "Keep practising";
  return "Needs another pass";
}

// ─── Review of a finished quiz ────────────────────────────────
function Review({ questions, onAskTutor }: { questions: AnsweredQuestion[]; onAskTutor: (q: AnsweredQuestion) => void }) {
  return (
    <div className="quiz-review">
      {questions.map((q, index) => (
        <article key={index} className={`review-card ${q.is_correct ? "right" : "wrong"}`}>
          <header>
            <span className={`badge ${q.is_correct ? "success" : "danger"}`}>
              <Icon name={q.is_correct ? "check" : "close"} size={12} />
              {q.is_correct ? "Correct" : q.user_answer ? "Incorrect" : "Skipped"}
            </span>
            <span className="muted">Question {index + 1}</span>
          </header>
          <h4>{q.question}</h4>
          <ul className="review-options">
            {q.options.map((option) => {
              const isAnswer = option === q.answer;
              const isChosen = option === q.user_answer;
              return (
                <li key={option} className={isAnswer ? "answer" : isChosen ? "chosen" : ""}>
                  <Icon name={isAnswer ? "checkCircle" : isChosen ? "closeCircle" : "circle"} size={16} />
                  <span>{option}</span>
                  {isChosen && <em>Your answer</em>}
                </li>
              );
            })}
          </ul>
          {q.explanation && (
            <p className="review-why"><Icon name="idea" size={16} /><span>{q.explanation}</span></p>
          )}
          {!q.is_correct && (
            <div>
              <Button size="sm" variant="ghost" icon="chat" onClick={() => onAskTutor(q)}>Ask the tutor to explain</Button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

export default function QuizPage({ active }: PageProps) {
  const { navigate, intent, takeIntent } = useApp();
  const { toast, confirm, prompt } = useUI();

  // setup
  const [source, setSource] = useState<Source>("topic");
  const [topic, setTopic] = useState("");
  const [noteId, setNoteId] = useState<number | null>(null);
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<Difficulty>("Medium");
  const [phase, setPhase] = useState<Phase>("setup");
  const [error, setError] = useState("");

  // in progress
  const [quizTopic, setQuizTopic] = useState("");
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [model, setModel] = useState<ModelMeta | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // finished
  const [result, setResult] = useState<QuizSessionDetail | null>(null);
  const [makingCards, setMakingCards] = useState(false);

  // history
  const [history, setHistory] = useState<QuizSession[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [viewing, setViewing] = useState<QuizSessionDetail | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await api.get<QuizSession[]>("/api/quiz/sessions"));
    } catch (err) {
      toast.error(err);
    }
  }, [toast]);

  const openSession = useCallback(async (id: number) => {
    setPanelOpen(false);
    setLoadingSession(true);
    try {
      setViewing(await api.get<QuizSessionDetail>(`/api/quiz/sessions/${id}`));
    } catch (err) {
      toast.error(err);
    }
    setLoadingSession(false);
  }, [toast]);

  useEffect(() => {
    if (!active) return;
    void loadHistory();
    api.get<Note[]>("/api/notes").then(setNotes).catch(() => {});
  }, [active, loadHistory]);

  useEffect(() => {
    if (!active || !intent) return;
    const next = takeIntent();
    if (next?.quizId) void openSession(next.quizId);
    else if (next?.fromNoteId) {
      setViewing(null);
      setPhase("setup");
      setSource("note");
      setNoteId(next.fromNoteId);
    } else if (next?.topic) {
      setViewing(null);
      setPhase("setup");
      setSource("topic");
      setTopic(next.topic);
    }
  }, [active, intent, takeIntent, openSession]);

  useEffect(() => {
    if (phase !== "active") return;
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [phase, startedAt]);

  const canGenerate = source === "topic" ? topic.trim().length > 0 : noteId !== null;

  const generate = async () => {
    if (!canGenerate) return;
    setError("");
    setViewing(null);
    setPhase("loading");
    try {
      const data = await api.post<{ topic: string; questions: QuizQuestion[]; model: ModelMeta }>("/api/quiz/generate", {
        topic: topic.trim(),
        count,
        difficulty,
        note_id: source === "note" ? noteId : null,
      });
      setQuizTopic(data.topic);
      setQuestions(data.questions);
      setAnswers(new Array(data.questions.length).fill(""));
      setModel(data.model);
      setStartedAt(Date.now());
      setElapsed(0);
      setPhase("active");
    } catch (err) {
      setError(errorMessage(err));
      setPhase("setup");
    }
  };

  const answered = answers.filter(Boolean).length;

  const submit = async () => {
    const unanswered = questions.length - answered;
    if (unanswered > 0) {
      const ok = await confirm({
        title: "Submit with unanswered questions?",
        message: `${plural(unanswered, "question")} still ${unanswered === 1 ? "has" : "have"} no answer and will be marked wrong.`,
        confirmLabel: "Submit anyway",
      });
      if (!ok) return;
    }
    setPhase("saving");
    try {
      const saved = await api.post<QuizSessionDetail>("/api/quiz/sessions", {
        topic: quizTopic,
        difficulty,
        duration_seconds: Math.floor((Date.now() - startedAt) / 1000),
        questions: questions.map((q, i) => ({ ...q, user_answer: answers[i] })),
      });
      setResult(saved);
      setPhase("result");
      void loadHistory();
    } catch (err) {
      toast.error(err);
      setPhase("active");
    }
  };

  const reset = () => {
    setPhase("setup");
    setQuestions([]);
    setAnswers([]);
    setResult(null);
    setViewing(null);
    setError("");
    setPanelOpen(false);
  };

  const quit = async () => {
    const ok = await confirm({ title: "Quit this quiz?", message: "Your answers so far will be lost.", confirmLabel: "Quit", danger: true });
    if (ok) reset();
  };

  const flashcardsFromMistakes = async (session: QuizSessionDetail) => {
    const items = session.questions.filter((q) => !q.is_correct).map((q) => ({ question: q.question, answer: q.answer }));
    if (items.length === 0) return;
    setMakingCards(true);
    try {
      const deck = await api.post<DeckDetail>("/api/flashcards/from-mistakes", { topic: session.topic, items });
      toast.success(`${plural(deck.card_count, "flashcard")} created from your mistakes.`);
      navigate("flashcards", { deckId: deck.id });
    } catch (err) {
      toast.error(err);
    }
    setMakingCards(false);
  };

  const askTutor = (q: AnsweredQuestion) =>
    navigate("chat", {
      ask: `I got this quiz question wrong. Explain why the correct answer is right${q.user_answer ? " and why my answer is wrong" : ""}.\n\nQuestion: ${q.question}\nCorrect answer: ${q.answer}${q.user_answer ? `\nMy answer: ${q.user_answer}` : ""}`,
    });

  const renameSession = async (session: QuizSession) => {
    const title = await prompt({ title: "Rename quiz", label: "Title", initial: session.title });
    if (!title) return;
    try {
      const updated = await api.patch<QuizSession>(`/api/quiz/sessions/${session.id}`, { title });
      setHistory((list) => list.map((s) => (s.id === updated.id ? updated : s)));
      setViewing((v) => (v && v.id === updated.id ? { ...v, title: updated.title } : v));
    } catch (err) {
      toast.error(err);
    }
  };

  const deleteSession = async (session: QuizSession) => {
    const ok = await confirm({ title: "Delete this quiz?", message: `“${session.title}” will be removed from your history and statistics.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await api.delete(`/api/quiz/sessions/${session.id}`);
      setHistory((list) => list.filter((s) => s.id !== session.id));
      if (viewing?.id === session.id) setViewing(null);
    } catch (err) {
      toast.error(err);
    }
  };

  const inQuiz = phase === "active" || phase === "saving";
  const shown = viewing ?? (phase === "result" ? result : null);

  const panel = (
    <>
      <div className="panel-head">
        <h2>Quiz history</h2>
        <Button size="sm" variant="soft" icon="plus" onClick={reset} disabled={inQuiz}>New</Button>
      </div>
      <div className="panel-list">
        {history.length === 0 && <p className="panel-empty">No quizzes yet.<br />Finish one and it will show up here.</p>}
        {history.map((session) => {
          const pct = percent(session.score, session.total);
          return (
            <div
              key={session.id}
              role="button"
              tabIndex={0}
              className={`panel-item ${shown?.id === session.id ? "on" : ""}`}
              onClick={() => !inQuiz && void openSession(session.id)}
              onKeyDown={(e) => e.key === "Enter" && !inQuiz && void openSession(session.id)}
            >
              <div className="panel-item-title"><span>{session.title}</span></div>
              <div className="panel-item-meta">
                <span className={`score-dot ${scoreTone(pct)}`} />
                <span>{session.score}/{session.total} · {pct}%</span>
                <span className="truncate">· {timeAgo(session.created_at) || session.difficulty}</span>
              </div>
              <div className="panel-item-actions" onClick={(e) => e.stopPropagation()}>
                <IconButton size="sm" icon="edit" label="Rename" onClick={() => void renameSession(session)} />
                <IconButton size="sm" icon="trash" label="Delete" danger onClick={() => void deleteSession(session)} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );

  return (
    <SplitView panel={panel} panelOpen={panelOpen} onPanelClose={() => setPanelOpen(false)}>
      <div className="page quiz">
        <header className="page-head">
          <IconButton className="only-narrow" icon="list" label="Show quiz history" onClick={() => setPanelOpen(true)} />
          {inQuiz ? (
            <>
              <h1 className="truncate">{quizTopic}</h1>
              <span className="badge">{difficulty}</span>
              <span className="spacer" />
              <div className="quiz-progress">
                <span>{answered}/{questions.length} answered</span>
                <div className="progress"><span style={{ width: `${(answered / questions.length) * 100}%` }} /></div>
              </div>
              <span className="badge" title="Time elapsed"><Icon name="clock" size={12} />{formatClock(elapsed)}</span>
              <Button size="sm" variant="ghost" icon="close" onClick={() => void quit()} disabled={phase === "saving"}>Quit</Button>
            </>
          ) : shown ? (
            <>
              <IconButton icon="arrowLeft" label="Back to new quiz" onClick={reset} />
              <h1 className="truncate">{shown.title}</h1>
            </>
          ) : (
            <h1>New quiz</h1>
          )}
        </header>

        <div className="page-scroll">
          {loadingSession ? (
            <Loading label="Opening quiz…" />
          ) : shown ? (
            /* ── Result / past session ── */
            <div className="page-narrow quiz-result">
              <section className="card score-card">
                <ProgressRing value={percent(shown.score, shown.total)} size={120} stroke={10}>
                  <div>
                    <div className="score-pct">{percent(shown.score, shown.total)}%</div>
                    <div className="muted" style={{ fontSize: 12 }}>{shown.score} of {shown.total}</div>
                  </div>
                </ProgressRing>
                <div className="score-info">
                  <h2>{verdict(percent(shown.score, shown.total))}</h2>
                  <div className="score-tags">
                    {shown.topic && <span className="badge accent">{shown.topic}</span>}
                    {shown.difficulty && <span className="badge">{shown.difficulty}</span>}
                    {shown.duration_seconds > 0 && <span className="badge"><Icon name="clock" size={12} />{formatClock(shown.duration_seconds)}</span>}
                    {viewing === null && model && <ModelBadge model={model} />}
                  </div>
                  <div className="score-actions">
                    {shown.score < shown.total && (
                      <Button variant="soft" icon="cards" loading={makingCards} onClick={() => void flashcardsFromMistakes(shown)}>
                        Flashcards from {plural(shown.total - shown.score, "mistake")}
                      </Button>
                    )}
                    {viewing === null && <Button icon="repeat" onClick={() => void generate()}>Retry topic</Button>}
                    <Button variant={viewing ? "secondary" : "primary"} icon="plus" onClick={reset}>New quiz</Button>
                  </div>
                </div>
              </section>
              <h3 className="section-title">Answer review</h3>
              <Review questions={shown.questions} onAskTutor={askTutor} />
            </div>
          ) : inQuiz ? (
            /* ── Taking the quiz ── */
            <div className="page-narrow quiz-active">
              {questions.map((q, qi) => (
                <article key={qi} className={`card question ${answers[qi] ? "done" : ""}`}>
                  <span className="question-num">Question {qi + 1} of {questions.length}</span>
                  <h3>{q.question}</h3>
                  <div className="options" role="radiogroup" aria-label={`Question ${qi + 1}`}>
                    {q.options.map((option, oi) => {
                      const selected = answers[qi] === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          className={`option ${selected ? "on" : ""}`}
                          disabled={phase === "saving"}
                          onClick={() => setAnswers((list) => list.map((a, i) => (i === qi ? (a === option ? "" : option) : a)))}
                        >
                          <span className="option-letter">{String.fromCharCode(65 + oi)}</span>
                          <span>{option}</span>
                        </button>
                      );
                    })}
                  </div>
                </article>
              ))}
              <div className="quiz-submit">
                <p className={answered === questions.length ? "ready" : "muted"}>
                  {answered === questions.length ? "All questions answered." : `${plural(questions.length - answered, "question")} left to answer.`}
                </p>
                <Button variant="primary" size="lg" iconRight="arrowRight" loading={phase === "saving"} onClick={() => void submit()}>
                  Submit quiz
                </Button>
              </div>
            </div>
          ) : (
            /* ── Setup ── */
            <div className="page-narrow quiz-setup">
              <div className="setup-intro">
                <div className="empty-icon"><Icon name="quiz" size={26} /></div>
                <div>
                  <h2>Test yourself</h2>
                  <p className="muted">Generate a multiple-choice quiz on any topic, or straight from one of your notes.</p>
                </div>
              </div>

              <section className="card setup-card">
                <Segmented
                  label="Quiz source"
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
                      disabled={phase === "loading"}
                      placeholder="e.g. Photosynthesis — light-dependent reactions"
                      onChange={(e) => setTopic(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void generate(); }}
                    />
                    <div className="quick-topics">
                      {QUICK_TOPICS.map((t) => (
                        <button key={t} type="button" className="chip" disabled={phase === "loading"} onClick={() => setTopic(t)}>{t}</button>
                      ))}
                    </div>
                  </label>
                ) : notes.length === 0 ? (
                  <p className="notice"><Icon name="info" size={16} /><span>You have no notes yet. Write one in <b>Notes</b> and you can quiz yourself on it here.</span></p>
                ) : (
                  <label className="field">
                    <span className="label">Note to quiz on</span>
                    <select className="select" value={noteId ?? ""} disabled={phase === "loading"} onChange={(e) => setNoteId(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">Choose a note…</option>
                      {notes.map((n) => <option key={n.id} value={n.id}>{n.title} ({plural(n.word_count, "word")})</option>)}
                    </select>
                    <span className="hint">Questions are written only from what is in the note.</span>
                  </label>
                )}

                <div className="setup-row">
                  <div className="field">
                    <span className="label">Questions</span>
                    <div className="seg">
                      {COUNTS.map((n) => (
                        <button key={n} type="button" className={count === n ? "on" : ""} onClick={() => setCount(n)}>{n}</button>
                      ))}
                    </div>
                  </div>
                  <div className="field">
                    <span className="label">Difficulty</span>
                    <Segmented label="Difficulty" value={difficulty} onChange={setDifficulty} options={DIFFICULTIES} />
                  </div>
                </div>

                {error && <p className="notice danger" role="alert"><Icon name="alertCircle" size={16} />{error}</p>}

                <Button variant="primary" size="lg" icon="sparkles" block loading={phase === "loading"} disabled={!canGenerate} onClick={() => void generate()}>
                  {phase === "loading" ? `Writing ${count} questions…` : "Generate quiz"}
                </Button>
              </section>
            </div>
          )}
        </div>
      </div>
    </SplitView>
  );
}
