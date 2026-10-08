import { useCallback, useEffect, useRef, useState } from "react";
import type { PageProps } from "../../components/layout/AppShell";
import SplitView from "../../components/layout/SplitView";
import { Button, IconButton } from "../../components/ui/Button";
import Icon from "../../components/ui/Icon";
import type { IconName } from "../../components/ui/Icon";
import Markdown from "../../components/ui/Markdown";
import Modal from "../../components/ui/Modal";
import { EmptyState, Loading, Menu, MenuItem, ModelBadge, Segmented, Spinner } from "../../components/ui/primitives";
import { useApp } from "../../context/AppContext";
import { useUI } from "../../context/UIContext";
import { api, errorMessage } from "../../lib/api";
import { downloadText, plural, timeAgo } from "../../lib/format";
import type { ModelMeta, Note, NoteDetail } from "../../lib/types";
import "./notes.css";

type View = "write" | "preview";
type SaveState = "saved" | "dirty" | "saving" | "error";

const AUTOSAVE_MS = 900;

const ACTION_ICON: Record<string, IconName> = {
  summarize: "list",
  key_points: "target",
  simplify: "idea",
  improve: "edit",
  questions: "quiz",
};

const FORMATS: { icon: IconName; label: string; apply: (text: string) => { before: string; after: string; block?: boolean } }[] = [
  { icon: "heading", label: "Heading", apply: () => ({ before: "## ", after: "", block: true }) },
  { icon: "bold", label: "Bold", apply: () => ({ before: "**", after: "**" }) },
  { icon: "italic", label: "Italic", apply: () => ({ before: "*", after: "*" }) },
  { icon: "list", label: "Bullet list", apply: () => ({ before: "- ", after: "", block: true }) },
  { icon: "checkbox", label: "Checklist", apply: () => ({ before: "- [ ] ", after: "", block: true }) },
  { icon: "code", label: "Code", apply: (text) => (text.includes("\n") ? { before: "```\n", after: "\n```" } : { before: "`", after: "`" }) },
];

// ─── AI result dialog ─────────────────────────────────────────
interface AIRun {
  action: string;
  label: string;
  status: "loading" | "done" | "error";
  text: string;
  model: ModelMeta | null;
}

interface AIDialogProps {
  run: AIRun;
  onClose: () => void;
  onAppend: () => void;
  onReplace: () => void;
  onSaveAsNew: () => void;
}

function AIDialog({ run, onClose, onAppend, onReplace, onSaveAsNew }: AIDialogProps) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(run.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Modal
      title={run.label}
      size="wide"
      onClose={onClose}
      footer={
        run.status === "done" ? (
          <>
            <Button variant="ghost" icon={copied ? "check" : "copy"} onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</Button>
            <Button icon="note" onClick={onSaveAsNew}>Save as new note</Button>
            {run.action === "improve" && <Button icon="repeat" onClick={onReplace}>Replace note</Button>}
            <Button variant="primary" icon="plus" onClick={onAppend}>Add to note</Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>Close</Button>
        )
      }
    >
      {run.status === "loading" && <div className="ai-wait"><Spinner size={22} /><span>Working on it…</span></div>}
      {run.status === "error" && <p className="notice danger"><Icon name="alertTriangle" size={16} />{run.text}</p>}
      {run.status === "done" && (
        <>
          {run.model && <div><ModelBadge model={run.model} /></div>}
          <Markdown>{run.text}</Markdown>
        </>
      )}
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function NotesPage({ active }: PageProps) {
  const { meta, navigate, intent, takeIntent } = useApp();
  const { toast, confirm } = useUI();

  const [notes, setNotes] = useState<Note[]>([]);
  const [noteId, setNoteId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [view, setView] = useState<View>("write");
  const [filter, setFilter] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [aiRun, setAIRun] = useState<AIRun | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const latest = useRef({ id: 0, title: "", content: "" });
  const dirty = useRef(false);
  const timer = useRef(0);

  const loadNotes = useCallback(async () => {
    try {
      setNotes(await api.get<Note[]>("/api/notes"));
    } catch (err) {
      toast.error(err);
    }
  }, [toast]);

  /** Write pending edits to the server. Safe to call at any time. */
  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!dirty.current || !latest.current.id) return;
    const snapshot = { ...latest.current };
    dirty.current = false;
    setSaveState("saving");
    try {
      const updated = await api.patch<Note>(`/api/notes/${snapshot.id}`, { title: snapshot.title, content: snapshot.content });
      setNotes((list) => list.map((n) => (n.id === updated.id ? updated : n)));
      setSaveState(dirty.current ? "dirty" : "saved");
    } catch {
      dirty.current = true;
      setSaveState("error");
    }
  }, []);

  const edit = (next: { title?: string; content?: string }) => {
    if (next.title !== undefined) setTitle(next.title);
    if (next.content !== undefined) setContent(next.content);
    latest.current = { ...latest.current, ...next };
    dirty.current = true;
    setSaveState("dirty");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
  };

  const show = (note: NoteDetail) => {
    latest.current = { id: note.id, title: note.title === "Untitled note" ? "" : note.title, content: note.content };
    dirty.current = false;
    setNoteId(note.id);
    setTitle(latest.current.title);
    setContent(note.content);
    setPinned(note.pinned);
    setSaveState("saved");
  };

  const openNote = useCallback(async (id: number) => {
    await save();
    setPanelOpen(false);
    setLoading(true);
    try {
      show(await api.get<NoteDetail>(`/api/notes/${id}`));
      setView("write");
    } catch (err) {
      toast.error(err);
    }
    setLoading(false);
  }, [save, toast]);

  const createNote = async (initial?: { title: string; content: string }) => {
    await save();
    try {
      const note = await api.post<NoteDetail>("/api/notes", initial ?? {});
      show(note);
      setView("write");
      setPanelOpen(false);
      await loadNotes();
      if (!initial) window.setTimeout(() => document.getElementById("note-title")?.focus(), 0);
    } catch (err) {
      toast.error(err);
    }
  };

  useEffect(() => {
    if (active) void loadNotes();
    else void save(); // leaving the page: don't lose the last keystrokes
  }, [active, loadNotes, save]);

  useEffect(() => {
    if (!active || !intent) return;
    const next = takeIntent();
    if (next?.noteId) void openNote(next.noteId);
  }, [active, intent, takeIntent, openNote]);

  // Ctrl+S saves immediately.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, save]);

  // Flush on unmount (e.g. logging out).
  useEffect(() => () => void save(), [save]);

  const deleteNote = async (target: Note | { id: number; title: string }) => {
    const ok = await confirm({ title: "Delete this note?", message: `“${target.title || "Untitled note"}” will be permanently deleted.`, confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      if (target.id === noteId) {
        window.clearTimeout(timer.current);
        dirty.current = false;
      }
      await api.delete(`/api/notes/${target.id}`);
      setNotes((list) => list.filter((n) => n.id !== target.id));
      if (target.id === noteId) setNoteId(null);
    } catch (err) {
      toast.error(err);
    }
  };

  const togglePin = async () => {
    if (noteId === null) return;
    try {
      await api.patch<Note>(`/api/notes/${noteId}`, { pinned: !pinned });
      setPinned(!pinned);
      await loadNotes();
    } catch (err) {
      toast.error(err);
    }
  };

  // ── formatting ──────────────────────────────────────────────
  const format = (index: number) => {
    const el = editorRef.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const selected = content.slice(start, end);
    const { before, after, block } = FORMATS[index].apply(selected);
    let next: string;
    let cursorStart: number;
    let cursorEnd: number;
    if (block) {
      // Prefix every selected line (or the current line).
      const lineStart = content.lastIndexOf("\n", start - 1) + 1;
      const segment = content.slice(lineStart, end);
      const prefixed = segment.split("\n").map((line) => before + line).join("\n");
      next = content.slice(0, lineStart) + prefixed + content.slice(end);
      cursorStart = cursorEnd = lineStart + prefixed.length;
    } else {
      next = content.slice(0, start) + before + selected + after + content.slice(end);
      cursorStart = start + before.length;
      cursorEnd = cursorStart + selected.length;
    }
    edit({ content: next });
    window.requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(cursorStart, cursorEnd);
    });
  };

  // ── AI tools ────────────────────────────────────────────────
  const runAI = async (action: string, label: string) => {
    if (noteId === null) return;
    await save(); // the server reads the note from the database
    setAIRun({ action, label, status: "loading", text: "", model: null });
    try {
      const result = await api.post<{ text: string; model: ModelMeta }>(`/api/notes/${noteId}/ai`, { action });
      setAIRun({ action, label, status: "done", text: result.text, model: result.model });
    } catch (err) {
      setAIRun({ action, label, status: "error", text: errorMessage(err), model: null });
    }
  };

  const goGenerate = async (route: "quiz" | "flashcards") => {
    if (noteId === null) return;
    await save();
    navigate(route, { fromNoteId: noteId });
  };

  const filtered = notes.filter((n) => {
    const q = filter.trim().toLowerCase();
    return !q || n.title.toLowerCase().includes(q) || n.preview.toLowerCase().includes(q);
  });

  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const hasContent = content.trim().length > 0;
  const actions = meta?.note_actions ?? [];

  const panel = (
    <>
      <div className="panel-head">
        <h2>Notes</h2>
        <Button size="sm" variant="soft" icon="plus" onClick={() => void createNote()}>New</Button>
      </div>
      {notes.length > 4 && (
        <div className="panel-tools">
          <div className="input-icon">
            <Icon name="search" size={15} />
            <input className="input" placeholder="Search notes" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        </div>
      )}
      <div className="panel-list">
        {notes.length === 0 && <p className="panel-empty">No notes yet.<br />Create one to start writing.</p>}
        {notes.length > 0 && filtered.length === 0 && <p className="panel-empty">No notes match “{filter}”.</p>}
        {filtered.map((note) => (
          <div
            key={note.id}
            role="button"
            tabIndex={0}
            className={`panel-item ${note.id === noteId ? "on" : ""}`}
            onClick={() => void openNote(note.id)}
            onKeyDown={(e) => e.key === "Enter" && void openNote(note.id)}
          >
            <div className="panel-item-title">
              {note.pinned && <Icon name="pinTack" size={13} />}
              <span>{note.title}</span>
            </div>
            <div className="panel-item-meta"><span className="truncate">{note.preview || "Empty note"}</span></div>
            <div className="panel-item-meta"><span>{timeAgo(note.updated_at) || "Earlier"} · {plural(note.word_count, "word")}</span></div>
            <div className="panel-item-actions" onClick={(e) => e.stopPropagation()}>
              <IconButton size="sm" icon="trash" label="Delete" danger onClick={() => void deleteNote(note)} />
            </div>
          </div>
        ))}
      </div>
    </>
  );

  return (
    <SplitView panel={panel} panelOpen={panelOpen} onPanelClose={() => setPanelOpen(false)}>
      <div className="page notes">
        {noteId === null ? (
          <>
            <header className="page-head">
              <IconButton className="only-narrow" icon="list" label="Show notes" onClick={() => setPanelOpen(true)} />
              <h1>Notes</h1>
            </header>
            {loading ? <Loading /> : (
              <EmptyState icon="note" title="Your notes" text="Write in Markdown, then let AI summarise them or turn them into a quiz or flashcards.">
                <Button variant="primary" icon="plus" onClick={() => void createNote()}>New note</Button>
              </EmptyState>
            )}
          </>
        ) : (
          <>
            <header className="page-head note-head">
              <IconButton className="only-narrow" icon="list" label="Show notes" onClick={() => setPanelOpen(true)} />
              <Segmented
                label="Editor view"
                value={view}
                onChange={setView}
                options={[{ value: "write", label: "Write", icon: "edit" }, { value: "preview", label: "Preview", icon: "eye" }]}
              />
              {view === "write" && (
                <div className="note-formats">
                  {FORMATS.map((f, index) => (
                    <IconButton key={f.label} size="sm" icon={f.icon} label={f.label} onClick={() => format(index)} />
                  ))}
                </div>
              )}
              <span className="spacer" />
              <span className={`save-state ${saveState}`} aria-live="polite">
                {saveState === "saving" && <><Spinner size={13} />Saving…</>}
                {saveState === "saved" && <><Icon name="check" size={13} />Saved</>}
                {saveState === "dirty" && "Unsaved changes"}
                {saveState === "error" && <><Icon name="alertCircle" size={13} />Couldn't save — retrying on next edit</>}
              </span>
              <Menu
                align="right"
                trigger={(toggle) => <Button size="sm" variant="soft" icon="sparkles" iconRight="chevronDown" onClick={toggle} disabled={!hasContent}>AI tools</Button>}
              >
                {(close) => (
                  <>
                    <div className="menu-label">With this note</div>
                    {actions.map((a) => (
                      <MenuItem key={a.id} icon={ACTION_ICON[a.id] ?? "sparkles"} label={a.label} onClick={() => { close(); void runAI(a.id, a.label); }} />
                    ))}
                    <hr className="divider" style={{ margin: "5px 0" }} />
                    <MenuItem icon="quiz" label="Quiz me on this note" onClick={() => { close(); void goGenerate("quiz"); }} />
                    <MenuItem icon="cards" label="Make flashcards" onClick={() => { close(); void goGenerate("flashcards"); }} />
                  </>
                )}
              </Menu>
              <Menu align="right" trigger={(toggle) => <IconButton icon="more" label="Note actions" onClick={toggle} />}>
                {(close) => (
                  <>
                    <MenuItem icon="pinTack" label={pinned ? "Unpin note" : "Pin to top"} onClick={() => { close(); void togglePin(); }} />
                    <MenuItem icon="download" label="Download as Markdown" onClick={() => { close(); downloadText(`${title.trim() || "note"}.md`, `# ${title.trim() || "Untitled note"}\n\n${content}`); }} />
                    <MenuItem icon="trash" label="Delete note" danger onClick={() => { close(); void deleteNote({ id: noteId, title }); }} />
                  </>
                )}
              </Menu>
            </header>

            {loading ? <Loading /> : (
              <div className="page-scroll">
                <div className="note-sheet">
                  <input
                    id="note-title"
                    className="note-title"
                    value={title}
                    placeholder="Untitled note"
                    maxLength={200}
                    onChange={(e) => edit({ title: e.target.value })}
                  />
                  {view === "write" ? (
                    <textarea
                      ref={editorRef}
                      className="note-editor"
                      value={content}
                      placeholder={"Start writing…\n\nMarkdown works here: # headings, **bold**, - lists, `code`, and $maths$."}
                      onChange={(e) => edit({ content: e.target.value })}
                    />
                  ) : hasContent ? (
                    <div className="note-preview"><Markdown>{content}</Markdown></div>
                  ) : (
                    <p className="muted note-preview">Nothing to preview yet.</p>
                  )}
                </div>
              </div>
            )}
            <footer className="note-foot">
              <span>{plural(words, "word")} · {plural(content.length, "character")}</span>
            </footer>
          </>
        )}
      </div>

      {aiRun && (
        <AIDialog
          run={aiRun}
          onClose={() => setAIRun(null)}
          onAppend={() => { edit({ content: `${content.trimEnd()}\n\n---\n\n${aiRun.text}\n` }); setAIRun(null); toast.success("Added to the end of your note."); }}
          onReplace={() => { edit({ content: aiRun.text }); setAIRun(null); toast.success("Note replaced with the improved version."); }}
          onSaveAsNew={() => { const run = aiRun; setAIRun(null); void createNote({ title: `${run.label} — ${title.trim() || "note"}`, content: run.text }); }}
        />
      )}
    </SplitView>
  );
}
