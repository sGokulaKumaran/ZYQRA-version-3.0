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

  // ================= DRAG =================
  useEffect(() => {
    const el = dragRef.current;
    if (!el) return;
    let isDragging = false;
    let offsetX = 0, offsetY = 0, startX = 0, startY = 0;

    const down = (e: MouseEvent) => {
      isDragging = true;
      hasDragged.current = false;
      startX = e.clientX;
      startY = e.clientY;
      offsetX = e.clientX - el.offsetLeft;
      offsetY = e.clientY - el.offsetTop;
    };

    const move = (e: MouseEvent) => {
      if (!isDragging) return;
      if (
        Math.abs(e.clientX - startX) > 5 ||
        Math.abs(e.clientY - startY) > 5
      ) {
        hasDragged.current = true;
      }
      el.style.left = `${e.clientX - offsetX}px`;
      el.style.top = `${e.clientY - offsetY}px`;
    };

    const up = () => { isDragging = false; };

    el.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);

    return () => {
      el.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  // ================= TIMER =================
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isRunning && !isPaused) {
      interval = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            setIsRunning(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRunning, isPaused]);

  // ================= SYNC INPUT =================
  useEffect(() => {
    if (!isRunning) {
      setTimeLeft(minutes * 60 + seconds);
    }
  }, [minutes, seconds]);

  // ================= CONTROLS =================
  const start = () => {
    setTimeLeft(minutes * 60 + seconds);
    setIsRunning(true);
    setIsPaused(false);
  };
  const pause = () => setIsPaused(true);
  const resume = () => setIsPaused(false);
  const stop = () => {
    setIsRunning(false);
    setIsPaused(false);
    setTimeLeft(minutes * 60 + seconds);
  };

  const format = (time: number) => {
    const m = Math.floor(time / 60);
    const s = time % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleFloatClick = () => {
    if (!hasDragged.current) setOpen(true);
  };

  // ================= UI =================
  return (
    <div ref={dragRef} className="fixed top-32 right-10 z-[9999]">
      {!open ? (
        <div
          onClick={handleFloatClick}
          className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-xl cursor-pointer hover:scale-110 transition select-none"
        >
          <span className="text-xs font-bold text-white">
            {timeLeft > 0 ? format(timeLeft) : "⏱"}
          </span>
        </div>
      ) : (
        <div className="w-72 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-5 text-white">
          {/* HEADER */}
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              ⏱ <span>Focus Timer</span>
            </h2>
            <button
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-red-400 text-lg"
            >
              ✕
            </button>
          </div>

          {/* INPUT */}
          <div className="flex gap-3 mb-5">
            <div className="flex flex-col items-center w-full">
              <label className="text-xs text-gray-400 mb-1">Minutes</label>
              <input
                type="number"
                value={minutes}
                min={0}
                disabled={isRunning}
                onChange={(e) => setMinutes(Math.max(0, Number(e.target.value)))}
                className="w-full text-center p-2 rounded-lg bg-white/10 border border-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500 text-white"
              />
            </div>
            <div className="flex flex-col items-center w-full">
              <label className="text-xs text-gray-400 mb-1">Seconds</label>
              <input
                type="number"
                value={seconds}
                min={0}
                max={59}
                disabled={isRunning}
                onChange={(e) =>
                  setSeconds(Math.min(59, Math.max(0, Number(e.target.value))))
                }
                className="w-full text-center p-2 rounded-lg bg-white/10 border border-white/10 focus:outline-none focus:ring-2 focus:ring-purple-500 text-white"
              />
            </div>
          </div>

          {/* DISPLAY */}
          <div className="text-center mb-6">
            <div className="text-4xl font-bold tracking-wider">
              {format(timeLeft)}
            </div>
            <p className="text-xs text-gray-400 mt-1">Remaining Time</p>
          </div>

          {/* BUTTONS */}
          <div className="flex gap-2">
            {!isRunning && (
              <button
                onClick={start}
                className="flex-1 bg-gradient-to-r from-green-500 to-emerald-600 p-2 rounded-lg font-semibold hover:opacity-90 transition"
              >
                Start
              </button>
            )}
            {isRunning && !isPaused && (
              <button
                onClick={pause}
                className="flex-1 bg-yellow-500 p-2 rounded-lg font-semibold hover:bg-yellow-600 transition"
              >
                Pause
              </button>
            )}
            {isPaused && (
              <button
                onClick={resume}
                className="flex-1 bg-blue-500 p-2 rounded-lg font-semibold hover:bg-blue-600 transition"
              >
                Resume
              </button>
            )}
            {isRunning && (
              <button
                onClick={stop}
                className="flex-1 bg-red-500 p-2 rounded-lg font-semibold hover:bg-red-600 transition"
              >
                Stop
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}