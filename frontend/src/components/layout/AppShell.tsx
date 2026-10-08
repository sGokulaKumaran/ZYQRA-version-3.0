import { useEffect, useState } from "react";
import type { ComponentType } from "react";
import { useApp } from "../../context/AppContext";
import type { Route } from "../../context/AppContext";
import ChatPage from "../../features/chat/ChatPage";
import DashboardPage from "../../features/dashboard/DashboardPage";
import FlashcardsPage from "../../features/flashcards/FlashcardsPage";
import NotesPage from "../../features/notes/NotesPage";
import PlannerPage from "../../features/planner/PlannerPage";
import QuizPage from "../../features/quiz/QuizPage";
import SettingsModal from "../settings/SettingsModal";
import FocusTimer from "../timer/FocusTimer";
import { IconButton } from "../ui/Button";
import CommandPalette from "./CommandPalette";
import Logo from "./Logo";
import Sidebar from "./Sidebar";
import "./layout.css";

/** Every page receives `active` so it can refresh when it comes back into view. */
export interface PageProps {
  active: boolean;
}

const PAGES: Record<Route, ComponentType<PageProps>> = {
  dashboard: DashboardPage,
  chat: ChatPage,
  quiz: QuizPage,
  flashcards: FlashcardsPage,
  notes: NotesPage,
  planner: PlannerPage,
};

const RAIL_KEY = "zyqra_sidebar_rail";

export default function AppShell() {
  const { route } = useApp();
  const [rail, setRail] = useState(() => localStorage.getItem(RAIL_KEY) === "1");
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  // Pages stay mounted once opened, so a quiz in progress or a streaming
  // answer survives a trip to another section.
  const [visited, setVisited] = useState<Route[]>([route]);

  useEffect(() => {
    setVisited((list) => (list.includes(route) ? list : [...list, route]));
  }, [route]);

  useEffect(() => localStorage.setItem(RAIL_KEY, rail ? "1" : "0"), [rail]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`shell ${rail ? "rail" : ""} ${drawer ? "drawer-open" : ""}`}>
      <Sidebar
        onToggleRail={() => setRail((value) => !value)}
        onOpenPalette={() => { setPalette(true); setDrawer(false); }}
        onNavigate={() => setDrawer(false)}
      />
      <div className="drawer-scrim" onClick={() => setDrawer(false)} />

      <div className="shell-main">
        <header className="mobile-bar">
          <IconButton icon="menu" label="Open menu" onClick={() => setDrawer(true)} />
          <Logo size={24} />
          <strong>Zyqra</strong>
          <span style={{ flex: 1 }} />
          <IconButton icon="search" label="Search" onClick={() => setPalette(true)} />
        </header>
        <main className="shell-content">
          {visited.map((id) => {
            const Page = PAGES[id];
            return (
              <section key={id} className="shell-page" hidden={id !== route}>
                <Page active={id === route} />
              </section>
            );
          })}
        </main>
      </div>

      <FocusTimer />
      <SettingsModal />
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </div>
  );
}
