import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { IconName } from "../components/ui/Icon";

export type Theme = "default" | "dark" | "light";

export const THEMES: { id: Theme; label: string; description: string; icon: IconName }[] = [
  { id: "default", label: "Midnight", description: "Deep navy, easy on the eyes", icon: "moonStars" },
  { id: "dark", label: "Obsidian", description: "True black, maximum contrast", icon: "moon" },
  { id: "light", label: "Paper", description: "Warm light for daytime study", icon: "sun" },
];

const STORAGE_KEY = "zyqra_theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: "default", setTheme: () => {} });

function savedTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  return THEMES.some((t) => t.id === saved) ? (saved as Theme) : "default";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(savedTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
