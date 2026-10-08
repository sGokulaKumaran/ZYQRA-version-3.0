// Small presentational building blocks used across features.

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { scoreTone } from "../../lib/format";
import type { Free, ModelMeta } from "../../lib/types";
import Icon from "./Icon";
import type { IconName } from "./Icon";

export function Spinner({ size = 18 }: { size?: number }) {
  return <Icon name="spinner" size={size} className="spinner" />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="empty muted">
      <Spinner size={24} />
      <span>{label}</span>
    </div>
  );
}

interface EmptyStateProps {
  icon: IconName;
  title: string;
  text?: string;
  children?: ReactNode;
}

export function EmptyState({ icon, title, text, children }: EmptyStateProps) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={26} /></div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: IconName }[];
  label: string;
}

export function Segmented<T extends string>({ value, onChange, options, label }: SegmentedProps<T>) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={option.value === value ? "on" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.icon && <Icon name={option.icon} size={15} />}
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface ProgressRingProps {
  /** 0–100 */
  value: number;
  size?: number;
  stroke?: number;
  /** Colour token; defaults to a tone derived from the value. */
  tone?: "success" | "accent" | "warning" | "danger";
  children?: ReactNode;
}

export function ProgressRing({ value, size = 96, stroke = 8, tone, children }: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = `var(--${tone ?? scoreTone(clamped)})`;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          style={{ transition: "stroke-dashoffset 0.8s var(--ease)" }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
        {children}
      </div>
    </div>
  );
}

const EFFORT_REASON = {
  simple: "Auto chose a fast model for this quick question.",
  standard: "Auto chose this model for an everyday question.",
  complex: "Auto chose a powerful model for this harder question.",
} as const;

/** "Answered by …" tag; flags when the best-fitting model could not be used. */
export function ModelBadge({ model }: { model: Pick<ModelMeta, "label" | "fallback" | "effort"> }) {
  const reason = model.fallback
    ? "The best-fitting model was at its limit or not responding, so the next best one answered."
    : model.effort ? EFFORT_REASON[model.effort] : "Answered by this model";
  return (
    <span className={`badge ${model.fallback ? "warning" : ""}`} title={reason}>
      <Icon name={model.fallback ? "repeat" : "sparkles"} size={12} />
      {model.label}
    </span>
  );
}

/** Free / Paid tag for a model; renders nothing when the provider doesn't say. */
export function FreeBadge({ free }: { free: Free }) {
  if (free === null) return null;
  return free ? (
    <span className="badge success" title="Free to use, within the provider's rate limits.">Free</span>
  ) : (
    <span className="badge warning" title="The provider bills for this model.">Paid</span>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Switch({ checked, onChange, label, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`switch ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}

interface MenuProps {
  /** Renders the trigger; call `toggle` from its onClick. */
  trigger: (toggle: () => void, open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  direction?: "up" | "down";
}

export function Menu({ trigger, children, align = "left", direction = "down" }: MenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={ref}>
      {trigger(() => setOpen((v) => !v), open)}
      {open && (
        <div className={`menu ${direction} ${align === "right" ? "right" : ""}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

interface MenuItemProps {
  icon?: IconName;
  label: string;
  hint?: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
}

export function MenuItem({ icon, label, hint, active, danger, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu-item ${active ? "on" : ""} ${danger ? "danger" : ""}`}
      onClick={onClick}
    >
      {icon && <Icon name={icon} size={16} />}
      <span style={{ flex: 1 }}>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      {active && <Icon name="check" size={15} />}
    </button>
  );
}
