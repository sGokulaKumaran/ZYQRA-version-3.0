import { useState, useEffect, useRef, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────
interface NoteMeta { id: number; title: string; content: string; }

const API = "http://127.0.0.1:8000";
const USER_ID = 1;

// ─── Debounce hook ────────────────────────────────────────
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

// ─── Component ────────────────────────────────────────────
export default function Notes() {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState(true);
  const [savingMsg, setSavingMsg] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-save debounce
  const debouncedTitle = useDebounce(title, 800);
  const debouncedContent = useDebounce(content, 800);

  useEffect(() => { loadNotes(); }, []);

  const loadNotes = async () => {
    try {
      const res = await fetch(`${API}/notes/${USER_ID}`);
      const data = await res.json();
      setNotes(Array.isArray(data) ? data : []);
    } catch {}
  };

  // ─── Auto-save when debounced values change ──────────────
  useEffect(() => {
    if (activeId === null) return;
    if (saved) return;
    saveNote();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedTitle, debouncedContent]);

  const saveNote = useCallback(async () => {
    if (activeId === null) return;
    setSavingMsg("Saving...");
    try {
      await fetch(`${API}/note/${activeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title || "Untitled Note", content }),
      });
      setSaved(true);
      setSavingMsg("Saved ✓");
      setNotes((prev) =>
        prev.map((n) => n.id === activeId ? { ...n, title: title || "Untitled Note", content } : n)
      );
      setTimeout(() => setSavingMsg(""), 1800);
    } catch {
      setSavingMsg("Save failed");
    }
  }, [activeId, title, content]);

  // ─── Create new note ────────────────────────────────────
  const createNote = async () => {
    try {
      const res = await fetch(`${API}/create_note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled Note", content: "", user_id: USER_ID }),
      });
      const data = await res.json();
      setNotes((prev) => [data, ...prev]);
      openNote(data);
    } catch {}
  };

  // ─── Open a note ────────────────────────────────────────
  const openNote = (note: NoteMeta) => {
    setActiveId(note.id);
    setTitle(note.title === "Untitled Note" ? "" : note.title);
    setContent(note.content || "");
    setSaved(true);
    setSavingMsg("");
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  // ─── Delete ─────────────────────────────────────────────
  const deleteNote = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await fetch(`${API}/note/${id}`, { method: "DELETE" });
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (activeId === id) { setActiveId(null); setTitle(""); setContent(""); }
  };

  // ─── Rename ─────────────────────────────────────────────
  const renameNote = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const newName = prompt("Enter new title");
    if (!newName) return;
    await fetch(`${API}/rename_note/${id}?title=${encodeURIComponent(newName)}`, { method: "PUT" });
    setNotes((prev) => prev.map((n) => n.id === id ? { ...n, title: newName } : n));
    if (activeId === id) setTitle(newName);
  };

  const handleTitleChange = (val: string) => {
    setTitle(val); setSaved(false);
  };

  const handleContentChange = (val: string) => {
    setContent(val); setSaved(false);
    // Auto-grow textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  };

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;

  // ─── Render ─────────────────────────────────────────────
  return (
    <div className="nt-root">
      <style>{CSS}</style>
      <div className="nt-layout">

        {/* ── Sidebar ── */}
        <div className="nt-sidebar">
          <div className="nt-sb-header">
            <span className="nt-sb-title">📝 Notes</span>
            <button className="nt-sb-new" onClick={createNote}>+ New</button>
          </div>
          <div className="nt-sb-list">
            {notes.length === 0 && (
              <p className="nt-sb-empty">No notes yet.<br />Click + New to start!</p>
            )}
            {notes.map((n) => (
              <div
                key={n.id}
                className={`nt-note-item ${activeId === n.id ? "nt-note-active" : ""}`}
                onClick={() => openNote(n)}
              >
                <div className="nt-note-top">
                  <span className="nt-note-title">{n.title || "Untitled Note"}</span>
                  <div className="nt-note-actions">
                    <button onClick={(e) => renameNote(n.id, e)} title="Rename">✏</button>
                    <button onClick={(e) => deleteNote(n.id, e)} title="Delete">🗑</button>
                  </div>
                </div>
                <p className="nt-note-preview">
                  {n.content ? n.content.slice(0, 50) + (n.content.length > 50 ? "…" : "") : "Empty note"}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Editor ── */}
        <div className="nt-editor">
          {activeId === null ? (
            <div className="nt-empty-state">
              <div className="nt-empty-icon">📝</div>
              <h2 className="nt-empty-title">Your Notes</h2>
              <p className="nt-empty-sub">Select a note from the sidebar or create a new one.</p>
              <button className="nt-empty-btn" onClick={createNote}>+ Create Note</button>
            </div>
          ) : (
            <div className="nt-edit-area">
              {/* Toolbar */}
              <div className="nt-toolbar">
                <div className="nt-toolbar-left">
                  <span className="nt-word-count">{wordCount} words · {charCount} chars</span>
                </div>
                <div className="nt-toolbar-right">
                  {savingMsg && (
                    <span className={`nt-save-status ${saved ? "nt-saved" : "nt-saving"}`}>
                      {savingMsg}
                    </span>
                  )}
                  {!saved && !savingMsg && <span className="nt-unsaved">● Unsaved</span>}
                  <button className="nt-save-btn" onClick={saveNote}>Save</button>
                </div>
              </div>

              {/* Title */}
              <input
                className="nt-title-input"
                placeholder="Note title..."
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
              />

              {/* Divider */}
              <div className="nt-divider" />

              {/* Content */}
              <textarea
                ref={textareaRef}
                className="nt-content-textarea"
                placeholder="Start writing... Your notes auto-save as you type."
                value={content}
                onChange={(e) => handleContentChange(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────
const CSS = `
  .nt-root {
    width: 100%; height: 100%; overflow: hidden;
    background: #0f172a; color: #e2e8f0;
    font-family: 'DM Sans', 'Segoe UI', sans-serif;
  }
  .nt-layout { display: flex; height: 100%; }

  /* ── Sidebar ── */
  .nt-sidebar {
    width: 240px; background: #020617;
    border-right: 1px solid rgba(255,255,255,0.06);
    display: flex; flex-direction: column; overflow: hidden; flex-shrink: 0;
  }
  .nt-sb-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 14px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;
  }
  .nt-sb-title { font-size: 13px; font-weight: 700; color: #94a3b8; }
  .nt-sb-new {
    font-size: 11px; padding: 4px 10px; border-radius: 6px;
    border: 1px solid rgba(59,130,246,0.4); background: rgba(59,130,246,0.12);
    color: #93c5fd; cursor: pointer; font-family: inherit; transition: all 0.15s;
  }
  .nt-sb-new:hover { background: rgba(59,130,246,0.22); }
  .nt-sb-list { flex: 1; overflow-y: auto; padding: 8px; }
  .nt-sb-empty { font-size: 12px; color: #334155; text-align: center; padding: 20px 8px; line-height: 1.6; }

  .nt-note-item {
    padding: 10px; border-radius: 8px; cursor: pointer;
    transition: background 0.15s; border: 1px solid transparent; margin-bottom: 4px;
  }
  .nt-note-item:hover { background: rgba(255,255,255,0.04); }
  .nt-note-active { background: rgba(59,130,246,0.12) !important; border-color: rgba(59,130,246,0.25) !important; }
  .nt-note-top { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
  .nt-note-title { font-size: 12px; font-weight: 600; color: #cbd5e1; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nt-note-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
  .nt-note-item:hover .nt-note-actions { opacity: 1; }
  .nt-note-actions button { background: none; border: none; cursor: pointer; font-size: 11px; color: #475569; padding: 2px 3px; border-radius: 4px; transition: color 0.15s; }
  .nt-note-actions button:hover { color: #f87171; }
  .nt-note-preview { font-size: 11px; color: #334155; margin: 4px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* ── Editor ── */
  .nt-editor { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

  .nt-empty-state {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 12px; text-align: center; padding: 40px;
  }
  .nt-empty-icon { font-size: 48px; }
  .nt-empty-title { font-size: 22px; font-weight: 700; color: #f1f5f9; margin: 0; }
  .nt-empty-sub { font-size: 14px; color: #475569; margin: 0; }
  .nt-empty-btn {
    padding: 12px 28px; border-radius: 10px; background: #2563eb;
    border: none; color: white; font-size: 14px; font-weight: 700;
    cursor: pointer; font-family: inherit; transition: background 0.2s;
  }
  .nt-empty-btn:hover { background: #1d4ed8; }

  .nt-edit-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

  /* Toolbar */
  .nt-toolbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 28px; border-bottom: 1px solid rgba(255,255,255,0.05);
    background: #020617; flex-shrink: 0;
  }
  .nt-toolbar-left { display: flex; align-items: center; gap: 12px; }
  .nt-toolbar-right { display: flex; align-items: center; gap: 10px; }
  .nt-word-count { font-size: 11px; color: #334155; }
  .nt-save-status { font-size: 12px; }
  .nt-saved { color: #22c55e; }
  .nt-saving { color: #f59e0b; }
  .nt-unsaved { font-size: 11px; color: #f59e0b; }
  .nt-save-btn {
    padding: 5px 14px; border-radius: 7px;
    background: rgba(37,99,235,0.2); border: 1px solid rgba(37,99,235,0.35);
    color: #93c5fd; font-size: 12px; font-weight: 600;
    cursor: pointer; font-family: inherit; transition: all 0.15s;
  }
  .nt-save-btn:hover { background: rgba(37,99,235,0.3); }

  /* Title input */
  .nt-title-input {
    width: 100%; padding: 20px 28px 8px;
    background: transparent; border: none; outline: none;
    font-size: 26px; font-weight: 800; color: #f1f5f9;
    font-family: 'DM Sans', 'Segoe UI', sans-serif;
    box-sizing: border-box;
  }
  .nt-title-input::placeholder { color: #1e293b; }

  /* Divider */
  .nt-divider { height: 1px; background: rgba(255,255,255,0.05); margin: 0 28px; flex-shrink: 0; }

  /* Content textarea */
  .nt-content-textarea {
    flex: 1; width: 100%; padding: 20px 28px;
    background: transparent; border: none; outline: none; resize: none;
    font-size: 16px; line-height: 1.85; color: #cbd5e1;
    font-family: 'Georgia', 'Times New Roman', serif;
    box-sizing: border-box; overflow-y: auto; min-height: 200px;
  }
  .nt-content-textarea::placeholder { color: #1e293b; }
`;
