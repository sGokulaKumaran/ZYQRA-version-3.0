import AppShell from "./components/layout/AppShell";
import Logo from "./components/layout/Logo";
import { Spinner } from "./components/ui/primitives";
import { AppProvider } from "./context/AppContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { UIProvider } from "./context/UIContext";
import AuthPage from "./features/auth/AuthPage";

function Gate() {
  const { user, restoring } = useAuth();

  if (restoring) {
    return (
      <div className="empty muted" style={{ height: "100%" }}>
        <Logo size={44} />
        <Spinner />
      </div>
    );
  }
  if (!user) return <AuthPage />;

  // Keyed by user so nothing from a previous account's session is reused.
  return (
    <AppProvider key={user.id}>
      <AppShell />
    </AppProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <UIProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </UIProvider>
    </ThemeProvider>
  );
}
