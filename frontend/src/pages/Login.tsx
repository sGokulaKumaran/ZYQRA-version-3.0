import { useEffect, useState } from "react";

interface LoginProps {
  onLogin: (username: string) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => { setUsername(""); setPassword(""); }, []);

  const handleSubmit = async () => {
    if (!username || !password) { setMessage("Please fill all fields"); return; }
    setLoading(true); setMessage("");
    try {
      const res = await fetch(`http://127.0.0.1:8000/${isLogin ? "login" : "signup"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.status === "success") {
        setStatus("success");
        setMessage(isLogin ? "Logged in!" : data.message);
        setUsername(""); setPassword("");
        if (isLogin) onLogin(data.username); // pass username up
        else setMessage("Account created! Please log in.");
      } else {
        setStatus("error");
        setMessage(data.message || "Error");
      }
    } catch { setMessage("Server error ❌"); }
    setLoading(false);
  };

  return (
    <>
      <style>{`
        .lg-root {
          height: 100vh; width: 100%; display: flex;
          background: var(--bg-base); color: var(--text-primary);
          font-family: 'DM Sans', 'Segoe UI', sans-serif;
        }
        .lg-left {
          display: none; width: 50%; flex-direction: column;
          justify-content: center; align-items: center;
          background: linear-gradient(135deg, #2563eb, #7c3aed); padding: 40px;
        }
        @media (min-width: 768px) { .lg-left { display: flex; } }
        .lg-left-title { font-size: 36px; font-weight: 800; color: white; margin-bottom: 14px; }
        .lg-left-sub { font-size: 17px; color: rgba(255,255,255,0.88); text-align: center; line-height: 1.6; }
        .lg-right { width: 100%; display: flex; align-items: center; justify-content: center; }
        .lg-card {
          width: 380px; padding: 36px 32px; border-radius: 20px;
          background: var(--bg-card); border: 1px solid var(--border);
          box-shadow: var(--shadow-card); display: flex; flex-direction: column; gap: 22px;
        }
        .lg-title { font-size: 22px; font-weight: 800; text-align: center; color: var(--text-primary); margin: 0; }
        .lg-inputs { display: flex; flex-direction: column; gap: 12px; }
        .lg-input {
          width: 100%; padding: 12px 14px; border-radius: 10px;
          background: var(--bg-input); border: 1px solid var(--border);
          color: var(--text-primary); outline: none; font-size: 14px;
          font-family: inherit; transition: border-color 0.2s; box-sizing: border-box;
        }
        .lg-input:focus { border-color: var(--border-accent); }
        .lg-input::placeholder { color: var(--text-dim); }
        .lg-btn {
          width: 100%; padding: 13px; border-radius: 10px;
          background: var(--accent); border: none; color: white;
          font-size: 15px; font-weight: 700; cursor: pointer;
          font-family: inherit; transition: background 0.2s;
          display: flex; justify-content: center; align-items: center;
        }
        .lg-btn:hover:not(:disabled) { background: var(--accent-hover); }
        .lg-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .lg-msg { text-align: center; font-size: 13px; margin: 0; }
        .lg-msg-ok  { color: var(--success-text); }
        .lg-msg-err { color: var(--danger-text); }
        .lg-toggle { text-align: center; font-size: 13px; color: var(--text-muted); margin: 0; }
        .lg-toggle-link { color: var(--accent-text); cursor: pointer; margin-left: 6px; }
        .lg-toggle-link:hover { text-decoration: underline; }
      `}</style>
      <div className="lg-root">
        <div className="lg-left">
          <h1 className="lg-left-title">Zyqra 🚀</h1>
          <p className="lg-left-sub">AI-powered smart learning platform<br />Learn. Practice. Improve.</p>
        </div>
        <div className="lg-right">
          <div className="lg-card">
            <h2 className="lg-title">{isLogin ? "Login to Zyqra" : "Create Account"}</h2>
            <div className="lg-inputs">
              <input className="lg-input" type="text" placeholder="Username" value={username}
                onChange={(e) => setUsername(e.target.value)} />
              <input className="lg-input" type="password" placeholder="Password" value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }} />
            </div>
            <button className="lg-btn" onClick={handleSubmit} disabled={loading}>
              {loading ? "Please wait..." : isLogin ? "Login" : "Sign Up"}
            </button>
            {message && (
              <p className={`lg-msg ${status === "success" ? "lg-msg-ok" : "lg-msg-err"}`}>{message}</p>
            )}
            <p className="lg-toggle">
              {isLogin ? "Don't have an account?" : "Already have an account?"}
              <span className="lg-toggle-link" onClick={() => { setIsLogin(!isLogin); setMessage(""); setUsername(""); setPassword(""); }}>
                {isLogin ? "Sign Up" : "Login"}
              </span>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}