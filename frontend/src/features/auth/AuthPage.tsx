import { useState } from "react";
import type { FormEvent } from "react";
import Logo from "../../components/layout/Logo";
import { Button, IconButton } from "../../components/ui/Button";
import Icon from "../../components/ui/Icon";
import type { IconName } from "../../components/ui/Icon";
import { useAuth } from "../../context/AuthContext";
import { errorMessage } from "../../lib/api";
import "./auth.css";

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: "chat", title: "An AI tutor that explains", text: "Step-by-step answers, in the study style you pick." },
  { icon: "quiz", title: "Quizzes from any topic or note", text: "Instant practice with explanations for every answer." },
  { icon: "cards", title: "Flashcards that schedule themselves", text: "Spaced repetition shows each card right before you forget it." },
  { icon: "planner", title: "A plan to your exam date", text: "Turn a goal and a deadline into day-by-day tasks." },
];

export default function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isLogin = mode === "login";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!isLogin && password.length < 6) {
      setError("Choose a password with at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      await (isLogin ? login : register)(username.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode(isLogin ? "register" : "login");
    setError("");
  };

  return (
    <div className="auth">
      <aside className="auth-brand">
        <div className="auth-brand-inner">
          <div className="auth-logo"><Logo size={36} /><strong>Zyqra</strong></div>
          <h1>Study smarter,<br />not longer.</h1>
          <p className="auth-lead">Your AI study companion: learn a topic, test yourself, and remember it.</p>
          <ul className="auth-features">
            {FEATURES.map((feature) => (
              <li key={feature.title}>
                <span className="auth-feature-icon"><Icon name={feature.icon} size={19} /></span>
                <div><b>{feature.title}</b><span>{feature.text}</span></div>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="auth-main">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-card-logo"><Logo size={32} /></div>
          <h2>{isLogin ? "Welcome back" : "Create your account"}</h2>
          <p className="muted">{isLogin ? "Sign in to continue studying." : "It takes a few seconds — no email needed."}</p>

          <label className="field">
            <span className="label">Username</span>
            <div className="input-icon">
              <Icon name="user" size={16} />
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
                minLength={isLogin ? 1 : 3}
                maxLength={32}
                placeholder="your username"
              />
            </div>
          </label>

          <label className="field">
            <span className="label">Password</span>
            <div className="input-icon">
              <Icon name="lock" size={16} />
              <input
                className="input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isLogin ? "current-password" : "new-password"}
                required
                placeholder={isLogin ? "your password" : "at least 6 characters"}
              />
              <IconButton
                className="trailing"
                size="sm"
                icon={showPassword ? "eyeOff" : "eye"}
                label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((v) => !v)}
              />
            </div>
          </label>

          {error && <p className="notice danger" role="alert"><Icon name="alertCircle" size={16} />{error}</p>}

          <Button variant="primary" size="lg" type="submit" block loading={busy} iconRight="arrowRight">
            {isLogin ? "Sign in" : "Create account"}
          </Button>

          <p className="auth-switch">
            {isLogin ? "New to Zyqra?" : "Already have an account?"}
            <button type="button" onClick={switchMode}>{isLogin ? "Create an account" : "Sign in"}</button>
          </p>
        </form>
      </main>
    </div>
  );
}
