import { useAuth, useUser } from "../../context/AuthContext";
import { ROUTES, useApp } from "../../context/AppContext";
import { THEMES, useTheme } from "../../context/ThemeContext";
import { IconButton } from "../ui/Button";
import Icon from "../ui/Icon";
import { Menu, MenuItem } from "../ui/primitives";
import Logo from "./Logo";

interface SidebarProps {
  onToggleRail: () => void;
  onOpenPalette: () => void;
  onNavigate: () => void;
}

/** Summarises the fallback chain as one line for the sidebar chip. */
function useEngineSummary() {
  const { ai } = useApp();
  if (!ai) return { tone: "", title: "AI engine", text: "Connecting…" };
  const usable = ai.chain.filter((m) => m.state === "ready" || m.state === "cooldown");
  if (usable.length === 0) return { tone: "bad", title: "AI engine", text: "Add an API key" };
  const active = ai.chain.find((m) => m.id === ai.active);
  if (!active) return { tone: "bad", title: "All models cooling down", text: "Retrying soon" };
  return active.id === usable[0].id
    ? { tone: "ok", title: "AI engine", text: active.label }
    : { tone: "warn", title: "Fallback active", text: active.label };
}

export default function Sidebar({ onToggleRail, onOpenPalette, onNavigate }: SidebarProps) {
  const { route, navigate, openSettings } = useApp();
  const { logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const user = useUser();
  const engine = useEngineSummary();

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="sidebar-brand">
        <Logo />
        <strong>Zyqra</strong>
        <IconButton icon="panel" label="Collapse sidebar" size="sm" onClick={onToggleRail} />
      </div>
      <IconButton icon="panel" label="Expand sidebar" size="sm" className="rail-expand" onClick={onToggleRail} />

      <button type="button" className="sidebar-search" onClick={onOpenPalette} title="Search (Ctrl+K)">
        <Icon name="search" size={16} />
        <span>Search</span>
        <kbd className="kbd">Ctrl K</kbd>
      </button>

      <div className="sidebar-nav">
        {ROUTES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${route === item.id ? "on" : ""}`}
            aria-current={route === item.id ? "page" : undefined}
            title={item.label}
            onClick={() => { navigate(item.id); onNavigate(); }}
          >
            <Icon name={item.icon} size={19} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="sidebar-spacer" />

      <button type="button" className="ai-chip" onClick={() => openSettings("ai")} title={`${engine.title}: ${engine.text}`}>
        <span className={`status-dot ${engine.tone}`} />
        <span className="ai-chip-text">
          <small>{engine.title}</small>
          <span className="truncate">{engine.text}</span>
        </span>
      </button>

      <Menu
        direction="up"
        trigger={(toggle) => (
          <button type="button" className="user-row" onClick={toggle} title={user.username}>
            <span className="avatar">{user.username[0]?.toUpperCase()}</span>
            <span className="name truncate">{user.username}</span>
            <Icon name="chevronUp" size={15} className="muted" />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuItem icon="settings" label="Settings" onClick={() => { close(); openSettings("profile"); }} />
            <MenuItem icon="cpu" label="AI models" onClick={() => { close(); openSettings("ai"); }} />
            <div className="menu-label">Theme</div>
            {THEMES.map((t) => (
              <MenuItem key={t.id} icon={t.icon} label={t.label} active={theme === t.id} onClick={() => setTheme(t.id)} />
            ))}
            <hr className="divider" style={{ margin: "5px 0" }} />
            <MenuItem icon="logout" label="Log out" danger onClick={() => { close(); logout(); }} />
          </>
        )}
      </Menu>
    </nav>
  );
}
