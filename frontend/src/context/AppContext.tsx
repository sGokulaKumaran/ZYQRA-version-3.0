// Navigation, app metadata and the live AI engine status.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { IconName } from "../components/ui/Icon";
import { api } from "../lib/api";
import type { AIStatus, Meta } from "../lib/types";

export type Route = "dashboard" | "chat" | "quiz" | "flashcards" | "notes" | "planner";

export const ROUTES: { id: Route; label: string; icon: IconName }[] = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "chat", label: "AI Tutor", icon: "chat" },
  { id: "quiz", label: "Quizzes", icon: "quiz" },
  { id: "flashcards", label: "Flashcards", icon: "cards" },
  { id: "notes", label: "Notes", icon: "note" },
  { id: "planner", label: "Planner", icon: "planner" },
];

export type SettingsTab = "profile" | "appearance" | "ai" | "shortcuts";

/** A one-shot instruction handed to the page being navigated to. */
export interface Intent {
  chatId?: number;
  noteId?: number;
  deckId?: number;
  quizId?: number;
  /** Start a quiz / deck from this note. */
  fromNoteId?: number;
  /** Pre-filled chat question. */
  ask?: string;
  /** Pre-filled quiz topic. */
  topic?: string;
}

interface AppContextValue {
  route: Route;
  intent: Intent | null;
  navigate: (route: Route, intent?: Intent) => void;
  /** Read and clear the pending intent (call once from the target page). */
  takeIntent: () => Intent | null;
  meta: Meta | null;
  ai: AIStatus | null;
  refreshAI: (rediscover?: boolean) => Promise<void>;
  /** Which settings tab is open, or null when settings are closed. */
  settingsTab: SettingsTab | null;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

const AI_POLL_MS = 30_000;

function routeFromHash(): Route {
  const name = window.location.hash.replace(/^#\/?/, "");
  return ROUTES.some((r) => r.id === name) ? (name as Route) : "dashboard";
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [ai, setAI] = useState<AIStatus | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((next: Route, nextIntent?: Intent) => {
    setIntent(nextIntent ?? null);
    setRoute(next);
    window.location.hash = `/${next}`;
  }, []);

  const takeIntent = useCallback(() => {
    const current = intent;
    if (current) setIntent(null);
    return current;
  }, [intent]);

  const refreshAI = useCallback(async (rediscover = false) => {
    try {
      setAI(await api.get<AIStatus>(`/api/ai/status${rediscover ? "?refresh=true" : ""}`));
    } catch {
      // status is informational; the next poll will retry
    }
  }, []);

  useEffect(() => {
    api.get<Meta>("/api/meta").then(setMeta).catch(() => {});
    void refreshAI();
    const timer = window.setInterval(() => void refreshAI(), AI_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshAI]);

  const openSettings = useCallback((tab: SettingsTab = "profile") => setSettingsTab(tab), []);
  const closeSettings = useCallback(() => setSettingsTab(null), []);

  const value = useMemo(
    () => ({ route, intent, navigate, takeIntent, meta, ai, refreshAI, settingsTab, openSettings, closeSettings }),
    [route, intent, navigate, takeIntent, meta, ai, refreshAI, settingsTab, openSettings, closeSettings],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside <AppProvider>");
  return value;
}
