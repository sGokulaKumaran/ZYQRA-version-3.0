import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { PageProps } from "../../components/layout/AppShell";
import { Button, IconButton } from "../../components/ui/Button";
import Icon from "../../components/ui/Icon";
import Modal from "../../components/ui/Modal";
import { EmptyState, ModelBadge } from "../../components/ui/primitives";
import { useUI } from "../../context/UIContext";
import { api, errorMessage } from "../../lib/api";
import { daysFromToday, formatDueDate, plural, toDateKey, todayKey } from "../../lib/format";
import type { ModelMeta, Priority, Task, TaskDraft } from "../../lib/types";
import "./planner.css";

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];
const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

const EMPTY_DRAFT: TaskDraft = { title: "", details: "", subject: "", priority: "medium", due_date: null };

function inDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

// ─── Task editor ──────────────────────────────────────────────
function TaskEditor({ task, onSave, onClose }: { task: Task | null; onSave: (draft: TaskDraft) => Promise<void>; onClose: () => void }) {
  const [draft, setDraft] = useState<TaskDraft>(
    task
      ? { title: task.title, details: task.details, subject: task.subject, priority: task.priority, due_date: task.due_date }
      : EMPTY_DRAFT,
  );
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<TaskDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    await onSave({ ...draft, title: draft.title.trim() });
    setSaving(false);
  };

  return (
    <Modal title={task ? "Edit task" : "New task"} onClose={onClose}>
      <form className="field" style={{ gap: 14 }} onSubmit={submit}>
        <label className="field">
          <span className="label">Task</span>
          <input className="input" autoFocus value={draft.title} maxLength={200} placeholder="e.g. Revise chapter 4 and do 10 problems" onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="field">
          <span className="label">Details (optional)</span>
          <textarea className="textarea" rows={3} value={draft.details} maxLength={2000} onChange={(e) => set({ details: e.target.value })} />
        </label>
        <div className="task-form-row">
          <label className="field">
            <span className="label">Subject</span>
            <input className="input" value={draft.subject} maxLength={80} placeholder="e.g. Physics" onChange={(e) => set({ subject: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Due date</span>
            <input className="input" type="date" value={draft.due_date ?? ""} onChange={(e) => set({ due_date: e.target.value || null })} />
          </label>
          <label className="field">
            <span className="label">Priority</span>
            <select className="select" value={draft.priority} onChange={(e) => set({ priority: e.target.value as Priority })}>
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" loading={saving} disabled={!draft.title.trim()}>{task ? "Save" : "Add task"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── AI study plan ────────────────────────────────────────────
function PlanDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (count: number) => void }) {
  const [goal, setGoal] = useState("");
  const [deadline, setDeadline] = useState(inDays(14));
  const [hours, setHours] = useState(2);
  const [plan, setPlan] = useState<TaskDraft[] | null>(null);
  const [chosen, setChosen] = useState<boolean[]>([]);
  const [model, setModel] = useState<ModelMeta | null>(null);
  const [busy, setBusy] = useState<"plan" | "add" | null>(null);
  const [error, setError] = useState("");

  const generate = async (event?: FormEvent) => {
    event?.preventDefault();
    setError("");
    setBusy("plan");
    try {
      const result = await api.post<{ tasks: TaskDraft[]; model: ModelMeta }>("/api/tasks/plan", {
        goal: goal.trim(),
        start: todayKey(),
        deadline,
        hours_per_day: hours,
      });
      setPlan(result.tasks);
      setChosen(result.tasks.map(() => true));
      setModel(result.model);
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(null);
  };

  const selected = plan ? plan.filter((_, i) => chosen[i]) : [];

  const add = async () => {
    setBusy("add");
    try {
      await api.post("/api/tasks/bulk", { tasks: selected });
      onAdded(selected.length);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  if (plan) {
    return (
      <Modal
        title="Your study plan"
        size="wide"
        onClose={onClose}
        footer={
          <>
            <Button variant="ghost" icon="arrowLeft" onClick={() => setPlan(null)} disabled={busy !== null}>Change details</Button>
            <Button icon="refresh" onClick={() => void generate()} loading={busy === "plan"} disabled={busy !== null}>Regenerate</Button>
            <Button variant="primary" icon="plus" loading={busy === "add"} disabled={selected.length === 0 || busy !== null} onClick={() => void add()}>
              Add {plural(selected.length, "task")}
            </Button>
          </>
        }
      >
        <div className="plan-summary">
          <span>Untick anything you don't want, then add the rest to your planner.</span>
          {model && <ModelBadge model={model} />}
        </div>
        {error && <p className="notice danger"><Icon name="alertCircle" size={16} />{error}</p>}
        <ul className="plan-list">
          {plan.map((task, index) => (
            <li key={index} className={chosen[index] ? "" : "skipped"}>
              <button type="button" className="task-check" aria-label={chosen[index] ? "Exclude this task" : "Include this task"} onClick={() => setChosen((list) => list.map((v, i) => (i === index ? !v : v)))}>
                <Icon name={chosen[index] ? "checkbox" : "square"} size={20} />
              </button>
              <div className="task-main">
                <b>{task.title}</b>
                {task.details && <p>{task.details}</p>}
                <div className="task-tags">
                  {task.due_date && <span className="badge"><Icon name="calendar" size={12} />{formatDueDate(task.due_date)}</span>}
                  {task.subject && <span className="badge accent">{task.subject}</span>}
                  {task.priority === "high" && <span className="badge danger"><Icon name="flag" size={12} />High</span>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Modal>
    );
  }

  return (
    <Modal title="Plan my study with AI" onClose={onClose}>
      <form className="field" style={{ gap: 14 }} onSubmit={generate}>
        <p className="hint">Tell Zyqra what you're working toward and it will lay out day-by-day tasks up to your deadline.</p>
        <label className="field">
          <span className="label">What are you preparing for?</span>
          <textarea className="textarea" autoFocus rows={3} value={goal} maxLength={500} placeholder="e.g. Class 12 physics final — mechanics, electricity and optics" onChange={(e) => setGoal(e.target.value)} />
        </label>
        <div className="task-form-row two">
          <label className="field">
            <span className="label">Deadline / exam date</span>
            <input className="input" type="date" value={deadline} min={todayKey()} onChange={(e) => setDeadline(e.target.value)} />
          </label>
          <label className="field">
            <span className="label">Study time per day</span>
            <select className="select" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
              {[0.5, 1, 1.5, 2, 3, 4, 5, 6, 8].map((h) => <option key={h} value={h}>{h === 0.5 ? "30 minutes" : `${h} ${h === 1 ? "hour" : "hours"}`}</option>)}
            </select>
          </label>
        </div>
        {error && <p className="notice danger" role="alert"><Icon name="alertCircle" size={16} />{error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" icon="sparkles" loading={busy === "plan"} disabled={goal.trim().length < 3 || !deadline}>
            {busy === "plan" ? "Planning…" : "Create plan"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────
interface Group {
  key: string;
  label: string;
  tone?: "danger" | "accent";
  tasks: Task[];
}

export default function PlannerPage({ active }: PageProps) {
  const { toast, confirm } = useUI();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickDate, setQuickDate] = useState("");
  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const [planning, setPlanning] = useState(false);
  const [subject, setSubject] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    try {
      setTasks(await api.get<Task[]>("/api/tasks"));
    } catch (err) {
      toast.error(err);
    }
    setLoaded(true);
  }, [toast]);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const quickAdd = async (event: FormEvent) => {
    event.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;
    try {
      const task = await api.post<Task>("/api/tasks", { ...EMPTY_DRAFT, title, due_date: quickDate || null, subject: subject ?? "" });
      setTasks((list) => [...list, task]);
      setQuickTitle("");
    } catch (err) {
      toast.error(err);
    }
  };

  const saveTask = async (draft: TaskDraft) => {
    try {
      if (editing === "new") {
        const task = await api.post<Task>("/api/tasks", draft);
        setTasks((list) => [...list, task]);
      } else if (editing) {
        const updated = await api.patch<Task>(`/api/tasks/${editing.id}`, { ...draft, clear_due_date: draft.due_date === null });
        setTasks((list) => list.map((t) => (t.id === updated.id ? updated : t)));
      }
      setEditing(null);
    } catch (err) {
      toast.error(err);
    }
  };

  const toggle = async (task: Task) => {
    // Update immediately; put it back if the server refuses.
    setTasks((list) => list.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t)));
    try {
      const updated = await api.patch<Task>(`/api/tasks/${task.id}`, { done: !task.done });
      setTasks((list) => list.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      setTasks((list) => list.map((t) => (t.id === task.id ? task : t)));
      toast.error(err);
    }
  };

  const remove = async (task: Task) => {
    try {
      await api.delete(`/api/tasks/${task.id}`);
      setTasks((list) => list.filter((t) => t.id !== task.id));
    } catch (err) {
      toast.error(err);
    }
  };

  const clearDone = async () => {
    const count = tasks.filter((t) => t.done).length;
    const ok = await confirm({ title: "Clear completed tasks?", message: `${plural(count, "completed task")} will be removed.`, confirmLabel: "Clear", danger: true });
    if (!ok) return;
    try {
      await api.delete("/api/tasks/completed");
      setTasks((list) => list.filter((t) => !t.done));
    } catch (err) {
      toast.error(err);
    }
  };

  const subjects = useMemo(() => [...new Set(tasks.map((t) => t.subject).filter(Boolean))].sort(), [tasks]);
  const visible = useMemo(() => (subject ? tasks.filter((t) => t.subject === subject) : tasks), [tasks, subject]);

  const groups = useMemo<Group[]>(() => {
    const open = visible
      .filter((t) => !t.done)
      .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.id - b.id);
    const when = (t: Task) => (t.due_date === null ? null : daysFromToday(t.due_date));
    const result: Group[] = [
      { key: "overdue", label: "Overdue", tone: "danger", tasks: open.filter((t) => { const d = when(t); return d !== null && d < 0; }) },
      { key: "today", label: "Today", tone: "accent", tasks: open.filter((t) => when(t) === 0) },
      { key: "week", label: "Next 7 days", tasks: open.filter((t) => { const d = when(t); return d !== null && d > 0 && d <= 7; }) },
      { key: "later", label: "Later", tasks: open.filter((t) => { const d = when(t); return d !== null && d > 7; }) },
      { key: "someday", label: "No date", tasks: open.filter((t) => t.due_date === null) },
    ];
    return result.filter((g) => g.tasks.length > 0);
  }, [visible]);

  const done = visible.filter((t) => t.done).sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  const openCount = visible.length - done.length;
  const progress = visible.length ? Math.round((done.length / visible.length) * 100) : 0;

  const row = (task: Task) => {
    const overdue = !task.done && task.due_date !== null && daysFromToday(task.due_date) < 0;
    return (
      <li key={task.id} className={`task ${task.done ? "done" : ""}`}>
        <button type="button" className="task-check" role="checkbox" aria-checked={task.done} aria-label={task.done ? "Mark as not done" : "Mark as done"} onClick={() => void toggle(task)}>
          <Icon name={task.done ? "checkCircle" : "circle"} size={21} />
        </button>
        <div className="task-main">
          <b>{task.title}</b>
          {task.details && <p>{task.details}</p>}
          <div className="task-tags">
            {task.due_date && <span className={`badge ${overdue ? "danger" : ""}`}><Icon name="calendar" size={12} />{formatDueDate(task.due_date)}</span>}
            {task.subject && <span className="badge accent">{task.subject}</span>}
            {task.priority === "high" && !task.done && <span className="badge danger"><Icon name="flag" size={12} />High priority</span>}
            {task.priority === "low" && !task.done && <span className="badge">Low priority</span>}
          </div>
        </div>
        <div className="task-actions">
          <IconButton size="sm" icon="edit" label="Edit task" onClick={() => setEditing(task)} />
          <IconButton size="sm" icon="trash" label="Delete task" danger onClick={() => void remove(task)} />
        </div>
      </li>
    );
  };

  return (
    <div className="page planner">
      <header className="page-head">
        <h1>Planner</h1>
        {visible.length > 0 && <span className="badge">{openCount} open</span>}
        <span className="spacer" />
        <Button size="sm" variant="soft" icon="sparkles" onClick={() => setPlanning(true)}>Plan with AI</Button>
        <Button size="sm" variant="primary" icon="plus" onClick={() => setEditing("new")}>New task</Button>
      </header>

      <div className="page-scroll">
        <div className="page-narrow planner-body">
          <form className="quick-add card" onSubmit={quickAdd}>
            <Icon name="plus" size={18} />
            <input value={quickTitle} maxLength={200} placeholder="Add a task and press Enter" aria-label="New task" onChange={(e) => setQuickTitle(e.target.value)} />
            <input type="date" className="quick-date" value={quickDate} aria-label="Due date" onChange={(e) => setQuickDate(e.target.value)} />
            <Button size="sm" variant="primary" type="submit" disabled={!quickTitle.trim()}>Add</Button>
          </form>

          {subjects.length > 0 && (
            <div className="subject-filter">
              <button type="button" className={`chip ${subject === null ? "on" : ""}`} onClick={() => setSubject(null)}>All subjects</button>
              {subjects.map((s) => (
                <button key={s} type="button" className={`chip ${subject === s ? "on" : ""}`} onClick={() => setSubject(subject === s ? null : s)}>{s}</button>
              ))}
            </div>
          )}

          {visible.length > 0 && (
            <div className="planner-progress">
              <div className="progress"><span style={{ width: `${progress}%` }} /></div>
              <span>{done.length} of {visible.length} done</span>
            </div>
          )}

          {loaded && tasks.length === 0 && (
            <EmptyState icon="planner" title="Nothing planned yet" text="Add tasks yourself, or give Zyqra your exam date and let it build a day-by-day study plan.">
              <Button variant="primary" icon="sparkles" onClick={() => setPlanning(true)}>Plan with AI</Button>
            </EmptyState>
          )}
          {loaded && tasks.length > 0 && openCount === 0 && (
            <p className="notice success"><Icon name="checkCircle" size={16} />Everything here is done. Nice work.</p>
          )}

          {groups.map((group) => (
            <section key={group.key}>
              <h2 className={`section-title ${group.tone ?? ""}`}>{group.label}<span>{group.tasks.length}</span></h2>
              <ul className="task-list">{group.tasks.map(row)}</ul>
            </section>
          ))}

          {done.length > 0 && (
            <section>
              <div className="done-head">
                <button type="button" className="section-title" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
                  <Icon name={showDone ? "chevronDown" : "chevronRight"} size={14} />
                  Completed<span>{done.length}</span>
                </button>
                {showDone && <Button size="sm" variant="ghost" icon="trash" onClick={() => void clearDone()}>Clear completed</Button>}
              </div>
              {showDone && <ul className="task-list">{done.map(row)}</ul>}
            </section>
          )}
        </div>
      </div>

      {editing !== null && <TaskEditor task={editing === "new" ? null : editing} onSave={saveTask} onClose={() => setEditing(null)} />}
      {planning && (
        <PlanDialog
          onClose={() => setPlanning(false)}
          onAdded={(count) => { setPlanning(false); toast.success(`${plural(count, "task")} added to your planner.`); void load(); }}
        />
      )}
    </div>
  );
}
