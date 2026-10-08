import { createContext, useContext, useEffect, useState } from "react";

export type Theme = "default" | "dark" | "light";

interface ThemeContextType {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "default",
  setTheme: () => {},
});

// Safe localStorage helper (avoids crashes in SSR or restricted envs)
const getSavedTheme = (): Theme => {
  try {
    return (localStorage.getItem("zyqra_theme") as Theme) || "default";
  } catch {
    return "default";
  }
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getSavedTheme);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem("zyqra_theme", t);
    } catch {}
    // Apply immediately to <html> so CSS variables update at once
    document.documentElement.setAttribute("data-theme", t);
  };

  // Apply on mount and whenever theme changes
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);