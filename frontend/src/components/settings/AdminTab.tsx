// Settings → Admin: who uses this installation, and who may join it.

import { useCallback, useEffect, useState } from "react";
import { useUser } from "../../context/AuthContext";
import { useUI } from "../../context/UIContext";
import { api } from "../../lib/api";
import { formatDate, formatMinutes, plural, timeAgo } from "../../lib/format";
import type { AdminOverview, AdminUser } from "../../lib/types";
import { Button, IconButton } from "../ui/Button";
import Icon from "../ui/Icon";
import type { IconName } from "../ui/Icon";
import { Switch } from "../ui/primitives";

const STATS: { key: keyof AdminOverview["totals"]; label: string; icon: IconName }[] = [
  { key: "users", label: "Users", icon: "user" },
  { key: "chats", label: "Chats", icon: "chat" },
  { key: "messages", label: "Messages", icon: "send" },
  { key: "quizzes", label: "Quizzes", icon: "quiz" },
  { key: "decks", label: "Decks", icon: "cards" },
  { key: "notes", label: "Notes", icon: "note" },
];

function activity(user: AdminUser): string {
  const parts = [
    user.chats && plural(user.chats, "chat"),
    user.quizzes && plural(user.quizzes, "quiz", "quizzes"),
    user.decks && plural(user.decks, "deck"),
    user.notes && plural(user.notes, "note"),
    user.focus_minutes && `${formatMinutes(user.focus_minutes)} focus`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No activity yet";
}

export default function AdminTab() {
  const me = useUser();
  const { toast, confirm, prompt } = useUI();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api.get<AdminOverview>("/api/admin/overview").then(setData).catch((error) => toast.error(error));
  }, [toast]);

  const run = useCallback(
    async (id: string, request: () => Promise<AdminOverview>, done?: string) => {
      setBusy(id);
      try {
        setData(await request());
        if (done) toast.success(done);
      } catch (error) {
        toast.error(error);
      }
      setBusy(null);
    },
    [toast],
  );

  if (!data) return <p className="hint">Loading…</p>;

  const setRole = async (user: AdminUser) => {
    if (!user.is_admin) {
      const ok = await confirm({
        title: `Make ${user.username} an administrator?`,
        message: "Administrators can connect AI providers, change API keys, and manage every account.",
        confirmLabel: "Make administrator",
      });
      if (!ok) return;
    }
    await run(`role-${user.id}`, () => api.patch<AdminOverview>(`/api/admin/users/${user.id}`, { is_admin: !user.is_admin }));
  };

  const resetPassword = async (user: AdminUser) => {
    const password = await prompt({
      title: `New password for ${user.username}`,
      label: "Password (at least 6 characters)",
      confirmLabel: "Set password",
    });
    if (!password) return;
    if (password.length < 6) {
      toast.error("Use at least 6 characters.");
      return;
    }
    await run(`pass-${user.id}`, () => api.patch<AdminOverview>(`/api/admin/users/${user.id}`, { password }), "Password changed.");
  };

  const remove = async (user: AdminUser) => {
    const ok = await confirm({
      title: `Delete ${user.username}?`,
      message: "The account and all of its chats, quizzes, flashcards, notes and tasks are permanently deleted.",
      confirmLabel: "Delete account",
      danger: true,
    });
    if (ok) await run(`del-${user.id}`, () => api.delete<AdminOverview>(`/api/admin/users/${user.id}`), "Account deleted.");
  };

  const needle = filter.trim().toLowerCase();
  const users = data.users.filter((u) => u.username.toLowerCase().includes(needle));

  return (
    <>
      <div className="set-section">
        <h3>Overview</h3>
        <div className="admin-stats">
          {STATS.map((stat) => (
            <div key={stat.key} className="admin-stat">
              <Icon name={stat.icon} size={16} />
              <b>{data.totals[stat.key].toLocaleString()}</b>
              <span>{stat.label}</span>
            </div>
          ))}
        </div>
        <div className="guard">
          <Icon name="lock" size={18} />
          <div>
            <b>Allow new sign-ups</b>
            <span>When off, nobody can create an account; existing users sign in as usual.</span>
          </div>
          <Switch
            checked={data.registration_open}
            disabled={busy === "signups"}
            label="Allow new sign-ups"
            onChange={(value) => void run("signups", () => api.put<AdminOverview>("/api/admin/settings", { registration_open: value }))}
          />
        </div>
      </div>

      <div className="set-section">
        <div className="set-head">
          <h3>Accounts</h3>
          <span className="hint">{plural(data.totals.users, "account")} · {plural(data.totals.admins, "administrator")}</span>
        </div>
        {data.users.length > 8 && (
          <div className="input-icon">
            <Icon name="search" size={15} />
            <input className="input" placeholder="Find an account" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        )}
        <ul className="chain">
          {users.map((user) => {
            const locked = user.id === me.id || user.builtin;
            return (
              <li key={user.id} className="chain-row">
                <span className="chain-pos">{user.username.slice(0, 1).toUpperCase()}</span>
                <div className="chain-main">
                  <div className="chain-title">
                    <b>{user.username}</b>
                    {user.is_admin && <span className="badge accent"><Icon name="shield" size={12} />Admin</span>}
                    {user.id === me.id && <span className="badge">You</span>}
                    {user.own_models && <span className="badge" title="This user chose their own models.">Own models</span>}
                  </div>
                  <div className="chain-meta">
                    <span>{activity(user)}</span>
                  </div>
                  <div className="chain-meta">
                    <span>
                      Joined {formatDate(user.created_at) || "before v4"}
                      {user.last_active_at && ` · last chat ${timeAgo(user.last_active_at)}`}
                    </span>
                  </div>
                </div>
                {locked ? (
                  <span className="hint">{user.builtin ? "Set in backend/.env" : ""}</span>
                ) : (
                  <div className="chain-actions">
                    <Button size="sm" variant="secondary" loading={busy === `role-${user.id}`} onClick={() => void setRole(user)}>
                      {user.is_admin ? "Remove admin" : "Make admin"}
                    </Button>
                    <IconButton size="sm" icon="key" label="Set a new password" loading={busy === `pass-${user.id}`} onClick={() => void resetPassword(user)} />
                    <IconButton size="sm" icon="trash" label="Delete account" danger loading={busy === `del-${user.id}`} onClick={() => void remove(user)} />
                  </div>
                )}
              </li>
            );
          })}
          {users.length === 0 && <li className="panel-empty">No accounts match.</li>}
        </ul>
        <p className="hint">
          Your own sign-in is set by <code>ADMIN_USERNAME</code> and <code>ADMIN_PASSWORD</code> in <code>backend/.env</code>.
          AI providers, keys and the default model list are under <b>AI models</b>.
        </p>
      </div>
    </>
  );
}
