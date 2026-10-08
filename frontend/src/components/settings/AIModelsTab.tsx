// Settings → AI models: pick providers, then pick which of their models Zyqra may use.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useApp } from "../../context/AppContext";
import { useUI } from "../../context/UIContext";
import { api } from "../../lib/api";
import { formatTokens, formatWait, plural } from "../../lib/format";
import type {
  AIProvider, AIStatus, ChainModel, FreeRule, OfferedModel, ProviderField, ProviderModels, ProviderPreset,
} from "../../lib/types";
import { Button, IconButton } from "../ui/Button";
import Icon from "../ui/Icon";
import { FreeBadge, Segmented, Spinner, Switch } from "../ui/primitives";

type View = { kind: "models" } | { kind: "providers" } | { kind: "provider"; id: string } | { kind: "add" };
type TestResult = { ok: boolean; latency_ms?: number; error?: string } | "running";

const MAX_ROWS = 150;

/** Runs a settings change that answers with the new engine status. */
function useChange() {
  const { applyAI } = useApp();
  const { toast } = useUI();
  return useCallback(
    async (request: () => Promise<AIStatus>): Promise<boolean> => {
      try {
        applyAI(await request());
        return true;
      } catch (error) {
        toast.error(error);
        return false;
      }
    },
    [applyAI, toast],
  );
}

const FREE_RULE_LABEL: Record<FreeRule, string> = {
  all: "All models free",
  some: "Some models free",
  auto: "Free and paid models",
  none: "Paid",
};

function PricingBadge({ rule, local }: { rule: FreeRule; local: boolean }) {
  if (local) return <span className="badge success">Runs on this computer</span>;
  return <span className={`badge ${rule === "none" ? "warning" : rule === "auto" ? "" : "success"}`}>{FREE_RULE_LABEL[rule]}</span>;
}

function ProviderStatus({ provider }: { provider: AIProvider }) {
  if (!provider.configured) return <span className="badge"><Icon name="key" size={12} />Needs a key</span>;
  if (provider.error) return <span className="badge danger"><Icon name="alertTriangle" size={12} />Not connected</span>;
  return <span className="badge success"><Icon name="check" size={12} />Connected</span>;
}

// ─── My models ────────────────────────────────────────────────
function StateBadge({ model }: { model: ChainModel }) {
  if (model.state === "ready") return <span className="badge success"><Icon name="dotFilled" size={10} />Ready</span>;
  if (model.state === "cooldown") {
    return (
      <span className="badge warning" title={model.last_error}>
        <Icon name="clock" size={12} />
        {model.reason || "Cooling down"} · back in {formatWait(model.cooldown_seconds)}
      </span>
    );
  }
  if (model.state === "blocked") return <span className="badge warning"><Icon name="lock" size={12} />Off while free-only is on</span>;
  if (model.state === "no_key") return <span className="badge"><Icon name="key" size={12} />Provider needs a key</span>;
  return <span className="badge">Switched off</span>;
}

function MyModels({ ai, onBrowse }: { ai: AIStatus; onBrowse: () => void }) {
  const { refreshAI } = useApp();
  const change = useChange();
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const manage = ai.can_manage;

  const act = async (id: string, request: () => Promise<AIStatus>) => {
    setBusy(id);
    await change(request);
    setBusy(null);
  };

  const test = async (id: string) => {
    setTests((t) => ({ ...t, [id]: "running" }));
    try {
      const result = await api.post<{ ok: boolean; latency_ms?: number; error?: string }>("/api/ai/test", { id });
      setTests((t) => ({ ...t, [id]: result }));
    } catch (error) {
      setTests((t) => ({ ...t, [id]: { ok: false, error: error instanceof Error ? error.message : "Test failed" } }));
    }
    void refreshAI();
  };

  const move = (index: number, delta: number) => {
    const ids = ai.chain.map((m) => m.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    return act(ai.chain[index].id, () => api.put<AIStatus>("/api/ai/models/order", { ids }));
  };

  const active = ai.chain.find((m) => m.id === ai.active);
  const configured = ai.providers.some((p) => p.configured);

  return (
    <div className="set-section">
      {ai.config_error && <p className="notice danger"><Icon name="alertTriangle" size={16} />{ai.config_error}</p>}
      {!configured ? (
        <p className="notice warning">
          <Icon name="key" size={16} />
          <span>No provider is connected yet. {manage ? "Open Providers and add an API key to get started." : "The administrator has to connect one first."}</span>
        </p>
      ) : active ? (
        <p className="notice accent"><Icon name="sparkles" size={16} /><span>Answering now: <b>{active.label}</b> ({active.provider_name})</span></p>
      ) : ai.chain.length > 0 ? (
        <p className="notice warning"><Icon name="clock" size={16} />No selected model can answer right now. Requests resume as soon as one recovers.</p>
      ) : null}

      <div className="guard">
        <Icon name="shield" size={18} />
        <div>
          <b>Free models only</b>
          <span>
            {manage
              ? "Never send a request to a model that is billed, even as a fallback. Applies to everyone."
              : ai.free_only ? "Set by the administrator: models that are billed are never used." : "Set by the administrator: paid models are allowed."}
          </span>
        </div>
        <Switch
          checked={ai.free_only}
          disabled={!manage || busy === "free-only"}
          label="Free models only"
          onChange={(value) => void act("free-only", () => api.put<AIStatus>("/api/ai/settings", { free_only: value }))}
        />
      </div>

      <p className="notice">
        <Icon name={manage ? "layers" : "user"} size={16} />
        <span style={{ flex: 1 }}>
          {manage
            ? "This is the default list. Everyone who hasn't chosen their own models uses it."
            : ai.personal
              ? "This is your own list. It only affects you."
              : "You are using the default list. Change anything and it becomes your own list; nobody else is affected."}
        </span>
        {ai.personal && (
          <Button size="sm" variant="secondary" loading={busy === "reset"} onClick={() => void act("reset", () => api.post<AIStatus>("/api/ai/models/reset"))}>
            Use the default
          </Button>
        )}
      </p>

      {ai.chain.length === 0 ? (
        <div className="empty">
          <div className="empty-icon"><Icon name="cpu" size={26} /></div>
          <h3>No models selected</h3>
          <p>Choose the models you want from the connected providers. Only those appear in the chat.</p>
          <Button variant="primary" icon="plus" onClick={onBrowse}>Choose models</Button>
        </div>
      ) : (
        <>
          <p className="hint">
            These are the models offered in the chat. On <b>Auto</b>, Zyqra tries them from the top: when one hits its limit
            the next takes over, and it returns to the higher one as soon as that recovers.
          </p>
          <ol className="chain">
            {ai.chain.map((model, index) => {
              const result = tests[model.id];
              const off = model.state === "no_key" || model.state === "disabled" || model.state === "blocked";
              return (
                <li key={model.id} className={`chain-row ${model.id === ai.active ? "active" : ""} ${off ? "off" : ""}`}>
                  <span className="chain-pos">{model.position}</span>
                  <div className="chain-main">
                    <div className="chain-title">
                      <b>{model.label}</b>
                      <FreeBadge free={model.free} />
                      {model.listed === false && (
                        <span className="badge danger" title="The provider's current model list does not include this ID.">
                          <Icon name="alertTriangle" size={12} />Not offered by provider
                        </span>
                      )}
                    </div>
                    <code>
                      {model.provider_name} · {model.model}
                      {model.context ? ` · ${formatTokens(model.context)} context` : ""}
                    </code>
                    <div className="chain-meta">
                      <StateBadge model={model} />
                      {(model.ok > 0 || model.failed > 0) && <span>{model.ok} answered · {model.failed} failed</span>}
                      {result && result !== "running" && (
                        result.ok
                          ? <span className="ok"><Icon name="checkCircle" size={13} />Works · {result.latency_ms} ms</span>
                          : <span className="bad" title={result.error}><Icon name="closeCircle" size={13} />{result.error}</span>
                      )}
                    </div>
                  </div>
                  <div className="chain-actions">
                    {model.state !== "no_key" && (
                      <Button size="sm" variant="secondary" loading={result === "running"} onClick={() => void test(model.id)}>Test</Button>
                    )}
                    <IconButton size="sm" icon="chevronUp" label="Try earlier" disabled={index === 0 || busy !== null} onClick={() => void move(index, -1)} />
                    <IconButton size="sm" icon="chevronDown" label="Try later" disabled={index === ai.chain.length - 1 || busy !== null} onClick={() => void move(index, 1)} />
                    <IconButton
                      size="sm"
                      icon={model.state === "disabled" ? "eyeOff" : "eye"}
                      label={model.state === "disabled" ? "Switch on" : "Switch off without removing"}
                      disabled={busy !== null}
                      onClick={() => void act(model.id, () => api.patch<AIStatus>("/api/ai/models", { id: model.id, enabled: model.state === "disabled" }))}
                    />
                    <IconButton
                      size="sm" icon="trash" label="Remove from my models" danger
                      loading={busy === model.id}
                      disabled={busy !== null}
                      onClick={() => void act(model.id, () => api.post<AIStatus>("/api/ai/models/remove", { id: model.id }))}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
          <div><Button variant="soft" icon="plus" onClick={onBrowse}>Add models</Button></div>
        </>
      )}
    </div>
  );
}

// ─── Providers ────────────────────────────────────────────────
function ProviderList({ ai, onOpen, onAdd }: { ai: AIStatus; onOpen: (id: string) => void; onAdd: () => void }) {
  const manage = ai.can_manage;
  // Other users only see providers they can actually use.
  const providers = manage ? ai.providers : ai.providers.filter((p) => p.configured);
  return (
    <div className="set-section">
      <p className="hint">
        {manage
          ? "Connect a provider, then open it to choose which of its models go in the default list."
          : "Open a provider to choose which of its models you want in your chat."}
      </p>
      <div className="provider-list">
        {providers.map((p) => (
          <button key={p.id} type="button" className="provider-row" onClick={() => onOpen(p.id)}>
            <span className="provider-icon"><Icon name={p.local ? "cpu" : "server"} size={18} /></span>
            <span className="provider-row-main">
              <span className="provider-row-title">
                <b>{p.name}</b>
                <ProviderStatus provider={p} />
                <PricingBadge rule={p.free} local={p.local} />
              </span>
              <small>
                {p.added_count === 0 ? "No models selected" : `${plural(p.added_count, "model")} selected`}
                {p.model_count !== null && ` · ${p.model_count} available`}
              </small>
            </span>
            <Icon name="chevronRight" size={16} />
          </button>
        ))}
        {providers.length === 0 && (
          <p className="panel-empty">{manage ? "No providers yet." : "No provider is connected yet. The administrator has to add one first."}</p>
        )}
      </div>
      {manage && <div><Button variant="primary" icon="plus" onClick={onAdd}>Add provider</Button></div>}
    </div>
  );
}

function BackHeader({ title, onBack, children }: { title: string; onBack: () => void; children?: ReactNode }) {
  return (
    <div className="sub-head">
      <IconButton icon="arrowLeft" label="Back to providers" onClick={onBack} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function KeyHelp({ signupUrl, local }: { signupUrl: string; local: boolean }) {
  if (!signupUrl) return null;
  return (
    <a className="provider-link" href={signupUrl} target="_blank" rel="noopener noreferrer">
      {local ? "Download" : "Get a key"} <Icon name="external" size={13} />
    </a>
  );
}

function ExtraFields({ fields, values, onChange }: {
  fields: ProviderField[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}) {
  return (
    <>
      {fields.map((f) => (
        <label key={f.env} className="field">
          <span className="label">{f.label}</span>
          <input
            className="input"
            value={values[f.env] ?? ""}
            placeholder={f.set ? "Saved — type to replace" : ""}
            autoComplete="off"
            onChange={(e) => onChange({ ...values, [f.env]: e.target.value })}
          />
        </label>
      ))}
    </>
  );
}

const PRICING_OPTIONS: { value: FreeRule; label: string }[] = [
  { value: "auto", label: "Detect per model (when the provider reports prices)" },
  { value: "all", label: "Every model is free" },
  { value: "none", label: "Every model is paid" },
];

function ProviderDetail({ provider, onBack }: { provider: AIProvider; onBack: () => void }) {
  const { ai } = useApp();
  const { toast, confirm } = useUI();
  const change = useChange();

  const [key, setKey] = useState("");
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [name, setName] = useState(provider.name);
  const [url, setUrl] = useState(provider.base_url);
  const [free, setFree] = useState<FreeRule>(provider.free);
  const [saving, setSaving] = useState(false);

  const [offered, setOffered] = useState<ProviderModels | null>(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0); // bumped when the connection changes
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"all" | "free" | "selected">(provider.free === "auto" || provider.free === "some" ? "free" : "all");
  const [pending, setPending] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  const base = `/api/ai/providers/${provider.id}`;

  // The server normalises what was typed (for example a pasted full endpoint URL).
  useEffect(() => {
    setName(provider.name);
    setUrl(provider.base_url);
    setFree(provider.free);
  }, [provider.name, provider.base_url, provider.free]);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      setOffered(await api.get<ProviderModels>(`${base}/models${refresh ? "?refresh=true" : ""}`));
    } catch (error) {
      toast.error(error);
    }
    setLoading(false);
  }, [base, toast]);

  useEffect(() => {
    if (provider.configured) void load();
    else setOffered(null);
  }, [provider.configured, version, load]);

  const patch = useMemo(() => {
    const body: Record<string, unknown> = {};
    if (key.trim()) body.api_key = key.trim();
    const filled = Object.fromEntries(Object.entries(extras).filter(([, value]) => value.trim()));
    if (Object.keys(filled).length) body.extras = filled;
    if (provider.custom) {
      if (name.trim() !== provider.name) body.name = name.trim();
      if (url.trim() !== provider.base_url) body.base_url = url.trim();
      if (free !== provider.free) body.free = free;
    }
    return body;
  }, [key, extras, name, url, free, provider]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    if (await change(() => api.patch<AIStatus>(base, patch))) {
      setKey("");
      setExtras({});
      setVersion((v) => v + 1);
      toast.success("Saved.");
    }
    setSaving(false);
  };

  const removeKey = async () => {
    const ok = await confirm({
      title: `Remove the ${provider.name} key?`,
      message: "The key is deleted from backend/.env and this provider's models stop working until you add one again.",
      confirmLabel: "Remove key",
      danger: true,
    });
    if (ok && (await change(() => api.patch<AIStatus>(base, { api_key: "" })))) setVersion((v) => v + 1);
  };

  const removeProvider = async () => {
    const ok = await confirm({
      title: `Remove ${provider.name}?`,
      message: `${provider.added_count ? `Its ${plural(provider.added_count, "selected model")} will leave your list. ` : ""}You can add the provider again at any time.`,
      confirmLabel: "Remove provider",
      danger: true,
    });
    if (ok && (await change(() => api.delete<AIStatus>(base)))) onBack();
  };

  const setAdded = (id: string, added: boolean) =>
    setOffered((o) => o && { ...o, models: o.models.map((m) => (m.id === id ? { ...m, added } : m)) });

  const toggle = async (model: OfferedModel) => {
    setPending(model.id);
    const ok = await change(() =>
      model.added
        ? api.post<AIStatus>("/api/ai/models/remove", { id: `${provider.id}:${model.id}` })
        : api.post<AIStatus>("/api/ai/models", { provider: provider.id, model: model.id }),
    );
    if (ok) {
      setAdded(model.id, !model.added);
      if (!model.added && model.free === false && ai?.free_only) {
        toast.info("Added. It is a paid model, so it stays off while free-only mode is on.");
      }
    }
    setPending(null);
  };

  const addManual = async (event: FormEvent) => {
    event.preventDefault();
    const id = manual.trim();
    if (!id) return;
    setPending(id);
    if (await change(() => api.post<AIStatus>("/api/ai/models", { provider: provider.id, model: id }))) {
      setManual("");
      setAdded(id, true);
    }
    setPending(null);
  };

  // The provider's list, plus selected models it doesn't list (added by ID).
  const rows = useMemo(() => {
    const listed = offered?.models ?? [];
    const known = new Set(listed.map((m) => m.id));
    const extra = (ai?.chain ?? [])
      .filter((m) => m.provider === provider.id && !known.has(m.model))
      .map((m): OfferedModel => ({ id: m.model, name: m.label, context: m.context, free: m.free, added: true }));
    return [...extra, ...listed];
  }, [offered, ai, provider.id]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      (m) =>
        (show === "all" || (show === "free" ? m.free === true : m.added)) &&
        (!needle || m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle)),
    );
  }, [rows, query, show]);

  const freeCount = rows.filter((m) => m.free === true).length;
  const selectedCount = rows.filter((m) => m.added).length;
  const needsSetup = !provider.configured;
  const manage = ai?.can_manage ?? false;

  return (
    <>
      <div className="set-section">
        <BackHeader title={provider.name} onBack={onBack}>
          <ProviderStatus provider={provider} />
          <PricingBadge rule={provider.free} local={provider.local} />
          {manage && <KeyHelp signupUrl={provider.signup_url} local={provider.local} />}
        </BackHeader>
        {provider.free_tier && <p className="hint">{provider.free_tier}</p>}

        {manage && <form className="connect" onSubmit={save}>
          {provider.custom && (
            <div className="set-row">
              <label className="field">
                <span className="label">Name</span>
                <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="field">
                <span className="label">API URL</span>
                <input className="input" value={url} spellCheck={false} onChange={(e) => setUrl(e.target.value)} />
              </label>
            </div>
          )}
          <label className="field">
            <span className="label">API key{provider.requires_key ? "" : " (optional)"}</span>
            <input
              className="input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              placeholder={provider.key_count ? `Saved${provider.key_hint ? ` · ends in ${provider.key_hint}` : ""} — paste a new key to replace it` : "Paste your API key"}
              onChange={(e) => setKey(e.target.value)}
            />
            <span className="hint">
              Kept in <code>backend/.env</code> on this computer and never shown again. For more quota, paste several keys separated by commas.
            </span>
          </label>
          <ExtraFields fields={provider.fields} values={extras} onChange={setExtras} />
          {provider.custom && (
            <label className="field">
              <span className="label">Pricing</span>
              <select className="select" value={free} onChange={(e) => setFree(e.target.value as FreeRule)}>
                {PRICING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
          <div className="connect-actions">
            <Button variant="primary" type="submit" loading={saving} disabled={Object.keys(patch).length === 0}>Save</Button>
            {provider.key_count > 0 && <Button variant="ghost" icon="key" onClick={() => void removeKey()}>Remove key</Button>}
            <span className="spacer" />
            <Button variant="ghost" icon="trash" onClick={() => void removeProvider()}>Remove provider</Button>
          </div>
        </form>}
      </div>

      <div className="set-section">
        <div className="set-head">
          <h3>Models</h3>
          {provider.configured && manage && (
            <Button size="sm" variant="ghost" icon="refresh" loading={loading} onClick={() => void load(true)}>Refresh list</Button>
          )}
        </div>

        {needsSetup ? (
          <p className="notice"><Icon name="key" size={16} />Save an API key above to see the models {provider.name} offers.</p>
        ) : (
          <>
            {offered?.error && <p className="notice warning"><Icon name="alertTriangle" size={16} />{offered.error}</p>}
            <div className="model-tools">
              <div className="input-icon">
                <Icon name="search" size={15} />
                <input className="input" placeholder="Search models" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <Segmented
                label="Which models to show"
                value={show}
                onChange={setShow}
                options={[
                  { value: "all", label: `All ${rows.length}` },
                  { value: "free", label: `Free ${freeCount}` },
                  { value: "selected", label: `Selected ${selectedCount}` },
                ]}
              />
            </div>

            {loading && !offered ? (
              <div className="panel-empty"><Spinner /></div>
            ) : (
              <ul className="model-list">
                {visible.slice(0, MAX_ROWS).map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      className={`model-row ${m.added ? "on" : ""}`}
                      aria-pressed={m.added}
                      disabled={pending !== null}
                      onClick={() => void toggle(m)}
                    >
                      <span className="model-check">
                        {pending === m.id ? <Spinner size={13} /> : m.added && <Icon name="check" size={13} />}
                      </span>
                      <span className="model-row-main">
                        <b>{m.name || m.id}</b>
                        <code>{m.id}{m.context ? ` · ${formatTokens(m.context)} context` : ""}</code>
                      </span>
                      <FreeBadge free={m.free} />
                    </button>
                  </li>
                ))}
                {visible.length === 0 && (
                  <li className="panel-empty">
                    {rows.length > 0 ? "No models match." : manage ? "No model list yet. Add a model by its ID below." : "This provider has no model list yet."}
                  </li>
                )}
                {visible.length > MAX_ROWS && <li className="panel-empty">Showing the first {MAX_ROWS}. Search to narrow the list.</li>}
              </ul>
            )}

            {manage && <form className="model-manual" onSubmit={addManual}>
              <input
                className="input"
                value={manual}
                spellCheck={false}
                placeholder="Not in the list? Add a model by its exact ID"
                onChange={(e) => setManual(e.target.value)}
              />
              <Button type="submit" variant="secondary" icon="plus" disabled={!manual.trim() || pending !== null}>Add</Button>
            </form>}
          </>
        )}
      </div>
    </>
  );
}

// ─── Add provider ─────────────────────────────────────────────
const LOOKS_LIKE_URL = /^(https?:\/\/|localhost\b|\d{1,3}(\.\d{1,3}){3}|[\w-]+(\.[\w-]+)+(:\d+)?(\/|$))/i;

function hostOf(url: string): string {
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const LOCAL_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** "api.together.xyz" → "Together" */
function nameFromHost(host: string): string {
  if (LOCAL_HOST.test(host) || /^[\d.]+$/.test(host)) return "Local server";
  const parts = host.split(".").filter((part) => !["api", "www", "openai", "inference", "router"].includes(part));
  const word = parts.length > 1 ? parts[parts.length - 2] : parts[0] ?? "";
  return word ? word[0].toUpperCase() + word.slice(1) : "";
}

const GROUPS: { title: string; match: (p: ProviderPreset) => boolean }[] = [
  { title: "Free tier", match: (p) => !p.local && p.free !== "none" },
  { title: "On this computer", match: (p) => p.local },
  { title: "Paid", match: (p) => !p.local && p.free === "none" },
];

function AddProvider({ onBack, onAdded }: { onBack: () => void; onAdded: (id: string) => void }) {
  const { applyAI } = useApp();
  const { toast } = useUI();
  const [presets, setPresets] = useState<ProviderPreset[] | null>(null);
  const [query, setQuery] = useState("");
  const [choice, setChoice] = useState<ProviderPreset | "custom" | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [free, setFree] = useState<FreeRule>("auto");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<ProviderPreset[]>("/api/ai/presets").then(setPresets).catch((error) => toast.error(error));
  }, [toast]);

  const typedUrl = LOOKS_LIKE_URL.test(query.trim());
  const host = typedUrl ? hostOf(query.trim()) : "";
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (presets ?? []).filter((p) =>
      typedUrl ? hostOf(p.base_url) === host : !needle || p.name.toLowerCase().includes(needle) || p.id.includes(needle),
    );
  }, [presets, query, typedUrl, host]);

  const startCustom = () => {
    setChoice("custom");
    setUrl(typedUrl ? query.trim() : "");
    setName(typedUrl ? nameFromHost(host) : query.trim());
    setFree(LOCAL_HOST.test(host) ? "all" : "auto");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!choice) return;
    setSaving(true);
    try {
      const body = choice === "custom"
        ? { name, base_url: url, api_key: key, free }
        : { preset: choice.id, api_key: key, extras };
      const result = await api.post<{ id: string; status: AIStatus }>("/api/ai/providers", body);
      applyAI(result.status);
      onAdded(result.id);
    } catch (error) {
      toast.error(error);
    }
    setSaving(false);
  };

  if (choice) {
    const preset = choice === "custom" ? null : choice;
    const keyOptional = preset ? !preset.requires_key : LOCAL_HOST.test(hostOf(url.trim()));
    return (
      <form className="set-section" onSubmit={submit}>
        <BackHeader title={preset ? `Connect ${preset.name}` : "Connect a custom provider"} onBack={() => setChoice(null)}>
          {preset && <PricingBadge rule={preset.free} local={preset.local} />}
          {preset && <KeyHelp signupUrl={preset.signup_url} local={preset.local} />}
        </BackHeader>
        {preset?.free_tier && <p className="hint">{preset.free_tier}</p>}
        {!preset && (
          <>
            <p className="hint">Works with any service that offers an OpenAI-compatible API (a URL that ends in <code>/v1</code> for most).</p>
            <div className="set-row">
              <label className="field">
                <span className="label">Name</span>
                <input className="input" value={name} maxLength={40} required autoFocus={!name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="field">
                <span className="label">API URL</span>
                <input className="input" value={url} required spellCheck={false} placeholder="https://api.example.com/v1" onChange={(e) => setUrl(e.target.value)} />
              </label>
            </div>
          </>
        )}
        <label className="field">
          <span className="label">API key{keyOptional ? " (optional)" : ""}</span>
          <input
            className="input" type="password" autoComplete="off" spellCheck={false}
            value={key} required={!keyOptional} autoFocus={Boolean(preset) || Boolean(name)}
            placeholder={keyOptional ? "Leave empty if it doesn't need one" : "Paste your API key"}
            onChange={(e) => setKey(e.target.value)}
          />
          <span className="hint">Kept in <code>backend/.env</code> on this computer and never shown again.</span>
        </label>
        {preset && <ExtraFields fields={preset.fields} values={extras} onChange={setExtras} />}
        {!preset && (
          <label className="field">
            <span className="label">Pricing</span>
            <select className="select" value={free} onChange={(e) => setFree(e.target.value as FreeRule)}>
              {PRICING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        )}
        <div><Button variant="primary" type="submit" loading={saving}>Connect and choose models</Button></div>
      </form>
    );
  }

  return (
    <div className="set-section">
      <BackHeader title="Add a provider" onBack={onBack} />
      <div className="input-icon">
        <Icon name="search" size={15} />
        <input
          className="input"
          autoFocus
          value={query}
          spellCheck={false}
          placeholder="Type a provider name, or paste its API URL"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {!presets ? (
        <div className="panel-empty"><Spinner /></div>
      ) : (
        <>
          {GROUPS.map((group) => {
            const items = matches.filter(group.match);
            if (items.length === 0) return null;
            return (
              <div key={group.title} className="provider-list">
                <div className="menu-label">{group.title}</div>
                {items.map((p) => (
                  <button key={p.id} type="button" className="provider-row" disabled={p.added} onClick={() => setChoice(p)}>
                    <span className="provider-icon"><Icon name={p.local ? "cpu" : "server"} size={18} /></span>
                    <span className="provider-row-main">
                      <span className="provider-row-title">
                        <b>{p.name}</b>
                        {p.added ? <span className="badge"><Icon name="check" size={12} />Added</span> : <PricingBadge rule={p.free} local={p.local} />}
                      </span>
                      <small>{p.free_tier}</small>
                    </span>
                    {!p.added && <Icon name="chevronRight" size={16} />}
                  </button>
                ))}
              </div>
            );
          })}
          <div className="provider-list">
            <div className="menu-label">{matches.length ? "Something else" : "Not in the list"}</div>
            <button type="button" className="provider-row" onClick={startCustom}>
              <span className="provider-icon"><Icon name="plus" size={18} /></span>
              <span className="provider-row-main">
                <span className="provider-row-title"><b>{typedUrl ? `Use ${host || "this URL"}` : "Custom provider"}</b></span>
                <small>Any OpenAI-compatible API: enter its URL and key.</small>
              </span>
              <Icon name="chevronRight" size={16} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab ──────────────────────────────────────────────────────
export default function AIModelsTab() {
  const { ai, refreshAI } = useApp();
  const [view, setView] = useState<View>({ kind: "models" });
  const [refreshing, setRefreshing] = useState(false);

  // Cooldowns tick down, so keep the list fresh while this tab is open.
  useEffect(() => {
    void refreshAI();
    const timer = window.setInterval(() => void refreshAI(), 8000);
    return () => window.clearInterval(timer);
  }, [refreshAI]);

  if (!ai) return <p className="hint">Loading the AI engine status…</p>;

  const rediscover = async () => {
    setRefreshing(true);
    await refreshAI(true);
    setRefreshing(false);
  };

  const provider = view.kind === "provider" ? ai.providers.find((p) => p.id === view.id) : undefined;
  if (provider) return <ProviderDetail key={provider.id} provider={provider} onBack={() => setView({ kind: "providers" })} />;
  if (view.kind === "add" && ai.can_manage) {
    return <AddProvider onBack={() => setView({ kind: "providers" })} onAdded={(id) => setView({ kind: "provider", id })} />;
  }

  const tab = view.kind === "providers" || view.kind === "provider" ? "providers" : "models";
  return (
    <>
      <div className="set-head">
        <Segmented
          label="AI models section"
          value={tab}
          onChange={(next) => setView({ kind: next })}
          options={[
            { value: "models", label: `${ai.can_manage ? "Default models" : "My models"} ${ai.chain.length}`, icon: "cpu" },
            { value: "providers", label: "Providers", icon: "server" },
          ]}
        />
        <Button size="sm" variant="ghost" icon="refresh" loading={refreshing} onClick={() => void rediscover()}>Refresh</Button>
      </div>
      {tab === "models" ? (
        <MyModels ai={ai} onBrowse={() => setView({ kind: "providers" })} />
      ) : (
        <ProviderList ai={ai} onOpen={(id) => setView({ kind: "provider", id })} onAdd={() => setView({ kind: "add" })} />
      )}
    </>
  );
}
