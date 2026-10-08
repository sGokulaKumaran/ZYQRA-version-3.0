import { useState } from "react";
import type { FormEvent } from "react";
import { useAuth, useUser } from "../../context/AuthContext";
import { useApp } from "../../context/AppContext";
import type { SettingsTab } from "../../context/AppContext";
import { THEMES, useTheme } from "../../context/ThemeContext";
import type { Theme } from "../../context/ThemeContext";
import { useUI } from "../../context/UIContext";
import { api } from "../../lib/api";
import type { User } from "../../lib/types";
import { Button } from "../ui/Button";
import Icon from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import Modal from "../ui/Modal";
import AdminTab from "./AdminTab";
import AIModelsTab from "./AIModelsTab";
import "./settings.css";

const TABS: { id: SettingsTab; label: string; icon: IconName; adminOnly?: boolean }[] = [
  { id: "profile", label: "Profile", icon: "user" },
  { id: "appearance", label: "Appearance", icon: "theme" },
  { id: "ai", label: "AI models", icon: "cpu" },
  { id: "admin", label: "Admin", icon: "shield", adminOnly: true },
  { id: "shortcuts", label: "Shortcuts", icon: "bolt" },
];

// ─── Profile ──────────────────────────────────────────────────
function ProfileTab() {
  const user = useUser();
  const { setUser, logout } = useAuth();
  const { toast } = useUI();
  const [username, setUsername] = useState(user.username);
  const [goal, setGoal] = useState(user.daily_goal_minutes);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState<"profile" | "password" | null>(null);

  const profileChanged = username.trim() !== user.username || goal !== user.daily_goal_minutes;
  const passwordError =
    next && next.length < 6 ? "Use at least 6 characters." : confirm && next !== confirm ? "The passwords don't match." : "";

  const builtin = user.builtin_admin;

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setSaving("profile");
    try {
      setUser(await api.patch<User>("/api/auth/me", { username: username.trim(), daily_goal_minutes: goal }));
      toast.success("Profile updated.");
    } catch (error) {
      toast.error(error);
    }
    setSaving(null);
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    setSaving("password");
    try {
      await api.post("/api/auth/password", { current_password: current, new_password: next });
      setCurrent(""); setNext(""); setConfirm("");
      toast.success("Password changed.");
    } catch (error) {
      toast.error(error);
    }
    setSaving(null);
  };

  return (
    <>
      <form className="set-section" onSubmit={saveProfile}>
        <h3>Profile</h3>
        <label className="field">
          <span className="label">Username</span>
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} minLength={3} maxLength={32} required disabled={builtin} />
        </label>
        <label className="field">
          <span className="label">Daily focus goal</span>
          <select className="select" value={goal} onChange={(e) => setGoal(Number(e.target.value))}>
            {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => (
              <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} ${m === 60 ? "hour" : "hours"}`}</option>
            ))}
          </select>
          <span className="hint">Focus-timer minutes you aim for each day; shown on the dashboard.</span>
        </label>
        <div><Button variant="primary" type="submit" loading={saving === "profile"} disabled={!profileChanged}>Save changes</Button></div>
      </form>

      {user.is_admin && (
        <p className="notice accent">
          <Icon name="shield" size={16} />
          <span>You are an administrator. Manage accounts under <b>Admin</b> and providers under <b>AI models</b>.{builtin && <> This account's username and password are set in <code>backend/.env</code>.</>}</span>
        </p>
      )}

      {!builtin && <form className="set-section" onSubmit={savePassword}>
        <h3>Password</h3>
        <label className="field">
          <span className="label">Current password</span>
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <div className="set-row">
          <label className="field">
            <span className="label">New password</span>
            <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          </label>
          <label className="field">
            <span className="label">Confirm new password</span>
            <input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
        </div>
        {passwordError && <p className="notice danger"><Icon name="alertCircle" size={16} />{passwordError}</p>}
        <div>
          <Button variant="primary" type="submit" loading={saving === "password"} disabled={!current || !next || next !== confirm || next.length < 6}>
            Change password
          </Button>
        </div>
      </form>}

      <div className="set-section">
        <h3>Session</h3>
        <div><Button variant="danger" icon="logout" onClick={logout}>Log out</Button></div>
      </div>
    </>
  );
}

// ─── Appearance ───────────────────────────────────────────────
const PREVIEW: Record<Theme, { bg: string; side: string; card: string; accent: string; ink: string }> = {
  default: { bg: "#0b1220", side: "#080d18", card: "#131c2e", accent: "#3b82f6", ink: "#a9b4c7" },
  dark: { bg: "#050506", side: "#0b0b0d", card: "#111114", accent: "#6366f1", ink: "#b4b4bd" },
  light: { bg: "#f6f5f1", side: "#fdfcfa", card: "#ffffff", accent: "#2563eb", ink: "#7a8494" },
};

function ThemePreview({ id }: { id: Theme }) {
  const c = PREVIEW[id];
  return (
    <svg viewBox="0 0 120 70" aria-hidden="true">
      <rect width="120" height="70" fill={c.bg} />
      <rect width="28" height="70" fill={c.side} />
      <rect x="5" y="7" width="8" height="8" rx="2.5" fill={c.accent} />
      <rect x="5" y="22" width="18" height="3" rx="1.500" fill={c.accent} opacity=".85" />
      <rect x="5" y="30" width="15" height="3" rx="1.500" fill={c.ink} opacity=".4" />
      <rect x="5" y="38" width="17" height="3" rx="1.500" fill={c.ink} opacity=".4" />
      <rect x="35" y="8" width="78" height="34" rx="5" fill={c.card} />
      <rect x="41" y="14" width="34" height="3.500" rx="1.700" fill={c.ink} opacity=".9" />
      <rect x="41" y="22" width="60" height="2.500" rx="1.200" fill={c.ink} opacity=".4" />
      <rect x="41" y="28" width="48" height="2.500" rx="1.200" fill={c.ink} opacity=".4" />
      <rect x="35" y="48" width="56" height="14" rx="5" fill={c.card} />
      <rect x="95" y="48" width="18" height="14" rx="5" fill={c.accent} />
    </svg>
  );
}

function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="set-section">
      <h3>Theme</h3>
      <p className="hint">Applies instantly across the whole app.</p>
      <div className="theme-grid">
        {THEMES.map((t) => (
          <button key={t.id} type="button" className={`theme-card ${theme === t.id ? "on" : ""}`} onClick={() => setTheme(t.id)} aria-pressed={theme === t.id}>
            <ThemePreview id={t.id} />
            <span className="theme-card-foot">
              <Icon name={t.icon} size={17} />
              <span><b>{t.label}</b><small>{t.description}</small></span>
              {theme === t.id && <Icon name="checkCircle" size={18} />}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Shortcuts ────────────────────────────────────────────────
const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ["Ctrl", "K"], action: "Search everything / run a command" },
  { keys: ["Enter"], action: "Send a chat message" },
  { keys: ["Shift", "Enter"], action: "New line in a chat message" },
  { keys: ["Ctrl", "Enter"], action: "Generate a quiz or flashcards from the topic box" },
  { keys: ["Space"], action: "Flip the current flashcard" },
  { keys: ["1", "2", "3", "4"], action: "Rate a flashcard: Again, Hard, Good, Easy" },
  { keys: ["←", "→"], action: "Previous / next flashcard when browsing" },
  { keys: ["Ctrl", "S"], action: "Save the open note now" },
  { keys: ["Esc"], action: "Close a dialog" },
];

function ShortcutsTab() {
  return (
    <div className="set-section">
      <h3>Keyboard shortcuts</h3>
      <ul className="shortcuts">
        {SHORTCUTS.map((s) => (
          <li key={s.action}>
            <span>{s.action}</span>
            <span className="keys">{s.keys.map((k) => <kbd key={k} className="kbd">{k}</kbd>)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────
export default function SettingsModal() {
  const { settingsTab, openSettings, closeSettings, meta } = useApp();
  const user = useUser();
  if (!settingsTab) return null;
  return (
    <Modal title="Settings" size="xwide" onClose={closeSettings} bare>
      <div className="settings">
        <nav className="settings-tabs" aria-label="Settings sections">
          {TABS.filter((tab) => !tab.adminOnly || user.is_admin).map((tab) => (
            <button key={tab.id} type="button" className={`nav-item ${settingsTab === tab.id ? "on" : ""}`} onClick={() => openSettings(tab.id)}>
              <Icon name={tab.icon} size={18} />
              <span>{tab.label}</span>
            </button>
          ))}
          <div className="settings-version">Zyqra {meta ? `v${meta.version}` : ""}</div>
        </nav>
        <div className="settings-body">
          {settingsTab === "profile" && <ProfileTab />}
          {settingsTab === "appearance" && <AppearanceTab />}
          {settingsTab === "ai" && <AIModelsTab />}
          {settingsTab === "admin" && user.is_admin && <AdminTab />}
          {settingsTab === "shortcuts" && <ShortcutsTab />}
        </div>
      </div>
    </Modal>
  );
}
