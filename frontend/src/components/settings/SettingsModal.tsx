import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useAuth, useUser } from "../../context/AuthContext";
import { useApp } from "../../context/AppContext";
import type { SettingsTab } from "../../context/AppContext";
import { THEMES, useTheme } from "../../context/ThemeContext";
import type { Theme } from "../../context/ThemeContext";
import { useUI } from "../../context/UIContext";
import { api } from "../../lib/api";
import { formatWait, plural } from "../../lib/format";
import type { AIProvider, ChainModel, User } from "../../lib/types";
import { Button } from "../ui/Button";
import Icon from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import Modal from "../ui/Modal";
import "./settings.css";

const TABS: { id: SettingsTab; label: string; icon: IconName }[] = [
  { id: "profile", label: "Profile", icon: "user" },
  { id: "appearance", label: "Appearance", icon: "theme" },
  { id: "ai", label: "AI models", icon: "cpu" },
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
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} minLength={3} maxLength={32} required />
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

      <form className="set-section" onSubmit={savePassword}>
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
      </form>

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

// ─── AI models ────────────────────────────────────────────────
type TestResult = { ok: boolean; latency_ms?: number; error?: string } | "running";

function StateBadge({ model }: { model: ChainModel }) {
  if (model.state === "ready") return <span className="badge success"><Icon name="dotFilled" size={10} />Ready</span>;
  if (model.state === "cooldown") {
    return (
      <span className="badge warning" title={model.last_error}>
        <Icon name="clock" size={12} />
        {model.reason || "Cooling down"} · back in {formatWait(model.cooldown_seconds)}
      </span>
    );
  }
  if (model.state === "no_key") return <span className="badge"><Icon name="key" size={12} />No API key</span>;
  return <span className="badge">Disabled</span>;
}

function ProviderCard({ provider }: { provider: AIProvider }) {
  return (
    <div className="provider">
      <div className="provider-head">
        <b>{provider.name}</b>
        {provider.configured
          ? <span className="badge success"><Icon name="check" size={12} />{plural(provider.key_count, "key")}</span>
          : <span className="badge">Not set up</span>}
        {provider.signup_url && (
          <a className="provider-link" href={provider.signup_url} target="_blank" rel="noopener noreferrer">
            Get a key <Icon name="external" size={13} />
          </a>
        )}
      </div>
      {provider.free_tier && <p>{provider.free_tier}</p>}
      {!provider.configured && <p>Add <code>{provider.key_env}=your_key</code> to <code>backend/.env</code> to enable it.</p>}
      {provider.available_models && (
        <details>
          <summary>{provider.available_models.length} models offered by this provider right now</summary>
          <div className="provider-models">{provider.available_models.map((m) => <code key={m}>{m}</code>)}</div>
        </details>
      )}
    </div>
  );
}

function AITab() {
  const { ai, refreshAI } = useApp();
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [refreshing, setRefreshing] = useState(false);

  // Cooldowns tick down, so keep the list fresh while this tab is open.
  useEffect(() => {
    void refreshAI();
    const timer = window.setInterval(() => void refreshAI(), 8000);
    return () => window.clearInterval(timer);
  }, [refreshAI]);

  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: "running" }));
    try {
      const result = await api.post<{ ok: boolean; latency_ms?: number; error?: string }>("/api/ai/test", { id });
      setTests((t) => ({ ...t, [id]: result }));
    } catch (error) {
      setTests((t) => ({ ...t, [id]: { ok: false, error: error instanceof Error ? error.message : "Test failed" } }));
    }
    void refreshAI();
  };

  const rediscover = async () => {
    setRefreshing(true);
    await refreshAI(true);
    setRefreshing(false);
  };

  if (!ai) return <p className="hint">Loading the AI engine status…</p>;

  const active = ai.chain.find((m) => m.id === ai.active);
  const configured = ai.providers.filter((p) => p.configured).length;

  return (
    <>
      <div className="set-section">
        <div className="set-head">
          <h3>Fallback chain</h3>
          <Button size="sm" variant="ghost" icon="refresh" loading={refreshing} onClick={rediscover}>Refresh</Button>
        </div>
        <p className="hint">
          Every request tries these models from the top. When one hits its rate limit it cools down and the next takes over;
          as soon as it recovers, Zyqra goes back to it automatically.
        </p>

        {ai.config_error && <p className="notice danger"><Icon name="alertTriangle" size={16} />{ai.config_error}</p>}
        {configured === 0 ? (
          <p className="notice warning">
            <Icon name="key" size={16} />
            <span>No AI provider is set up yet. Add at least one API key to <code>backend/.env</code> (see <code>.env.example</code>) — it is picked up without a restart.</span>
          </p>
        ) : active ? (
          <p className="notice accent"><Icon name="sparkles" size={16} /><span>Answering now: <b>{active.label}</b> ({active.provider_name})</span></p>
        ) : (
          <p className="notice warning"><Icon name="clock" size={16} />Every configured model is cooling down. Requests resume as soon as one recovers.</p>
        )}

        <ol className="chain">
          {ai.chain.map((model) => {
            const result = tests[model.id];
            return (
              <li key={model.id} className={`chain-row ${model.id === ai.active ? "active" : ""} ${model.state === "no_key" || model.state === "disabled" ? "off" : ""}`}>
                <span className="chain-pos">{model.position}</span>
                <div className="chain-main">
                  <div className="chain-title">
                    <b>{model.label}</b>
                    <span className={`tier tier-${model.tier}`}>{model.tier}</span>
                    {model.listed === false && (
                      <span className="badge danger" title="This model id is not in the provider's current model list. Check the id in ai_models.json.">
                        <Icon name="alertTriangle" size={12} />Not listed by provider
                      </span>
                    )}
                  </div>
                  <code>{model.provider_name} · {model.model}</code>
                  <div className="chain-meta">
                    <StateBadge model={model} />
                    {(model.ok > 0 || model.failed > 0) && <span>{model.ok} answered · {model.failed} failed</span>}
                    {result && result !== "running" && (
                      result.ok
                        ? <span className="ok"><Icon name="checkCircle" size={13} />Works · {result.latency_ms} ms</span>
                        : <span className="bad" title={result.error}><Icon name="closeCircle" size={13} />{result.error}</span>
                    )}
                  </div>
                </div>
                {model.state !== "no_key" && model.state !== "disabled" && (
                  <Button size="sm" variant="secondary" loading={result === "running"} onClick={() => test(model.id)}>Test</Button>
                )}
              </li>
            );
          })}
        </ol>
        <p className="hint">
          To add, remove or reorder models, edit <code>backend/{ai.config_file}</code>. Changes apply immediately.
        </p>
      </div>

      <div className="set-section">
        <h3>Providers</h3>
        <p className="hint">Each provider you add a key for gives the chain more free quota to fall back on.</p>
        {ai.providers.map((p) => <ProviderCard key={p.id} provider={p} />)}
      </div>
    </>
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
  if (!settingsTab) return null;
  return (
    <Modal title="Settings" size="xwide" onClose={closeSettings} bare>
      <div className="settings">
        <nav className="settings-tabs" aria-label="Settings sections">
          {TABS.map((tab) => (
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
          {settingsTab === "ai" && <AITab />}
          {settingsTab === "shortcuts" && <ShortcutsTab />}
        </div>
      </div>
    </Modal>
  );
}
