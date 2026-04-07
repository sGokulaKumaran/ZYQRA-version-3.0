import { useState } from "react";
import Login from "./pages/Login";
import Chat from "./pages/Chat";
import Quiz from "./pages/Quiz";
import FloatingTimer from "./pages/FloatingTimer";

type Mode = "chat" | "quiz";

export default function App() {
  const [logged, setLogged] = useState(false);
  const [mode, setMode] = useState<Mode>("chat");

  return (
    <div className="relative h-screen w-full">

      {logged ? (
        <>
          {/* 🔥 PAGE SWITCHING */}
          {mode === "chat" && (
            <Chat
              onLogout={() => {
                setLogged(false);
                setMode("chat"); // reset when logout
              }}
              setMode={setMode}
            />
          )}

          {mode === "quiz" && (
            <Quiz
              setMode={setMode}
            />
          )}

          {/* 🔥 FLOATING TIMER (only after login) */}
          <FloatingTimer />
        </>
      ) : (
        <Login onLogin={() => setLogged(true)} />
      )}

    </div>
  );
}