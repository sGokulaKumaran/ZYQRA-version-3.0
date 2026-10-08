import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useAuth } from "../../context/AuthContext";
import { ROUTES, useApp } from "../../context/AppContext";
import type { Intent, Route } from "../../context/AppContext";
import { THEMES, useTheme } from "../../context/ThemeContext";
import { api } from "../../lib/api";
import type { SearchResult } from "../../lib/types";
import Icon from "../ui/Icon";
import type { IconName } from "../ui/Icon";

interface Command {
  key: string;
  icon: IconName;
  title: string;
  subtitle?: string;
  run: () => void;
}

const RESULT_TARGET: Record<SearchResult["type"], { route: Route; icon: IconName; label: string; intent: (id: number) => Intent }> = {
  chat: { route: "chat", icon: "chat", label: "Chat", intent: (id) => ({ chatId: id }) },
  note: { route: "notes", icon: "note", label: "Note", intent: (id) => ({ noteId: id }) },
  deck: { route: "flashcards", icon: "cards", label: "Deck", intent: (id) => ({ deckId: id }) },
  quiz: { route: "quiz", icon: "quiz", label: "Quiz", intent: (id) => ({ quizId: id }) },
  task: { route: "planner", icon: "planner", label: "Task", intent: () => ({}) },
};

export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const { navigate, openSettings } = useApp();
  const { logout } = useAuth();
  const { setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Search the user's content, debounced.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api.get<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`)
        .then((data) => setResults(data.results))
        .catch(() => setResults([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  const commands = useMemo<Command[]>(() => {
    const go = (route: Route, intent?: Intent) => () => { navigate(route, intent); onClose(); };
    const actions: Command[] = [
      ...ROUTES.map((r) => ({ key: `go-${r.id}`, icon: r.icon, title: `Go to ${r.label}`, run: go(r.id) })),
      { key: "settings", icon: "settings", title: "Open settings", run: () => { openSettings("profile"); onClose(); } },
      { key: "ai", icon: "cpu", title: "AI models & fallback status", run: () => { openSettings("ai"); onClose(); } },
      ...THEMES.map((t) => ({ key: `theme-${t.id}`, icon: t.icon, title: `Theme: ${t.label}`, subtitle: t.description, run: () => { setTheme(t.id); onClose(); } })),
      { key: "logout", icon: "logout", title: "Log out", run: () => { logout(); onClose(); } },
    ];
    const q = query.trim().toLowerCase();
    const matching = q ? actions.filter((a) => a.title.toLowerCase().includes(q)) : actions;
    const found: Command[] = results.map((r) => {
      const target = RESULT_TARGET[r.type];
      return {
        key: `${r.type}-${r.id}`,
        icon: target.icon,
        title: r.title,
        subtitle: [target.label, r.snippet].filter(Boolean).join(" · "),
        run: go(target.route, target.intent(r.id)),
      };
    });
    const ask: Command[] = q.length >= 3
      ? [{ key: "ask", icon: "sparkles", title: `Ask the AI tutor: “${query.trim()}”`, run: go("chat", { ask: query.trim() }) }]
      : [];
    return [...found, ...matching, ...ask];
  }, [query, results, navigate, onClose, openSettings, setTheme, logout]);

  useEffect(() => setCursor(0), [query, results]);

  useEffect(() => {
    listRef.current?.querySelector(".palette-item.on")?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((c) => Math.min(c + 1, commands.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      commands[cursor]?.run();
    } else if (event.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Search and commands" onKeyDown={onKeyDown}>
        <div className="palette-input">
          <Icon name="search" size={19} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes, chats, decks… or type a command"
            aria-label="Search"
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {commands.length === 0 && <div className="panel-empty">Nothing matches “{query}”.</div>}
          {commands.map((command, index) => (
            <button
              key={command.key}
              type="button"
              className={`palette-item ${index === cursor ? "on" : ""}`}
              onMouseEnter={() => setCursor(index)}
              onClick={command.run}
            >
              <Icon name={command.icon} size={18} />
              <span className="main">
                <b>{command.title}</b>
                {command.subtitle && <small>{command.subtitle}</small>}
              </span>
              {index === cursor && <Icon name="arrowRight" size={15} />}
            </button>
          ))}
        </div>
        <div className="palette-foot">
          <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> navigate</span>
          <span><kbd className="kbd">Enter</kbd> open</span>
        </div>
      </div>
    </div>
  );
}
