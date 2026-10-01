// Signature capture that stores pen strokes, not pixels: points in a fixed 600×200 box, encoded as
// an SVG path with relative moves ("M120 80l3 1 4 2 …"). A signature is ~1–4 KB of text and redraws
// crisply at any size (see server/src/lib/consent.ts for the accepted format).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';

const W = 600, H = 200, MIN_STEP = 2;
type Pt = [number, number];

export interface SignaturePadHandle { clear: () => void; toPath: () => string; isEmpty: () => boolean }

export const SignaturePad = forwardRef<SignaturePadHandle, { onChange?: (empty: boolean) => void; placeholder?: string }>(function SignaturePad({ onChange, placeholder }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Pt[][]>([]);
  const drawing = useRef(false);

  const redraw = useCallback(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const scale = cv.width / W;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0E0F11';
    for (const s of strokes.current) {
      ctx.beginPath();
      ctx.moveTo(s[0][0], s[0][1]);
      if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1]);
      for (let i = 1; i < s.length; i++) ctx.lineTo(s[i][0], s[i][1]);
      ctx.stroke();
    }
  }, []);

  // Keep the drawing buffer matched to the element's size (sharp on retina, correct after resize).
  useEffect(() => {
    const cv = canvas.current!;
    const fit = () => { cv.width = Math.round(cv.clientWidth * (window.devicePixelRatio || 1)); cv.height = Math.round(cv.width * H / W); redraw(); };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [redraw]);

  const point = (e: React.PointerEvent): Pt => {
    const r = canvas.current!.getBoundingClientRect();
    const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));
    return [clamp(((e.clientX - r.left) / r.width) * W, W - 1), clamp(((e.clientY - r.top) / r.height) * H, H - 1)];
  };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    canvas.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    strokes.current.push([point(e)]);
    redraw();
    onChange?.(false);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const s = strokes.current[strokes.current.length - 1];
    const p = point(e), last = s[s.length - 1];
    if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < MIN_STEP) return;
    s.push(p);
    redraw();
  };
  const up = () => { drawing.current = false; };

  useImperativeHandle(ref, () => ({
    clear: () => { strokes.current = []; redraw(); onChange?.(true); },
    isEmpty: () => strokes.current.reduce((n, s) => n + s.length, 0) < 12,
    toPath: () => strokes.current.map((s) => {
      const d = s.slice(1).map((p, i) => `${p[0] - s[i][0]} ${p[1] - s[i][1]}`);
      return `M${s[0][0]} ${s[0][1]}l${d.length ? d.join(' ') : '0 0'}`;
    }).join(''),
  }), [redraw, onChange]);

  return (
    <div className="relative rounded-3xl bg-white border-2 border-dashed border-ink-200 overflow-hidden">
      <canvas ref={canvas} className="block w-full touch-none cursor-crosshair" style={{ aspectRatio: `${W} / ${H}` }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      <div className="pointer-events-none absolute left-6 right-6 bottom-8 border-b border-ink-200" />
      {placeholder && <span className="pointer-events-none absolute left-6 bottom-2 text-[11px] text-ink-300">✕ {placeholder}</span>}
    </div>
  );
});

/** Draw a stored signature path. */
export function SignatureView({ path, className = '' }: { path: string; className?: string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`w-full bg-white rounded-2xl ${className}`} role="img" aria-label="Signature">
      <path d={path} fill="none" stroke="#0E0F11" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
