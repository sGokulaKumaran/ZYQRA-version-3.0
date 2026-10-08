import { useEffect, useRef, useState } from "react";

export default function FloatingTimer() {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState(25);
  const [seconds, setSeconds] = useState(0);
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const dragRef = useRef<HTMLDivElement>(null);
  const hasDragged = useRef(false);

  useEffect(() => {
    const el = dragRef.current;
    if (!el) return;
    let isDragging = false;
    let offsetX = 0, offsetY = 0, startX = 0, startY = 0;
    const down = (e: MouseEvent) => {
      isDragging = true; hasDragged.current = false;
      startX = e.clientX; startY = e.clientY;
      offsetX = e.clientX - el.offsetLeft; offsetY = e.clientY - el.offsetTop;
    };
    const move = (e: MouseEvent) => {
      if (!isDragging) return;
      if (Math.abs(e.clientX - startX) > 5 || Math.abs(e.clientY - startY) > 5) hasDragged.current = true;
      el.style.left = `${e.clientX - offsetX}px`;
      el.style.top = `${e.clientY - offsetY}px`;
    };
    const up = () => { isDragging = false; };
    el.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { el.removeEventListener("mousedown", down); window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isRunning && !isPaused) {
      interval = setInterval(() => {
        setTimeLeft((prev) => { if (prev <= 1) { clearInterval(interval); setIsRunning(false); return 0; } return prev - 1; });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRunning, isPaused]);

  useEffect(() => { if (!isRunning) setTimeLeft(minutes * 60 + seconds); }, [minutes, seconds]);

  const start = () => { setTimeLeft(minutes * 60 + seconds); setIsRunning(true); setIsPaused(false); };
  const pause = () => setIsPaused(true);
  const resume = () => setIsPaused(false);
  const stop = () => { setIsRunning(false); setIsPaused(false); setTimeLeft(minutes * 60 + seconds); };
  const format = (time: number) => `${Math.floor(time / 60)}:${(time % 60).toString().padStart(2, "0")}`;
  const handleFloatClick = () => { if (!hasDragged.current) setOpen(true); };

  return (
    <>
      <style>{`
        .ft-wrap { position: fixed; top: 128px; right: 40px; z-index: 9999; }
        .ft-bubble {
          width: 64px; height: 64px; border-radius: 50%;
          background: linear-gradient(135deg, #3b82f6, #8b5cf6);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 8px 24px rgba(59,130,246,0.4);
          cursor: pointer; user-select: none; transition: transform 0.15s;
        }
        .ft-bubble:hover { transform: scale(1.1); }
        .ft-bubble-text { font-size: 11px; font-weight: 700; color: white; }
        .ft-panel {
          width: 280px; background: var(--bg-card); border: 1px solid var(--border);
          border-radius: 18px; box-shadow: var(--shadow-card); padding: 20px;
          color: var(--text-primary); font-family: 'DM Sans', 'Segoe UI', sans-serif;
        }
        .ft-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
        .ft-title { font-size: 16px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 8px; }
        .ft-close { background: none; border: none; color: var(--text-muted); font-size: 16px; cursor: pointer; transition: color 0.15s; }
        .ft-close:hover { color: #f87171; }
        .ft-inputs { display: flex; gap: 12px; margin-bottom: 20px; }
        .ft-input-group { display: flex; flex-direction: column; align-items: center; flex: 1; gap: 4px; }
        .ft-label { font-size: 11px; color: var(--text-muted); }
        .ft-input {
          width: 100%; text-align: center; padding: 8px;
          border-radius: 8px; background: var(--bg-input); border: 1px solid var(--border);
          color: var(--text-primary); outline: none; font-size: 15px; font-family: inherit;
          transition: border-color 0.2s;
        }
        .ft-input:focus { border-color: var(--border-accent); }
        .ft-input:disabled { opacity: 0.5; }
        .ft-display { text-align: center; margin-bottom: 20px; }
        .ft-time { font-size: 38px; font-weight: 700; letter-spacing: 2px; color: var(--text-primary); }
        .ft-remaining { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
        .ft-buttons { display: flex; gap: 8px; }
        .ft-btn { flex: 1; padding: 9px; border-radius: 9px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; transition: opacity 0.15s; font-family: inherit; }
        .ft-btn:hover { opacity: 0.88; }
        .ft-btn-start  { background: linear-gradient(135deg, #22c55e, #16a34a); color: white; }
        .ft-btn-pause  { background: #f59e0b; color: white; }
        .ft-btn-resume { background: #3b82f6; color: white; }
        .ft-btn-stop   { background: #ef4444; color: white; }
      `}</style>
      <div ref={dragRef} className="ft-wrap">
        {!open ? (
          <div className="ft-bubble" onClick={handleFloatClick}>
            <span className="ft-bubble-text">{timeLeft > 0 ? format(timeLeft) : "⏱"}</span>
          </div>
        ) : (
          <div className="ft-panel">
            <div className="ft-header">
              <span className="ft-title">⏱ Focus Timer</span>
              <button className="ft-close" onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className="ft-inputs">
              <div className="ft-input-group">
                <label className="ft-label">Minutes</label>
                <input type="number" className="ft-input" value={minutes} min={0} disabled={isRunning}
                  onChange={(e) => setMinutes(Math.max(0, Number(e.target.value)))} />
              </div>
              <div className="ft-input-group">
                <label className="ft-label">Seconds</label>
                <input type="number" className="ft-input" value={seconds} min={0} max={59} disabled={isRunning}
                  onChange={(e) => setSeconds(Math.min(59, Math.max(0, Number(e.target.value))))} />
              </div>
            </div>
            <div className="ft-display">
              <div className="ft-time">{format(timeLeft)}</div>
              <div className="ft-remaining">Remaining Time</div>
            </div>
            <div className="ft-buttons">
              {!isRunning && <button className="ft-btn ft-btn-start" onClick={start}>Start</button>}
              {isRunning && !isPaused && <button className="ft-btn ft-btn-pause" onClick={pause}>Pause</button>}
              {isPaused && <button className="ft-btn ft-btn-resume" onClick={resume}>Resume</button>}
              {isRunning && <button className="ft-btn ft-btn-stop" onClick={stop}>Stop</button>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}