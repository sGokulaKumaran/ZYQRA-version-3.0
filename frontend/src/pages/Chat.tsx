import ReactMarkdown from "react-markdown";
import { useEffect, useRef, useState } from "react";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import Quiz from "./Quiz";
import Flashcards from "./Flashcards";
import Notes from "./Notes";
import Dashboard from "./Dashboard";
import type { Theme } from "./ThemeContext";
import { useTheme } from "./ThemeContext";

type Message = { role: "user" | "ai"; text: string };
type SidebarTab = "chat" | "quiz" | "flash" | "notes" | "dashboard";
type SettingsPage = "main" | "theme" | "account";

const API = "http://127.0.0.1:8000";

// ─── Theme Preview Mini SVG ───────────────────────────────
function ThemePreview({ id }: { id: Theme }) {
  const p: Record<Theme, { bg: string; sb: string; card: string; accent: string; text: string }> = {
    default: { bg: "#0f172a", sb: "#020617", card: "#1e293b", accent: "#2563eb", text: "#94a3b8" },
    dark:    { bg: "#000000", sb: "#0a0a0a", card: "#111111", accent: "#6366f1", text: "#71717a" },
    light:   { bg: "#f8f7f4", sb: "#ffffff", card: "#efefeb", accent: "#2563eb", text: "#64748b" },
  };
  const c = p[id];
  return (
    <svg viewBox="0 0 120 70" xmlns="http://www.w3.org/2000/svg" style={{ width: "100%", display: "block" }}>
      <rect width="120" height="70" fill={c.bg} />
      <rect width="30" height="70" fill={c.sb} />
      <rect x="3" y="6" width="22" height="3" rx="1.5" fill={c.accent} opacity="0.9" />
      <rect x="3" y="14" width="18" height="2" rx="1" fill={c.text} opacity="0.5" />
      <rect x="3" y="20" width="18" height="2" rx="1" fill={c.text} opacity="0.3" />
      <rect x="3" y="26" width="18" height="2" rx="1" fill={c.text} opacity="0.3" />
      <rect x="34" y="6" width="80" height="38" rx="5" fill={c.card} />
      <rect x="39" y="11" width="36" height="2.5" rx="1" fill={c.text} opacity="0.6" />
      <rect x="39" y="17" width="58" height="2" rx="1" fill={c.text} opacity="0.3" />
      <rect x="39" y="22" width="48" height="2" rx="1" fill={c.text} opacity="0.3" />
      <rect x="39" y="27" width="52" height="2" rx="1" fill={c.text} opacity="0.3" />
      <rect x="39" y="35" width="18" height="6" rx="3" fill={c.accent} />
      <rect x="34" y="50" width="80" height="14" rx="5" fill={c.card} />
      <rect x="39" y="54" width="48" height="2" rx="1" fill={c.text} opacity="0.3" />
      <rect x="39" y="58" width="28" height="2" rx="1" fill={c.text} opacity="0.2" />
    </svg>
  );
}

// ─── Settings Modal ───────────────────────────────────────
function SettingsModal({ onClose, onLogout }: { onClose: () => void; onLogout: () => void }) {
  const { theme, setTheme } = useTheme();
  const [page, setPage] = useState<SettingsPage>("main");
  const [newUsername, setNewUsername] = useState("");
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const username = localStorage.getItem("username") || "User";

  const goBack = () => { setPage("main"); setMsg(null); };

  const saveUsername = async () => {
    if (!newUsername.trim()) return;
    setSaving(true); setMsg(null);
    try {
      const r = await fetch(`${API}/rename_user`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ old_username: username, new_username: newUsername.trim() }),
      });
      const d = await r.json();
      if (d.status === "success") {
        localStorage.setItem("username", newUsername.trim());
        setMsg({ text: "Username updated successfully!", ok: true });
        setNewUsername("");
      } else {
        setMsg({ text: d.message || "Failed to update", ok: false });
      }
    } catch { setMsg({ text: "Server error", ok: false }); }
    setSaving(false);
  };

  const savePassword = async () => {
    if (!currentPwd || !newPwd) { setMsg({ text: "Fill all password fields", ok: false }); return; }
    if (newPwd !== confirmPwd) { setMsg({ text: "New passwords don't match", ok: false }); return; }
    if (newPwd.length < 4) { setMsg({ text: "Password must be at least 4 characters", ok: false }); return; }
    setSaving(true); setMsg(null);
    try {
      const r = await fetch(`${API}/change_password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, current_password: currentPwd, new_password: newPwd }),
      });
      const d = await r.json();
      if (d.status === "success") {
        setMsg({ text: "Password changed successfully!", ok: true });
        setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
      } else {
        setMsg({ text: d.message || "Failed", ok: false });
      }
    } catch { setMsg({ text: "Server error", ok: false }); }
    setSaving(false);
  };

  const THEMES: { id: Theme; label: string; desc: string; icon: string }[] = [
    { id: "default", label: "Default",  desc: "Cosmic Midnight — original deep navy", icon: "🌌" },
    { id: "dark",    label: "Dark",     desc: "Pure Obsidian — maximum contrast",      icon: "⬛" },
    { id: "light",   label: "Light",    desc: "Paper & Ink — warm editorial white",     icon: "☀️" },
  ];

  return (
    <div className="sm-overlay" onClick={onClose}>
      <div className="sm-modal" onClick={(e) => e.stopPropagation()}>

        <div className="sm-header">
          {page !== "main" && <button className="sm-back" onClick={goBack}>←</button>}
          <h2 className="sm-title">
            {page === "main" && "⚙️ Settings"}
            {page === "theme" && "🎨 Appearance"}
            {page === "account" && "👤 Account"}
          </h2>
          <button className="sm-close" onClick={onClose}>✕</button>
        </div>

        {/* MAIN */}
        {page === "main" && (
          <div className="sm-body">
            <div className="sm-user-chip">
              <div className="sm-avatar">{username[0]?.toUpperCase()}</div>
              <div>
                <div className="sm-user-name">{username}</div>
                <div className="sm-user-sub">Signed in to Zyqra</div>
              </div>
            </div>

            <div className="sm-section-label">Preferences</div>
            <button className="sm-row" onClick={() => setPage("theme")}>
              <span className="sm-row-icon">🎨</span>
              <div className="sm-row-info">
                <span className="sm-row-label">Appearance</span>
                <span className="sm-row-sub">Current: {THEMES.find((t) => t.id === theme)?.label}</span>
              </div>
              <span className="sm-row-arrow">›</span>
            </button>

            <div className="sm-section-label">Account</div>
            <button className="sm-row" onClick={() => setPage("account")}>
              <span className="sm-row-icon">👤</span>
              <div className="sm-row-info">
                <span className="sm-row-label">Profile & Security</span>
                <span className="sm-row-sub">Username, password</span>
              </div>
              <span className="sm-row-arrow">›</span>
            </button>

            <div className="sm-divider" />
            <button className="sm-logout-btn" onClick={onLogout}>🚪 Log Out</button>
          </div>
        )}

        {/* THEME */}
        {page === "theme" && (
          <div className="sm-body">
            <p className="sm-desc">Choose how Zyqra looks. Changes apply instantly across all pages.</p>
            <div className="sm-theme-list">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  className={`sm-theme-card ${theme === t.id ? "sm-theme-active" : ""}`}
                  onClick={() => setTheme(t.id)}
                >
                  <div className="sm-theme-preview">
                    <ThemePreview id={t.id} />
                  </div>
                  <div className="sm-theme-footer">
                    <span className="sm-theme-icon">{t.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div className="sm-theme-name">{t.label}</div>
                      <div className="sm-theme-desc">{t.desc}</div>
                    </div>
                    {theme === t.id && <span className="sm-theme-check">✓</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ACCOUNT */}
        {page === "account" && (
          <div className="sm-body">
            {msg && <div className={`sm-msg ${msg.ok ? "sm-msg-ok" : "sm-msg-err"}`}>{msg.ok ? "✓" : "⚠"} {msg.text}</div>}

            <div className="sm-section-label">Change Username</div>
            <div className="sm-field-group">
              <div className="sm-field">
                <label className="sm-field-label">Current</label>
                <input className="sm-input sm-input-disabled" value={username} disabled />
              </div>
              <div className="sm-field">
                <label className="sm-field-label">New Username</label>
                <input className="sm-input" placeholder="Enter new username" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
              </div>
              <button className="sm-save-btn" onClick={saveUsername} disabled={saving || !newUsername.trim()}>
                {saving ? "Saving…" : "Save Username"}
              </button>
            </div>

            <div className="sm-divider" />

            <div className="sm-section-label">Change Password</div>
            <div className="sm-field-group">
              <div className="sm-field">
                <label className="sm-field-label">Current Password</label>
                <input className="sm-input" type="password" placeholder="••••••••" value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)} />
              </div>
              <div className="sm-field">
                <label className="sm-field-label">New Password</label>
                <input className="sm-input" type="password" placeholder="••••••••" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
              </div>
              <div className="sm-field">
                <label className="sm-field-label">Confirm New Password</label>
                <input className="sm-input" type="password" placeholder="••••••••" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} />
              </div>
              <button className="sm-save-btn" onClick={savePassword} disabled={saving || !currentPwd || !newPwd}>
                {saving ? "Saving…" : "Change Password"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Chat ─────────────────────────────────────────────
export default function Chat({ onLogout }: { onLogout: () => void }) {

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [chats, setChats] = useState<any[]>([]);
  const [currentChat, setCurrentChat] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<SidebarTab>("chat");
  const [showSettings, setShowSettings] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API}/get_chats/1`).then((r) => r.json()).then((d) => setChats(d)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!currentChat) return;
    fetch(`${API}/get_messages/${currentChat}`).then((r) => r.json()).then((d) => setMessages(d)).catch(() => {});
  }, [currentChat]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const createChat = async () => {
    if (currentChat && messages.length === 0) return;
    try {
      const r = await fetch(`${API}/create_chat?user_id=1`, { method: "POST" });
      const d = await r.json();
      setCurrentChat(d.chat_id); setMessages([]);
      const u = await fetch(`${API}/get_chats/1`);
      setChats(await u.json());
    } catch {}
  };

  const deleteChat = async (id: number) => {
    await fetch(`${API}/delete_chat/${id}`, { method: "DELETE" });
    setChats((p) => p.filter((c) => c.id !== id));
    if (currentChat === id) { setCurrentChat(null); setMessages([]); }
  };

  const renameChat = async (id: number) => {
    const n = prompt("Enter new name"); if (!n) return;
    await fetch(`${API}/rename_chat/${id}?title=${encodeURIComponent(n)}`, { method: "PUT" });
    setChats((p) => p.map((c) => c.id === id ? { ...c, title: n } : c));
  };

  const sendMessage = async () => {
    if (!input.trim() || !currentChat) return;
    const userMsg: Message = { role: "user", text: input.trim() };
    setMessages((p) => [...p, userMsg]);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setLoading(true);
    try {
      const r = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg.text, chat_id: currentChat }),
      });
      const d = await r.json();
      setMessages((p) => [...p, { role: "ai", text: d.reply || "Error." }]);
    } catch {
      setMessages((p) => [...p, { role: "ai", text: "Server error." }]);
    }
    setLoading(false);
  };

  const NAV: { name: string; id: SidebarTab; icon: string }[] = [
    { name: "Chat",       id: "chat",      icon: "💬" },
    { name: "Quiz",       id: "quiz",      icon: "🧪" },
    { name: "Flashcards", id: "flash",     icon: "🃏" },
    { name: "Notes",      id: "notes",     icon: "📝" },
    { name: "Dashboard",  id: "dashboard", icon: "📊" },
  ];

  return (
    <div className="ch-root">
      <style>{CSS}</style>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} onLogout={onLogout} />}

      {/* ═══ SIDEBAR ═══ */}
      <div className="ch-sidebar">
        <div className="ch-brand">Zyqra 🚀</div>

        {activeTab === "chat" && (
          <button className="ch-new-btn" onClick={createChat}>+ New Chat</button>
        )}

        <div className="ch-nav-divider" />

        {NAV.map((item) => (
          <button
            key={item.id}
            className={`ch-nav-btn ${activeTab === item.id ? "ch-nav-active" : ""}`}
            onClick={() => setActiveTab(item.id)}
          >
            <span className="ch-nav-icon">{item.icon}</span>
            <span className="ch-nav-label">{item.name}</span>
          </button>
        ))}

        {activeTab === "chat" && (
          <div className="ch-history">
            <div className="ch-history-label">Recent</div>
            <div className="ch-history-list">
              {chats.map((chat) => (
                <div key={chat.id} className={`ch-chat-item ${currentChat === chat.id ? "ch-chat-active" : ""}`}>
                  <span className="ch-chat-title" onClick={() => setCurrentChat(chat.id)}>{chat.title}</span>
                  <div className="ch-chat-actions">
                    <button onClick={(e) => { e.stopPropagation(); renameChat(chat.id); }} title="Rename">✏</button>
                    <button onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }} title="Delete">🗑</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ flex: activeTab !== "chat" ? 1 : 0 }} />

        <button className="ch-settings-trigger" onClick={() => setShowSettings(true)}>
          ⚙️ Settings
        </button>
      </div>

      {/* ═══════════ MAIN CONTENT ═══════════ */}
      <div className="ch-main">

        {/* ── CHAT TAB ── */}
        {activeTab === "chat" && (
          <>
            <div className="ch-messages">
              <div className="ch-messages-inner">

                {!currentChat && (
                  <div className="ch-empty">
                    <div className="ch-empty-icon">🚀</div>
                    <h2 className="ch-empty-title">Welcome to Zyqra</h2>
                    <p className="ch-empty-sub">Create a new chat to get started.</p>
                    <button className="ch-empty-btn" onClick={createChat}>+ New Chat</button>
                  </div>
                )}

                {messages.length === 0 && currentChat && (
                  <div className="ch-empty">
                    <div className="ch-empty-icon">💬</div>
                    <p className="ch-empty-sub">Start the conversation below.</p>
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div key={i} className={`ch-msg-row ${msg.role === "user" ? "ch-msg-user" : "ch-msg-ai"}`}>
                    {msg.role === "ai" && <div className="ch-ai-avatar">Z</div>}
                    <div className={`ch-bubble ${msg.role === "user" ? "ch-bubble-user" : "ch-bubble-ai"}`}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight]}
                        components={{
                          h1: ({ children }) => <h1 className="md-h1">{children}</h1>,
                          h2: ({ children }) => <h2 className="md-h2">{children}</h2>,
                          h3: ({ children }) => <h3 className="md-h3">{children}</h3>,
                          p:  ({ children }) => <p  className="md-p">{children}</p>,
                          ul: ({ children }) => <ul className="md-ul">{children}</ul>,
                          ol: ({ children }) => <ol className="md-ol">{children}</ol>,
                          li: ({ children }) => <li className="md-li">{children}</li>,
                          blockquote: ({ children }) => <blockquote className="md-blockquote">{children}</blockquote>,
                          table: ({ children }) => <div className="md-table-wrap"><table className="md-table">{children}</table></div>,
                          th: ({ children }) => <th className="md-th">{children}</th>,
                          td: ({ children }) => <td className="md-td">{children}</td>,
                          a: ({ children, href }) => <a className="md-a" href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
                          strong: ({ children }) => <strong className="md-strong">{children}</strong>,
                          em: ({ children }) => <em className="md-em">{children}</em>,
                          hr: () => <hr className="md-hr" />,
                          code({ node, className, children, ...props }: any) {
                            const isBlock = Boolean(className);
                            const lang = (className || "").replace("language-", "");
                            return isBlock ? (
                              <div className="md-code-block">
                                {lang && <div className="md-code-lang">{lang}</div>}
                                <pre className="md-pre"><code className={className} {...props}>{children}</code></pre>
                              </div>
                            ) : (
                              <code className="md-code-inline" {...props}>{children}</code>
                            );
                          },
                        }}
                      >
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                  </div>
                ))}

                {loading && (
                  <div className="ch-msg-row ch-msg-ai">
                    <div className="ch-ai-avatar">Z</div>
                    <div className="ch-thinking-bubble">
                      <span className="ch-dot" /><span className="ch-dot" /><span className="ch-dot" />
                    </div>
                  </div>
                )}
                <div ref={endRef} />
              </div>
            </div>

            <div className="ch-input-bar">
              <div className="ch-input-inner">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    if (textareaRef.current) {
                      textareaRef.current.style.height = "auto";
                      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
                    }
                  }}
                  rows={1}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  disabled={!currentChat}
                  className="ch-textarea"
                  placeholder={currentChat ? "Ask anything… (Enter to send, Shift+Enter for newline)" : "Create a chat to start…"}
                />
                <button onClick={sendMessage} disabled={!currentChat || !input.trim()} className="ch-send">Send</button>
              </div>
            </div>
          </>
        )}

        {activeTab === "quiz"      && <div className="ch-tab-wrap"><Quiz /></div>}
        {activeTab === "flash"     && <div className="ch-tab-wrap"><Flashcards /></div>}
        {activeTab === "notes"     && <div className="ch-tab-wrap"><Notes /></div>}
        {activeTab === "dashboard" && <div className="ch-tab-wrap"><Dashboard /></div>}
      </div>
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────
const CSS = `
  .ch-root {
    display: flex; height: 100vh; overflow: hidden;
    background: var(--bg-base, #0f172a);
    color: var(--text-primary, #f1f5f9);
    font-family: 'DM Sans', 'Segoe UI', sans-serif;
  }

  /* ── Sidebar ── */
  .ch-sidebar {
    width: 236px; flex-shrink: 0;
    background: var(--bg-sidebar, #020617);
    border-right: 1px solid var(--border, rgba(255,255,255,0.07));
    display: flex; flex-direction: column;
    padding: 16px 12px; height: 100%; overflow: hidden;
  }
  .ch-brand { font-size: 19px; font-weight: 800; color: var(--text-primary); margin-bottom: 12px; padding: 0 4px; }
  .ch-new-btn {
    width: 100%; padding: 8px; border-radius: 8px;
    border: 1px solid var(--border); background: var(--bg-hover, rgba(255,255,255,0.04));
    color: var(--text-secondary); font-size: 13px; font-weight: 600;
    cursor: pointer; font-family: inherit; transition: all 0.15s; margin-bottom: 4px;
  }
  .ch-new-btn:hover { background: var(--bg-active); color: var(--accent-text); border-color: var(--border-accent); }
  .ch-nav-divider { height: 1px; background: var(--border); margin: 8px 0; }

  .ch-nav-btn {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 12px; border-radius: 9px;
    border: none; cursor: pointer; width: 100%; text-align: left;
    font-family: inherit; transition: all 0.15s; margin-bottom: 2px;
    background: transparent; color: var(--sidebar-item-text, #9ca3af);
  }
  .ch-nav-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
  .ch-nav-active { background: var(--accent, #2563eb) !important; color: #fff !important; }
  .ch-nav-icon { font-size: 16px; }
  .ch-nav-label { font-size: 13px; font-weight: 600; }

  .ch-history { flex: 1; overflow: hidden; display: flex; flex-direction: column; margin-top: 10px; }
  .ch-history-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); padding: 0 4px; margin-bottom: 6px; }
  .ch-history-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
  .ch-chat-item { display: flex; align-items: center; padding: 7px 10px; border-radius: 8px; cursor: pointer; transition: all 0.15s; color: var(--sidebar-item-text); }
  .ch-chat-item:hover { background: var(--bg-hover); }
  .ch-chat-active { background: var(--accent, #2563eb) !important; color: #fff !important; }
  .ch-chat-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .ch-chat-actions { display: flex; gap: 3px; opacity: 0; transition: opacity 0.15s; }
  .ch-chat-item:hover .ch-chat-actions { opacity: 1; }
  .ch-chat-actions button { background: none; border: none; cursor: pointer; font-size: 11px; color: var(--text-muted); padding: 2px 4px; border-radius: 4px; transition: color 0.15s; }
  .ch-chat-actions button:hover { color: #f87171; }

  .ch-settings-trigger {
    width: 100%; padding: 9px; border-radius: 9px; margin-top: 8px;
    border: 1px solid var(--border); background: var(--bg-hover);
    color: var(--text-secondary); font-size: 13px; cursor: pointer;
    font-family: inherit; transition: all 0.15s;
  }
  .ch-settings-trigger:hover { background: var(--bg-active); color: var(--text-primary); }

  /* ── Main ── */
  .ch-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: var(--bg-base); }
  .ch-tab-wrap { flex: 1; overflow: hidden; }

  /* ── Chat messages ── */
  .ch-messages { flex: 1; overflow-y: auto; padding: 24px 24px 12px; display: flex; justify-content: center; }
  .ch-messages-inner { width: 100%; max-width: 780px; display: flex; flex-direction: column; gap: 20px; }
  .ch-empty { display: flex; flex-direction: column; align-items: center; padding-top: 70px; text-align: center; gap: 10px; }
  .ch-empty-icon { font-size: 46px; }
  .ch-empty-title { font-size: 22px; font-weight: 700; color: var(--text-primary); margin: 0; }
  .ch-empty-sub { color: var(--text-muted); margin: 0; font-size: 14px; }
  .ch-empty-btn { padding: 10px 22px; border-radius: 10px; background: var(--accent); border: none; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit; transition: background 0.2s; }
  .ch-empty-btn:hover { background: var(--accent-hover, #1d4ed8); }

  .ch-msg-row { display: flex; align-items: flex-end; gap: 10px; }
  .ch-msg-user { justify-content: flex-end; }
  .ch-msg-ai   { justify-content: flex-start; }

  /* AI avatar */
  .ch-ai-avatar {
    width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
    background: linear-gradient(135deg, var(--accent), #8b5cf6);
    color: #fff; font-size: 13px; font-weight: 800;
    display: flex; align-items: center; justify-content: center;
    margin-bottom: 2px;
  }

  /* Bubbles */
  .ch-bubble { padding: 13px 17px; border-radius: 18px; max-width: 640px; word-break: break-word; }
  .ch-bubble-user {
    background: var(--accent); color: #fff;
    border-radius: 18px 18px 4px 18px; max-width: 460px;
  }
  .ch-bubble-ai {
    background: var(--bg-card); border: 1px solid var(--border);
    color: var(--text-primary); border-radius: 4px 18px 18px 18px;
  }

  /* Thinking dots */
  .ch-thinking-bubble {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: 4px 18px 18px 18px;
    padding: 14px 20px; display: flex; gap: 5px; align-items: center;
  }
  .ch-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--text-muted); display: inline-block;
    animation: ch-bounce 1.3s ease-in-out infinite;
  }
  .ch-dot:nth-child(2) { animation-delay: 0.18s; }
  .ch-dot:nth-child(3) { animation-delay: 0.36s; }
  @keyframes ch-bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-6px)} }

  /* ── Markdown styles ── */
  .md-h1 { font-size: 20px; font-weight: 800; margin: 14px 0 8px; color: var(--text-primary); padding-bottom: 6px; border-bottom: 1px solid var(--border); }
  .md-h2 { font-size: 17px; font-weight: 700; margin: 12px 0 6px; color: var(--text-primary); }
  .md-h3 { font-size: 15px; font-weight: 700; margin: 10px 0 5px; color: var(--text-primary); }
  .md-p  { margin-bottom: 10px; line-height: 1.78; color: var(--text-secondary); }
  .md-p:last-child { margin-bottom: 0; }
  .ch-bubble-user .md-p { color: rgba(255,255,255,0.92); }
  .ch-bubble-user .md-h1,
  .ch-bubble-user .md-h2,
  .ch-bubble-user .md-h3 { color: #fff; border-color: rgba(255,255,255,0.2); }

  .md-ul { list-style-type: disc;    padding-left: 22px; margin-bottom: 10px; color: var(--text-secondary); display: flex; flex-direction: column; gap: 3px; }
  .md-ol { list-style-type: decimal; padding-left: 22px; margin-bottom: 10px; color: var(--text-secondary); display: flex; flex-direction: column; gap: 3px; }
  .md-li { line-height: 1.65; }
  .ch-bubble-user .md-ul,
  .ch-bubble-user .md-ol,
  .ch-bubble-user .md-li { color: rgba(255,255,255,0.9); }

  .md-blockquote {
    border-left: 3px solid var(--accent); margin: 10px 0;
    padding: 8px 14px; border-radius: 0 8px 8px 0;
    background: var(--accent-soft); color: var(--text-secondary);
    font-style: italic; font-size: 14px;
  }

  .md-strong { font-weight: 700; color: var(--text-primary); }
  .md-em     { font-style: italic; color: var(--text-secondary); }
  .ch-bubble-user .md-strong { color: #fff; }
  .ch-bubble-user .md-em     { color: rgba(255,255,255,0.85); }

  .md-hr { border: none; border-top: 1px solid var(--border); margin: 14px 0; }

  .md-a { color: var(--accent-text); text-decoration: underline; text-underline-offset: 3px; }
  .md-a:hover { opacity: 0.8; }
  .ch-bubble-user .md-a { color: #bfdbfe; }

  .md-code-inline {
    background: rgba(0,0,0,0.25); padding: 2px 7px; border-radius: 5px;
    font-size: 13px; color: var(--accent-text); font-family: 'Fira Code', 'Courier New', monospace;
    border: 1px solid rgba(255,255,255,0.08);
  }
  .ch-bubble-user .md-code-inline { background: rgba(0,0,0,0.3); color: #bfdbfe; border-color: rgba(255,255,255,0.15); }

  .md-code-block { margin: 10px 0; border-radius: 10px; overflow: hidden; border: 1px solid var(--border); }
  .md-code-lang {
    background: rgba(0,0,0,0.35); color: var(--text-muted);
    font-size: 11px; font-weight: 600; padding: 5px 14px;
    letter-spacing: 0.05em; text-transform: uppercase; border-bottom: 1px solid var(--border);
    font-family: 'Fira Code', monospace;
  }
  .md-pre {
    background: rgba(0,0,0,0.45); padding: 14px 16px;
    overflow-x: auto; font-size: 13px; margin: 0; line-height: 1.65;
    font-family: 'Fira Code', 'Courier New', monospace;
  }
  .md-pre code { background: none; border: none; padding: 0; color: #e2e8f0; }

  /* Markdown tables */
  .md-table-wrap { overflow-x: auto; margin: 10px 0; border-radius: 8px; border: 1px solid var(--border); }
  .md-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .md-th { background: var(--bg-hover); padding: 8px 12px; text-align: left; font-weight: 700; color: var(--text-primary); border-bottom: 1px solid var(--border); }
  .md-td { padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.04); color: var(--text-secondary); }
  .md-table tr:last-child .md-td { border-bottom: none; }
  .md-table tr:hover .md-td { background: var(--bg-hover); }

  /* ── Input bar ── */
  .ch-input-bar { padding: 12px 24px 16px; border-top: 1px solid var(--border); background: var(--bg-sidebar); display: flex; justify-content: center; }
  .ch-input-inner { width: 100%; max-width: 760px; display: flex; gap: 10px; }
  .ch-textarea {
    flex: 1; padding: 10px 14px; border-radius: 10px;
    border: 1px solid var(--border); background: var(--bg-input, var(--bg-card));
    color: var(--text-primary); outline: none; resize: none;
    overflow-y: auto; max-height: 140px; font-size: 14px;
    font-family: inherit; transition: border-color 0.2s;
  }
  .ch-textarea:focus { border-color: var(--border-accent); }
  .ch-textarea:disabled { opacity: 0.5; cursor: not-allowed; }
  .ch-textarea::placeholder { color: var(--text-dim, #334155); }
  .ch-send {
    padding: 10px 20px; border-radius: 10px; background: var(--accent);
    border: none; color: #fff; font-size: 13px; font-weight: 700;
    cursor: pointer; font-family: inherit; transition: background 0.2s; white-space: nowrap;
  }
  .ch-send:hover:not(:disabled) { background: var(--accent-hover, #1d4ed8); }
  .ch-send:disabled { opacity: 0.45; cursor: not-allowed; }

  /* ══ SETTINGS MODAL ══ */
  .sm-overlay {
    position: fixed; inset: 0; z-index: 1000;
    background: rgba(0,0,0,0.55); backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center;
    animation: sm-fade 0.18s ease;
    font-family: 'DM Sans', 'Segoe UI', sans-serif;
  }
  @keyframes sm-fade { from{opacity:0} to{opacity:1} }
  .sm-modal {
    width: 480px; max-width: calc(100vw - 32px); max-height: calc(100vh - 64px);
    background: var(--bg-card, #1e293b); border: 1px solid var(--border);
    border-radius: 22px; overflow: hidden; display: flex; flex-direction: column;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    animation: sm-up 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes sm-up { from{transform:scale(0.94) translateY(12px);opacity:0} to{transform:scale(1) translateY(0);opacity:1} }

  .sm-header {
    display: flex; align-items: center; gap: 8px;
    padding: 16px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0;
  }
  .sm-title { flex: 1; font-size: 17px; font-weight: 800; color: var(--text-primary); margin: 0; }
  .sm-back, .sm-close {
    background: none; border: none; cursor: pointer;
    color: var(--text-muted); font-size: 16px; width: 30px; height: 30px;
    border-radius: 8px; display: flex; align-items: center; justify-content: center;
    transition: all 0.15s; font-family: inherit;
  }
  .sm-back:hover, .sm-close:hover { background: var(--bg-hover); color: var(--text-primary); }

  .sm-body { padding: 18px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }

  .sm-user-chip {
    display: flex; align-items: center; gap: 12px;
    padding: 14px; border-radius: 13px; background: var(--bg-hover);
    border: 1px solid var(--border); margin-bottom: 2px;
  }
  .sm-avatar {
    width: 44px; height: 44px; border-radius: 50%;
    background: var(--accent); color: #fff;
    display: flex; align-items: center; justify-content: center;
    font-size: 20px; font-weight: 800; flex-shrink: 0;
  }
  .sm-user-name { font-size: 15px; font-weight: 700; color: var(--text-primary); }
  .sm-user-sub { font-size: 12px; color: var(--text-muted); }

  .sm-section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); padding: 2px 0; }
  .sm-row {
    display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 11px;
    border: 1px solid var(--border); background: var(--bg-hover);
    cursor: pointer; transition: all 0.15s; width: 100%; text-align: left; font-family: inherit;
  }
  .sm-row:hover { border-color: var(--border-accent); background: var(--bg-active); }
  .sm-row-icon { font-size: 18px; }
  .sm-row-info { flex: 1; display: flex; flex-direction: column; }
  .sm-row-label { font-size: 14px; font-weight: 600; color: var(--text-primary); }
  .sm-row-sub { font-size: 12px; color: var(--text-muted); }
  .sm-row-arrow { font-size: 20px; color: var(--text-muted); }

  .sm-divider { height: 1px; background: var(--border); }
  .sm-logout-btn {
    width: 100%; padding: 11px; border-radius: 11px;
    background: var(--danger-soft); border: 1px solid rgba(239,68,68,0.2);
    color: var(--danger-text, #fca5a5); font-size: 14px; font-weight: 700;
    cursor: pointer; font-family: inherit; transition: all 0.15s;
  }
  .sm-logout-btn:hover { background: rgba(239,68,68,0.22); }

  .sm-desc { font-size: 13px; color: var(--text-muted); }
  .sm-theme-list { display: flex; flex-direction: column; gap: 10px; }
  .sm-theme-card {
    border: 2px solid var(--border); border-radius: 13px; overflow: hidden;
    cursor: pointer; transition: border-color 0.2s; background: var(--bg-hover);
    font-family: inherit; width: 100%; padding: 0; text-align: left;
  }
  .sm-theme-card:hover { border-color: var(--border-accent); }
  .sm-theme-active { border-color: var(--accent) !important; background: var(--accent-soft) !important; }
  .sm-theme-preview { border-bottom: 1px solid var(--border); }
  .sm-theme-footer { display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
  .sm-theme-icon { font-size: 18px; flex-shrink: 0; }
  .sm-theme-name { font-size: 14px; font-weight: 700; color: var(--text-primary); }
  .sm-theme-desc { font-size: 11px; color: var(--text-muted); }
  .sm-theme-check { color: var(--accent); font-size: 16px; font-weight: 800; margin-left: auto; }

  .sm-field-group { display: flex; flex-direction: column; gap: 10px; }
  .sm-field { display: flex; flex-direction: column; gap: 5px; }
  .sm-field-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-muted); }
  .sm-input {
    padding: 10px 13px; border-radius: 9px;
    border: 1px solid var(--border); background: var(--bg-input, var(--bg-base));
    color: var(--text-primary); font-size: 14px; outline: none; font-family: inherit;
    transition: border-color 0.2s; width: 100%; box-sizing: border-box;
  }
  .sm-input:focus { border-color: var(--border-accent); }
  .sm-input::placeholder { color: var(--text-dim); }
  .sm-input-disabled { opacity: 0.5; cursor: not-allowed; }
  .sm-save-btn {
    padding: 10px; border-radius: 9px; background: var(--accent);
    border: none; color: #fff; font-size: 14px; font-weight: 700;
    cursor: pointer; font-family: inherit; transition: background 0.2s;
  }
  .sm-save-btn:hover:not(:disabled) { background: var(--accent-hover, #1d4ed8); }
  .sm-save-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .sm-msg { padding: 10px 14px; border-radius: 9px; font-size: 13px; font-weight: 600; }
  .sm-msg-ok  { background: var(--success-soft); color: var(--success-text); border: 1px solid rgba(34,197,94,0.22); }
  .sm-msg-err { background: var(--danger-soft);  color: var(--danger-text);  border: 1px solid rgba(239,68,68,0.22); }
`;