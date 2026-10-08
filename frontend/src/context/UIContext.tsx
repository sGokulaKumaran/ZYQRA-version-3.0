// App-wide feedback: toasts, plus promise-based confirm / prompt dialogs
// that replace the browser's blocking window.confirm() and window.prompt().

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "../components/ui/Button";
import Icon from "../components/ui/Icon";
import Modal from "../components/ui/Modal";
import { errorMessage } from "../lib/api";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
}

type Dialog =
  | { kind: "confirm"; options: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "prompt"; options: PromptOptions; resolve: (value: string | null) => void };

interface UIContextValue {
  toast: {
    success: (text: string) => void;
    info: (text: string) => void;
    /** Accepts a message or any thrown value. */
    error: (error: unknown) => void;
  };
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const UIContext = createContext<UIContextValue | null>(null);

const TOAST_ICON = { success: "checkCircle", error: "alertCircle", info: "info" } as const;

function PromptDialog({ options, onDone }: { options: PromptOptions; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(options.initial ?? "");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) onDone(value.trim());
  };
  return (
    <Modal title={options.title} onClose={() => onDone(null)}>
      <form onSubmit={submit} className="field" style={{ gap: 14 }}>
        <label className="field">
          {options.label && <span className="label">{options.label}</span>}
          <input
            className="input"
            autoFocus
            value={value}
            placeholder={options.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onFocus={(e) => e.target.select()}
            maxLength={120}
          />
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <Button variant="ghost" onClick={() => onDone(null)}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={!value.trim()}>
            {options.confirmLabel ?? "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const nextId = useRef(1);

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === "error" ? 6000 : 3200);
  }, []);

  const value = useMemo<UIContextValue>(
    () => ({
      toast: {
        success: (text) => push("success", text),
        info: (text) => push("info", text),
        error: (error) => push("error", typeof error === "string" ? error : errorMessage(error)),
      },
      confirm: (options) => new Promise((resolve) => setDialog({ kind: "confirm", options, resolve })),
      prompt: (options) => new Promise((resolve) => setDialog({ kind: "prompt", options, resolve })),
    }),
    [push],
  );

  const close = () => setDialog(null);

  return (
    <UIContext.Provider value={value}>
      {children}

      {dialog?.kind === "confirm" && (
        <Modal
          title={dialog.options.title}
          onClose={() => { dialog.resolve(false); close(); }}
          footer={
            <>
              <Button variant="ghost" onClick={() => { dialog.resolve(false); close(); }}>Cancel</Button>
              <Button
                variant={dialog.options.danger ? "danger" : "primary"}
                autoFocus
                onClick={() => { dialog.resolve(true); close(); }}
              >
                {dialog.options.confirmLabel ?? "Confirm"}
              </Button>
            </>
          }
        >
          <p style={{ color: "var(--text-2)" }}>{dialog.options.message}</p>
        </Modal>
      )}

      {dialog?.kind === "prompt" && (
        <PromptDialog options={dialog.options} onDone={(result) => { dialog.resolve(result); close(); }} />
      )}

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon name={TOAST_ICON[t.kind]} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </UIContext.Provider>
  );
}

export function useUI(): UIContextValue {
  const value = useContext(UIContext);
  if (!value) throw new Error("useUI must be used inside <UIProvider>");
  return value;
}
