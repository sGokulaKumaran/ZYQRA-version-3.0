import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api, SESSION_EXPIRED, tokenStore } from "../lib/api";
import type { AuthSession, User } from "../lib/types";

interface AuthContextValue {
  user: User | null;
  /** True while a saved session is being verified on startup. */
  restoring: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => void;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(() => tokenStore.get() !== null);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  useEffect(() => {
    if (tokenStore.get() === null) return;
    api.get<User>("/api/auth/me")
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setRestoring(false));
  }, []);

  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED, logout);
    return () => window.removeEventListener(SESSION_EXPIRED, logout);
  }, [logout]);

  const open = useCallback((session: AuthSession) => {
    tokenStore.set(session.token);
    setUser(session.user);
  }, []);

  const login = useCallback(
    async (username: string, password: string) =>
      open(await api.post<AuthSession>("/api/auth/login", { username, password })),
    [open],
  );

  const register = useCallback(
    async (username: string, password: string) =>
      open(await api.post<AuthSession>("/api/auth/register", { username, password })),
    [open],
  );

  return (
    <AuthContext.Provider value={{ user, restoring, login, register, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

/** The signed-in user. Only call from screens rendered after sign-in. */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error("useUser called while signed out");
  return user;
}
