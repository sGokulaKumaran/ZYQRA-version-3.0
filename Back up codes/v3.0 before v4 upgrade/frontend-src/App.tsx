import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import Chat from "./pages/Chat";
import FloatingTimer from "./pages/FloatingTimer";
import Login from "./pages/Login";
import Quiz from "./pages/Quiz";
import { ThemeProvider } from "./pages/ThemeContext";

type Mode = "chat" | "quiz";

export default function App() {
  const [logged, setLogged] = useState(false);
  const [mode, setMode] = useState<Mode>("chat");

  const handleLogin = (username: string) => {
    localStorage.setItem("username", username);
    setLogged(true);
  };

  const handleLogout = () => {
    setLogged(false);
    setMode("chat");
  };

  return (
    <ThemeProvider>
      <div className="relative h-screen w-full">
        {logged ? (
          <>
            {mode === "chat" && <Chat onLogout={handleLogout} />}
            {mode === "quiz" && (
              <Quiz setMode={setMode as Dispatch<SetStateAction<Mode>>} />
            )}
            <FloatingTimer />
          </>
        ) : (
          <Login onLogin={handleLogin} />
        )}
      </div>
    </ThemeProvider>
  );
}
