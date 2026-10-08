// Floating Pomodoro timer. Drag the pill anywhere; finished focus blocks are
// logged to the server so they count toward the daily goal and the streak.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useUI } from "../../context/UIContext";
import { api } from "../../lib/api";
import { formatClock } from "../../lib/format";
import { Button, IconButton } from "../ui/Button";
import Icon from "../ui/Icon";
import { ProgressRing, Segmented } from "../ui/primitives";
import "./timer.css";

type Mode = "focus" | "short" | "long";

const MODES: { value: Mode; label: string }[] = [
  { value: "focus", label: "Focus" },
  { value: "short", label: "Short break" },
  { value: "long", label: "Long break" },
];

const STORAGE_KEY = "zyqra_timer";
const LONG_BREAK_EVERY = 4;
const MIN_LOGGED_SECONDS = 60;

interface Prefs {
  minutes: Record<Mode, number>;
  sound: boolean;
  right: number;
  bottom: number;
}

const DEFAULT_PREFS: Prefs = { minutes: { focus: 25, short: 5, long: 15 }, sound: true, right: 24, bottom: 24 };

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return { ...DEFAULT_PREFS, ...saved, minutes: { ...DEFAULT_PREFS.minutes, ...saved.minutes } };
  } catch {
    return DEFAULT_PREFS;
  }
}

function chime() {
  try {
    const context = new AudioContext();
    [660, 880, 990].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * 0.18;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.34);
    });
  } catch {
    // audio is a nicety; ignore browsers that block it
  }
}

export default function FocusTimer() {
  const { toast } = useUI();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("focus");
  const [label, setLabel] = useState("");
  const [remaining, setRemaining] = useState(prefs.minutes.focus * 60);
  const [endsAt, setEndsAt] = useState<number | null>(null); // set while running
  const [started, setStarted] = useState(false); // a block is in progress (running or paused)
  const [completed, setCompleted] = useState(0);
  const [editing, setEditing] = useState(false);

  const total = prefs.minutes[mode] * 60;
  const running = endsAt !== null;
  const wrapRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; right: number; bottom: number; moved: boolean } | null>(null);

  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)), [prefs]);

  // Keep the idle clock in step with the chosen mode / duration.
  useEffect(() => {
    if (!started) setRemaining(prefs.minutes[mode] * 60);
  }, [mode, prefs.minutes, started]);

  const logFocus = useCallback(
    async (seconds: number) => {
      const minutes = Math.round(seconds / 60);
      if (minutes < 1) return;
      try {
        await api.post("/api/focus/sessions", { minutes, label: label.trim() });
      } catch (error) {
        toast.error(error);
      }
    },
    [label, toast],
  );

  const finish = useCallback(() => {
    setEndsAt(null);
    setStarted(false);
    if (prefs.sound) chime();
    if (mode === "focus") {
      void logFocus(total);
      const count = completed + 1;
      setCompleted(count);
      setMode(count % LONG_BREAK_EVERY === 0 ? "long" : "short");
      toast.success(`Focus block done — ${prefs.minutes.focus} min logged. Time for a break.`);
    } else {
      setMode("focus");
      toast.info("Break over. Ready for the next focus block?");
    }
  }, [mode, total, completed, prefs.sound, prefs.minutes.focus, logFocus, toast]);

  // Tick from the wall clock so the timer stays right in background tabs.
  useEffect(() => {
    if (endsAt === null) return;
    const tick = () => {
      const left = Math.ceil((endsAt - Date.now()) / 1000);
      if (left <= 0) finish();
      else setRemaining(left);
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [endsAt, finish]);

  useEffect(() => {
    if (!started) return;
    const original = document.title;
    document.title = `${formatClock(remaining)} · ${mode === "focus" ? "Focus" : "Break"} — Zyqra`;
    return () => { document.title = original; };
  }, [remaining, started, mode]);

  const start = () => { setEndsAt(Date.now() + remaining * 1000); setStarted(true); setEditing(false); };
  const pause = () => setEndsAt(null);
  const reset = () => {
    // Stopping a focus block early still counts the time actually spent.
    if (started && mode === "focus" && total - remaining >= MIN_LOGGED_SECONDS) {
      void logFocus(total - remaining);
      toast.info(`${Math.round((total - remaining) / 60)} min of focus logged.`);
    }
    setEndsAt(null);
    setStarted(false);
    setRemaining(total);
  };
  const switchMode = (next: Mode) => {
    if (started) reset();
    setMode(next);
  };

  // ── dragging ────────────────────────────────────────────────
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    drag.current = { x: event.clientX, y: event.clientY, right: prefs.right, bottom: prefs.bottom, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const origin = drag.current;
    if (!origin) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    if (!origin.moved && Math.hypot(dx, dy) < 5) return;
    origin.moved = true;
    const box = wrapRef.current?.getBoundingClientRect();
    const width = box?.width ?? 120;
    const height = box?.height ?? 44;
    setPrefs((p) => ({
      ...p,
      right: Math.max(8, Math.min(window.innerWidth - width - 8, origin.right - dx)),
      bottom: Math.max(8, Math.min(window.innerHeight - height - 8, origin.bottom - dy)),
    }));
  };
  const onPointerUp = () => {
    const moved = drag.current?.moved;
    drag.current = null;
    if (!moved) setOpen((value) => !value);
  };

  const setMinutes = (target: Mode, value: number) =>
    setPrefs((p) => ({ ...p, minutes: { ...p.minutes, [target]: Math.max(1, Math.min(180, Math.round(value) || 1)) } }));

  const progress = total > 0 ? ((total - remaining) / total) * 100 : 0;
  const tone = mode === "focus" ? "accent" : "success";
  // Open the panel downward when the pill sits in the top half of the window.
  const dropDown = prefs.bottom > window.innerHeight / 2;

  return (
    <div ref={wrapRef} className="timer" style={{ right: prefs.right, bottom: prefs.bottom }}>
      {open && (
        <section className={`timer-panel card ${dropDown ? "below" : "above"}`} aria-label="Focus timer">
          <header className="timer-head">
            <Icon name="timer" size={17} />
            <strong>Focus timer</strong>
            <IconButton
              icon={prefs.sound ? "volume" : "volumeOff"}
              label={prefs.sound ? "Mute the finish sound" : "Unmute the finish sound"}
              size="sm"
              onClick={() => setPrefs((p) => ({ ...p, sound: !p.sound }))}
            />
            <IconButton icon="settings" label="Change durations" size="sm" active={editing} onClick={() => setEditing((v) => !v)} />
            <IconButton icon="close" label="Close" size="sm" onClick={() => setOpen(false)} />
          </header>

          <Segmented label="Timer mode" value={mode} onChange={switchMode} options={MODES} />

          {editing ? (
            <div className="timer-edit">
              {MODES.map((m) => (
                <label key={m.value} className="field">
                  <span className="label">{m.label} (min)</span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={180}
                    value={prefs.minutes[m.value]}
                    disabled={started}
                    onChange={(e) => setMinutes(m.value, Number(e.target.value))}
                  />
                </label>
              ))}
              {started && <p className="hint">Reset the timer to change durations.</p>}
            </div>
          ) : (
            <>
              <div className="timer-ring">
                <ProgressRing value={progress} size={168} stroke={9} tone={tone}>
                  <div>
                    <div className="timer-clock">{formatClock(remaining)}</div>
                    <div className="timer-sub">
                      {mode === "focus" ? `Block ${(completed % LONG_BREAK_EVERY) + 1} of ${LONG_BREAK_EVERY}` : "Take a breather"}
                    </div>
                  </div>
                </ProgressRing>
              </div>
              {mode === "focus" && (
                <input
                  className="input"
                  value={label}
                  maxLength={80}
                  placeholder="What are you studying? (optional)"
                  onChange={(e) => setLabel(e.target.value)}
                />
              )}
              <div className="timer-actions">
                {running ? (
                  <Button variant="secondary" icon="pause" onClick={pause} block>Pause</Button>
                ) : (
                  <Button variant="primary" icon="play" onClick={start} block>{started ? "Resume" : "Start"}</Button>
                )}
                <IconButton icon="refresh" label="Reset" onClick={reset} disabled={!started} />
              </div>
              <p className="timer-foot">
                <Icon name="checkCircle" size={14} />
                {completed} focus {completed === 1 ? "block" : "blocks"} completed this session
              </p>
            </>
          )}
        </section>
      )}

      <button
        type="button"
        className={`timer-pill ${running ? "running" : ""} ${mode !== "focus" ? "break" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen((value) => !value)}
        aria-label={`Focus timer, ${formatClock(remaining)} ${running ? "remaining" : ""}. Click to open, drag to move.`}
        title="Focus timer — click to open, drag to move"
      >
        <Icon name={mode === "focus" ? "timer" : "coffee"} size={17} />
        <span>{formatClock(remaining)}</span>
      </button>
    </div>
  );
}
