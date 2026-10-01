import { ChevronLeft, ChevronRight, Dumbbell, PlayCircle } from 'lucide-react';
import { todayLocal } from '../lib/format';
import { media } from '../lib/fit';
import { useEffect, useState } from 'react';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shift = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

/** Week strip (reference: "21 Wed · 18 Fri · 19 Sat" pills). */
export function DateStrip({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const today = todayLocal();
  const days = Array.from({ length: 7 }, (_, i) => shift(value > shift(today, -3) ? today : shift(value, 3), i - 6));
  return (
    <div className="flex items-center gap-1 sm:gap-1.5">
      <button className="icon-btn shrink-0 w-8 sm:w-10" onClick={() => onChange(shift(value, -1))} aria-label="Previous day"><ChevronLeft className="w-5 h-5" /></button>
      <div className="flex-1 min-w-0 grid grid-cols-7 gap-1 sm:gap-1.5">
        {days.map((d) => {
          const on = d === value;
          return (
            <button key={d} onClick={() => onChange(d)} className={`min-w-0 rounded-2xl py-2 flex flex-col items-center transition ${on ? 'bg-lime text-ink-900' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}>
              <span className={`text-[10px] font-semibold tracking-tight ${on ? 'text-ink-700' : 'muted'}`}>{d === today ? 'Today' : DOW[new Date(d + 'T00:00:00Z').getUTCDay()]}</span>
              <span className="font-display font-bold text-lg leading-tight">{Number(d.slice(8))}</span>
            </button>
          );
        })}
      </div>
      <button className="icon-btn shrink-0 w-8 sm:w-10 disabled:opacity-30" disabled={value >= today} onClick={() => onChange(shift(value, 1))} aria-label="Next day"><ChevronRight className="w-5 h-5" /></button>
    </div>
  );
}

export function MacroBar({ label, value, target, color }: { label: string; value: number; target: number | null; color: string }) {
  const pct = target ? Math.min(100, (value / target) * 100) : 0;
  const over = !!target && value > target * 1.05;
  return (
    <div>
      {/* Label and amount wrap as whole units, so narrow phones never split "151 g" or glue "Protein0". */}
      <div className="flex flex-wrap justify-between gap-x-2 text-xs mb-1"><span className="font-semibold">{label}</span>
        <span className={`whitespace-nowrap ${over ? 'text-warn font-semibold' : 'muted'}`}>{Math.round(value)}{target ? ` / ${target}` : ''} g</span></div>
      <div className="h-2 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden"><div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} /></div>
    </div>
  );
}

/** Two-frame exercise photo (start/end) that alternates to show the movement. */
export function ExercisePhoto({ images, alt, className = '' }: { images: string[]; alt: string; className?: string }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (images.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % images.length), 1100);
    return () => clearInterval(t);
  }, [images.length]);
  if (!images.length) {
    return <div className={`flex items-center justify-center bg-gradient-to-br from-ink-700 to-ink-900 text-lime ${className}`}><Dumbbell className="w-1/3 h-1/3 opacity-70" /></div>;
  }
  return (
    <div className={`relative bg-white overflow-hidden ${className}`}>
      {images.map((p, k) => <img key={p} src={media(p)} alt={k === 0 ? alt : ''} loading="lazy" className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${k === i ? 'opacity-100' : 'opacity-0'}`} />)}
    </div>
  );
}

const youtubeId = (u: string) => u.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/)?.[1] ?? null;

/** Exercise demo video: gym upload ('u/…'), YouTube link, or any other https link. */
export function ExerciseVideo({ video }: { video: string }) {
  const yt = youtubeId(video);
  const box = 'w-full aspect-video rounded-3xl overflow-hidden bg-black mb-3';
  if (video.startsWith('u/')) return <video src={media(video)} controls playsInline preload="metadata" className={box} />;
  if (yt) return <div className={box}><iframe src={`https://www.youtube-nocookie.com/embed/${yt}`} title="Exercise video" className="w-full h-full" allow="encrypted-media; picture-in-picture" allowFullScreen loading="lazy" /></div>;
  if (/\.(mp4|webm)(\?|$)/i.test(video)) return <video src={video} controls playsInline preload="metadata" className={box} />;
  return <a href={video} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm mb-3"><PlayCircle className="w-4 h-4" />Watch video</a>;
}

export function Credits() {
  return (
    <p className="text-[10px] muted text-center leading-relaxed px-4 py-3">
      Exercise data: <a className="underline" href="https://github.com/hasaneyldrm/exercises-dataset" target="_blank" rel="noreferrer">exercises-dataset</a> (MIT) ·
      Photos: <a className="underline" href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noreferrer">free-exercise-db</a> (public domain) ·
      Nutrition: Indian Nutrient Databank, USDA FoodData Central. Estimates only — not medical advice.
    </p>
  );
}

export function Stepper({ value, onChange, step = 1, min = 0, suffix }: { value: number; onChange: (v: number) => void; step?: number; min?: number; suffix?: string }) {
  return (
    <div className="flex items-center rounded-2xl border border-paper-line dark:border-ink-600 overflow-hidden">
      <button type="button" className="w-10 h-11 text-lg font-bold hover:bg-black/5 dark:hover:bg-white/5" onClick={() => onChange(Math.max(min, Math.round((value - step) * 100) / 100))}>−</button>
      <input className="w-14 h-11 text-center bg-transparent font-display font-bold outline-none" inputMode="decimal" value={value}
        onChange={(e) => { const n = Number(e.target.value.replace(',', '.')); if (Number.isFinite(n)) onChange(Math.max(min, n)); }} />
      {suffix && <span className="text-xs muted -ml-1 mr-1">{suffix}</span>}
      <button type="button" className="w-10 h-11 text-lg font-bold hover:bg-black/5 dark:hover:bg-white/5" onClick={() => onChange(Math.round((value + step) * 100) / 100)}>+</button>
    </div>
  );
}
