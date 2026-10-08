import type { ButtonHTMLAttributes, ReactNode } from "react";
import Icon from "./Icon";
import type { IconName } from "./Icon";

type Variant = "primary" | "secondary" | "soft" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  /** Icon shown after the label. */
  iconRight?: IconName;
  loading?: boolean;
  block?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  loading = false,
  block = false,
  className = "",
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const iconSize = size === "sm" ? 15 : 17;
  const classes = ["btn", `btn-${variant}`, size !== "md" && `btn-${size}`, block && "btn-block", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <Icon name="spinner" size={iconSize} className="spinner" /> : icon && <Icon name={icon} size={iconSize} />}
      {children}
      {iconRight && !loading && <Icon name={iconRight} size={iconSize} />}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  /** Required: names the button for screen readers and the tooltip. */
  label: string;
  size?: "sm" | "md";
  danger?: boolean;
  active?: boolean;
  loading?: boolean;
}

export function IconButton({
  icon,
  label,
  size = "md",
  danger = false,
  active = false,
  loading = false,
  className = "",
  type = "button",
  disabled,
  ...rest
}: IconButtonProps) {
  const classes = ["icon-btn", size === "sm" && "sm", danger && "danger", active && "on", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={classes} aria-label={label} title={label} disabled={disabled || loading} {...rest}>
      <Icon name={loading ? "spinner" : icon} size={size === "sm" ? 15 : 18} className={loading ? "spinner" : undefined} />
    </button>
  );
}
