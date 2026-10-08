import type { ReactNode } from "react";

interface SplitViewProps {
  /** The list panel (use the .panel classes). */
  panel: ReactNode;
  children: ReactNode;
  /** On narrow screens the panel is a drawer; this controls it. */
  panelOpen: boolean;
  onPanelClose: () => void;
}

/** List panel on the left, content on the right. */
export default function SplitView({ panel, children, panelOpen, onPanelClose }: SplitViewProps) {
  return (
    <div
      className={`split ${panelOpen ? "panel-open" : ""}`}
      onClick={(e) => {
        // The scrim is a pseudo-element of .split, so a click on .split itself is a click on it.
        if (panelOpen && e.target === e.currentTarget) onPanelClose();
      }}
    >
      <aside className="panel">{panel}</aside>
      <div className="split-main">{children}</div>
    </div>
  );
}
