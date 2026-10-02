// Weight tracking UI: weekly weigh-in prompt, log sheet, and the trend card with day/week/month views.
import { useState } from 'react';
import { CalendarClock, Scale, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { api } from '../lib/api';
import { date as fmtDate } from '../lib/format';
import type { WeighIn, WeightHistory, WeightStatus, WeightTrend, WeightView } from '../lib/fit';
import { Sheet, Spinner, useAction, useLoad } from './ui';
import { Stepper } from './fit-ui';

/** Gym-local (IST) date, YYYY-MM-DD. */
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

/** Home card shown when the weekly weigh-in is due. */
export function WeighInPrompt({ w, onLog }: { w: WeighIn; onLog: () => void }) {
  if (!w.due) return null;
  return (
    <button onClick={onLog} className="w-full card card-pad flex items-center gap-4 text-left border-lime/60 dark:border-lime/40">
      <div className="w-12 h-12 rounded-2xl bg-lime text-ink-900 flex items-center justify-center shrink-0"><Scale className="w-6 h-6" /></div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold">Weekly weigh-in due</p>
        <p className="text-sm muted">{w.last_day ? `Last: ${w.last_kg} kg, ${w.days_since} days ago` : 'Log your weight to start your trend'}</p>
      </div>
      <span className="btn btn-primary btn-sm shrink-0">Log</span>
    </button>
  );
}

export function WeightSheet({ current, onClose, onSaved }: { current: number; onClose: () => void; onSaved: () => void }) {
  const today = todayIst();
  const [kg, setKg] = useState(current);
  const [day, setDay] = useState(today);
  const { busy, run } = useAction();
  const save = () => run(() => api.post('/fit/weight', { weight_kg: kg, date: day }), 'Weight saved — BMI & targets updated').then((r) => r && onSaved());
  return (
    <Sheet open onClose={onClose} title={day === today ? "Log today's weight" : 'Log weight'}
      footer={<button className="btn btn-primary btn-lg w-full" disabled={busy || kg < 30 || kg > 250} onClick={save}>{busy && <Spinner className="w-4 h-4" />}Save {kg} kg</button>}>
      <div className="flex justify-center py-6"><Stepper value={kg} onChange={setKg} step={0.1} min={30} suffix="kg" /></div>
      <label className="flex items-center justify-between gap-3 text-sm mb-3">
        <span className="muted">Date</span>
        <input type="date" className="input h-10 w-auto" value={day} max={today} onChange={(e) => setDay(e.target.value || today)} />
      </label>
      <p className="text-xs muted text-center">Weigh yourself once a week, same day, in the morning before breakfast — that gives the most honest trend.</p>
    </Sheet>
  );
}

const STATUS: Record<WeightStatus, { label: string; tone: string }> = {
  reached: { label: 'Goal reached', tone: 'bg-lime text-ink-900' },
  on_track: { label: 'On track', tone: 'bg-lime/20 text-lime' },
  slow: { label: 'Slow progress', tone: 'bg-warn/20 text-warn' },
  off_track: { label: 'Off track', tone: 'bg-bad/20 text-bad' },
  steady: { label: 'Holding steady', tone: 'bg-lime/20 text-lime' },
  drifting: { label: 'Drifting', tone: 'bg-warn/20 text-warn' },
  new: { label: 'Building trend', tone: 'bg-white/10 text-ink-300' },
};

/** One plain sentence on where the member stands and what to do next. */
function coachLine(t: WeightTrend) {
  const rate = t.weekly_rate === null ? null : Math.abs(t.weekly_rate);
  switch (t.status) {
    case 'reached': return `You've reached ${t.target} kg — brilliant! Set a new target or keep weighing in weekly to hold it.`;
    case 'on_track': return `Moving ${rate} kg a week towards ${t.target} kg.${t.eta ? ` At this pace you'll get there around ${fmtDate(t.eta)}.` : ''}`;
    case 'slow': return `Only ${rate ?? 0} kg a week lately. Tighten your meals a little and add one more session this week.`;
    case 'off_track': return `Moving away from your goal (${signed(t.weekly_rate ?? 0)} kg a week). Check your calories in Diet, or ask a trainer to adjust your plan.`;
    case 'steady': return 'Within 2 kg of where you started — nicely maintained.';
    case 'drifting': return `${signed(t.change_total ?? 0)} kg since you started. Review your calorie target if that's not what you want.`;
    default: return 'Weigh in once a week. After a couple of weeks you will see your pace and an estimated finish date.';
  }
}

/** Progress page: current weight, goal bar, day/week/month chart, stats, recent entries. */
export function WeightCard({ goalProgress, onChanged }: { goalProgress: number | null; onChanged: () => void }) {
  const [view, setView] = useState<WeightView>('week');
  const [logging, setLogging] = useState(() => new URLSearchParams(location.search).get('log') === 'weight');
  const [showAll, setShowAll] = useState(false);
  const { data, reload } = useLoad(() => api.get<WeightHistory>(`/fit/weight?view=${view}`), [view]);
  const { run } = useAction();
  const t = data?.trend;
  const st = t ? STATUS[t.status] : null;
  const changed = () => { void reload(); onChanged(); };
  const remove = (day: string) => run(() => api.del(`/fit/weight/${day}`), 'Entry removed').then(changed);
  const good = (n: number | null) => n === null || n === 0 || !t?.target || t.start === null ? '' : (n < 0) === (t.target < t.start) ? 'text-lime' : 'text-warn';

  return (
    <section className="card-ink p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-ink-300 text-sm flex items-center gap-1.5"><Scale className="w-4 h-4" />Weight</p>
          <p className="font-display text-4xl font-bold text-white mt-1">{t?.current ?? '—'}<span className="text-lg text-ink-300"> kg</span></p>
          {t && t.change_total !== null && (
            <p className={`text-sm mt-1 ${t.change_total === 0 ? 'text-ink-300' : good(t.change_total)}`}>
              {t.change_total === 0 ? 'No change yet' : `${signed(t.change_total)} kg since start (${t.start} kg)`}</p>
          )}
        </div>
        <button className="btn btn-primary btn-sm shrink-0" onClick={() => setLogging(true)}>Log weight</button>
      </div>

      {t && (
        <div className={`mt-3 rounded-2xl px-3 py-2 text-sm flex items-start gap-2 ${t.due ? 'bg-lime/15 text-white' : 'bg-white/5 text-ink-300'}`}>
          <CalendarClock className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{t.due ? (t.last_day ? `Weekly weigh-in due — last one was ${t.days_since} days ago.` : 'Log your first weigh-in to start tracking.')
            : `Next weigh-in: ${fmtDate(t.next_due, false)}`}</span>
        </div>
      )}

      {t?.target !== null && t?.target !== undefined && (
        <div className="mt-4">
          <div className="flex justify-between text-xs text-ink-300 mb-1"><span>{t.start} kg</span><span>Goal {t.target} kg</span></div>
          <div className="h-2.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-lime rounded-full transition-all" style={{ width: `${goalProgress ?? 0}%` }} /></div>
          <p className="text-xs text-ink-300 mt-1">{goalProgress ?? 0}% of the way there{t.to_go ? ` · ${t.to_go} kg to go` : ''}</p>
        </div>
      )}

      {t && st && (
        <div className="mt-4 flex items-start gap-2">
          <span className={`badge shrink-0 ${st.tone}`}>{st.label}</span>
          <p className="text-sm text-ink-200 leading-snug">{coachLine(t)}</p>
        </div>
      )}

      <div className="mt-4 flex gap-1 rounded-full bg-white/5 p-1 w-fit">
        {(['day', 'week', 'month'] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${view === v ? 'bg-lime text-ink-900' : 'text-ink-300'}`}>
            {v === 'day' ? 'Days' : v === 'week' ? 'Weeks' : 'Months'}</button>
        ))}
      </div>
      {!data ? <div className="h-32 flex items-center justify-center"><Spinner className="w-5 h-5 text-ink-300" /></div>
        : data.view === view && data.points.length >= 2 ? <WeightChart points={data.points} target={t?.target ?? null} view={view} />
        : <p className="text-sm text-ink-300 py-8 text-center">{view === 'day' ? 'Log at least two weigh-ins to see your trend.' : `Needs weigh-ins in at least two different ${view}s.`}</p>}

      {t && t.entries >= 2 && (
        <div className="grid grid-cols-3 gap-2 mt-4">
          <Stat label="Last 7 days" value={t.change_7d} good={good(t.change_7d)} />
          <Stat label="Last 30 days" value={t.change_30d} good={good(t.change_30d)} />
          <Stat label="Per week" value={t.weekly_rate} good={good(t.weekly_rate)} />
        </div>
      )}

      {data && data.entries.length > 0 && (
        <div className="mt-4">
          <p className="text-xs text-ink-300 font-semibold mb-1">Weigh-ins</p>
          <ul className="divide-y divide-white/5">
            {data.entries.slice(0, showAll ? 30 : 5).map((e, i) => {
              const prev = data.entries[i + 1];
              const d = prev ? Math.round((e.weight_kg - prev.weight_kg) * 10) / 10 : null;
              return (
                <li key={e.day} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex-1 text-ink-300">{fmtDate(e.day)}</span>
                  {d !== null && d !== 0 && <span className={`text-xs flex items-center gap-0.5 ${good(d)}`}>{d < 0 ? <TrendingDown className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />}{signed(d)}</span>}
                  <span className="font-display font-bold text-white w-16 text-right">{e.weight_kg} kg</span>
                  <button className="icon-btn w-8 h-8 text-ink-400" aria-label={`Delete ${fmtDate(e.day)} entry`} onClick={() => remove(e.day)}><Trash2 className="w-4 h-4" /></button>
                </li>
              );
            })}
          </ul>
          {data.entries.length > 5 && <button className="text-xs text-lime font-semibold mt-1" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show less' : `Show all (${data.entries.length})`}</button>}
        </div>
      )}

      {logging && <WeightSheet current={t?.current ?? 70} onClose={() => setLogging(false)} onSaved={() => { setLogging(false); changed(); }} />}
    </section>
  );
}

const Stat = ({ label, value, good }: { label: string; value: number | null; good: string }) => (
  <div className="rounded-2xl bg-ink-800 border border-white/5 px-3 py-2">
    <p className="text-[10px] text-ink-300">{label}</p>
    <p className={`font-display font-bold text-lg leading-tight ${value ? good || 'text-white' : 'text-white'}`}>{value === null ? '—' : `${signed(value)} kg`}</p>
  </div>
);

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (day: string, view: WeightView) => view === 'month' ? `${MON[Number(day.slice(5, 7)) - 1]} ${day.slice(2, 4)}` : fmtDate(day, false);

function WeightChart({ points, target, view }: { points: { day: string; weight_kg: number; n: number }[]; target: number | null; view: WeightView }) {
  const [sel, setSel] = useState(points.length - 1);
  const W = 320, H = 130, padX = 30, padY = 10;
  const ys = points.map((p) => p.weight_kg).concat(target ? [target] : []);
  const min = Math.floor(Math.min(...ys) - 0.5), max = Math.ceil(Math.max(...ys) + 0.5);
  const x = (i: number) => padX + (i / Math.max(1, points.length - 1)) * (W - padX - 8);
  const y = (v: number) => padY + (1 - (v - min) / Math.max(1, max - min)) * (H - padY * 2);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.weight_kg).toFixed(1)}`).join(' ');
  const s = points[Math.min(sel, points.length - 1)];
  return (
    <div className="mt-3">
      <p className="text-xs text-ink-300 h-4">{view === 'week' ? `Week of ${label(s.day, view)}` : label(s.day, view)} · <b className="text-white">{s.weight_kg} kg</b>{s.n > 1 ? ` (avg of ${s.n})` : ''}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-1" role="img" aria-label={`Weight by ${view}, from ${points[0].weight_kg} to ${points[points.length - 1].weight_kg} kg`}>
        {[max, (min + max) / 2, min].map((v) => (
          <g key={v}><line x1={padX} x2={W - 8} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity=".08" />
            <text x={padX - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#9aa3ad">{Math.round(v * 10) / 10}</text></g>
        ))}
        {target && <line x1={padX} x2={W - 8} y1={y(target)} y2={y(target)} stroke="#C8F135" strokeOpacity=".55" strokeDasharray="4 4" />}
        <path d={`${d} L${x(points.length - 1)},${H - padY} L${x(0)},${H - padY} Z`} fill="#C8F135" fillOpacity=".08" />
        <path d={d} fill="none" stroke="#C8F135" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={p.day} onClick={() => setSel(i)} className="cursor-pointer">
            <circle cx={x(i)} cy={y(p.weight_kg)} r="10" fill="transparent" />
            <circle cx={x(i)} cy={y(p.weight_kg)} r={i === sel ? 4.5 : 2.5} fill="#C8F135" stroke={i === sel ? '#0b0d10' : 'none'} strokeWidth="1.5" />
          </g>
        ))}
      </svg>
      <div className="flex justify-between text-[10px] text-ink-300 pl-7"><span>{label(points[0].day, view)}</span>{target && <span className="text-lime/80">- - goal {target} kg</span>}<span>{label(points[points.length - 1].day, view)}</span></div>
    </div>
  );
}
