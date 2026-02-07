import { useRef, useEffect, useCallback } from "react";
import { StopCircle } from "@phosphor-icons/react";
import type { FormatMode } from "../hooks/useDictation.js";

const MODES: { value: FormatMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "format", label: "Format" },
  { value: "clean", label: "Clean" },
  { value: "editorial", label: "Editorial" },
];

const BAR_COUNT = 32;
const HISTORY_SIZE = BAR_COUNT;

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface DictationOverlayProps {
  elapsed: number;
  formatMode: FormatMode;
  onSetFormatMode: (mode: FormatMode) => void;
  audioLevelRef: React.RefObject<number>;
  onStop: () => void;
}

export function DictationOverlay({
  elapsed,
  formatMode,
  onSetFormatMode,
  audioLevelRef,
  onStop,
}: DictationOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<number[]>(new Array(HISTORY_SIZE).fill(0));
  const animRef = useRef<number>(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Push new level, shift history
    const raw = audioLevelRef.current;
    // Amplify and clamp for visual range
    const level = Math.min(1, raw * 4);
    historyRef.current.push(level);
    if (historyRef.current.length > HISTORY_SIZE) {
      historyRef.current.shift();
    }

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);

    const barWidth = w / BAR_COUNT;
    const gap = 1.5;
    const history = historyRef.current;
    const midY = h / 2;

    for (let i = 0; i < BAR_COUNT; i++) {
      const val = history[history.length - BAR_COUNT + i] ?? 0;
      // Min bar height of 2px, max is half the canvas height
      const barH = Math.max(2, val * midY * 0.9);

      // Gradient from accent (active) to muted
      const alpha = 0.4 + val * 0.6;
      ctx.fillStyle = `rgba(196, 149, 106, ${alpha})`;
      ctx.beginPath();
      const x = i * barWidth + gap / 2;
      const bw = barWidth - gap;
      const radius = Math.min(1.5, bw / 2);

      // Draw rounded rect centered vertically
      roundRect(ctx, x, midY - barH, bw, barH * 2, radius);
      ctx.fill();
    }

    animRef.current = requestAnimationFrame(draw);
  }, [audioLevelRef]);

  useEffect(() => {
    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw]);

  const modeIndex = MODES.findIndex((m) => m.value === formatMode);

  return (
    <div className="dictation-overlay">
      {/* Waveform + timer row */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="recording-dot" />
          <span className="text-xs text-danger tabular-nums font-medium">
            {formatElapsed(elapsed)}
          </span>
        </div>

        <canvas
          ref={canvasRef}
          className="flex-1 h-8"
          style={{ minWidth: 0 }}
        />

        <button
          onClick={onStop}
          title="Stop recording"
          className="p-1 rounded-full text-danger hover:bg-surface-alt transition-colors"
        >
          <StopCircle size={22} weight="fill" />
        </button>
      </div>

      {/* Mode slider row */}
      <div className="flex items-center gap-2 mt-2">
        <div className="dictation-mode-track">
          {MODES.map((m, i) => (
            <button
              key={m.value}
              onClick={() => onSetFormatMode(m.value)}
              className={`dictation-mode-stop ${i === modeIndex ? "active" : ""}`}
            >
              {m.label}
            </button>
          ))}
          {/* Sliding indicator */}
          <div
            className="dictation-mode-indicator"
            style={{ left: `${modeIndex * 25}%`, width: "25%" }}
          />
        </div>
      </div>
    </div>
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
