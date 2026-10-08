import { useEffect } from "react";
import type { ReactNode } from "react";
import { IconButton } from "./Button";

interface ModalProps {
  title: string;
  onClose: () => void;
  size?: "md" | "wide" | "xwide";
  footer?: ReactNode;
  children: ReactNode;
  /** Replaces the default padded body (used by modals with their own layout). */
  bare?: boolean;
}

export default function Modal({ title, onClose, size = "md", footer, children, bare = false }: ModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${size === "md" ? "" : size}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </header>
        {bare ? children : <div className="modal-body">{children}</div>}
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}
