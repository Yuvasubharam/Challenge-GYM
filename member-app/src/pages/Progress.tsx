import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarCheck2, Flame, Scale, Target, Trophy } from 'lucide-react';
import { api } from '../lib/api';
import { date as fmtDate } from '../lib/format';
import { GOAL_LABEL } from '../lib/fit';
import { useFit } from '../lib/fitctx';
import { ErrorBox, PageLoader, Sheet, Spinner, useAction, useLoad } from '../components/ui';
import { Stepper } from '../components/fit-ui';
import { BmiGauge } from './Onboarding';

interface Summary {
  series: { day: string; kcal_in: number; kcal_out: number; workouts: number; minutes: number; water_ml: number; gym_visit: boolean; protein: number }[];
  weights: { day: string; weight_kg: number }[];
  streak: number; this_week: { workouts: number; kcal_out: number }; avg_kcal_in: number | null;
  records: { exercise_id: string; name: string; best: number; day: string }[];
}

export default function Progress() {
  const { fit, reload: reloadFit, edit } = useFit();
  const { data: s, error, reload } = useLoad(() => api.get<Summary>('/fit/summary?days=30'));
  const [logW, setLogW] = useState(false);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!s) return <PageLoader />;
  const p = fit?.profile;

  if (!p) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl sm:text-3xl font-bold pt-1">Progress</h1>
        <div className="card card-pad text-center py-10">
          <Target className="w-10 h-10 mx-auto text-lime-700 dark:text-lime mb-3" />
          <p className="font-semibold">Set your goal to track progress</p>
          <p className="text-sm muted mt-1 mb-4">Height, weight and goal give you BMI, calorie targets and a progress bar.</p>
          <button className="btn btn-primary" onClick={edit}>Set up now</button>
        </div>
      </div>
    );
  }

  const change = Math.round((p.weight_kg - p.start_weight_kg) * 10) / 10;
  const visits = s.series.filter((x) => x.gym_visit).length;
  const target = p.targets.kcal ?? 0;
  const maxK = Math.max(target, ...s.series.map((x) => Math.max(x.kcal_in, x.kcal_out)), 1);
  const tone = { under: 'text-info', normal: 'text-lime-700 dark:text-lime', over: 'text-warn', obese: 'text-bad' }[p.bmi_category.key];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl sm:text-3xl font-bold pt-1">Progress</h1>

      <section className="card-ink p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-ink-300 text-sm flex items-center gap-1.5"><Scale className="w-4 h-4" />Weight · {GOAL_LABEL[p.goal]}</p>
            <p className="font-display text-4xl font-bold text-white mt-1">{p.weight_kg}<span className="text-lg text-ink-300"> kg</span></p>
            <p className={`text-sm mt-1 ${change === 0 ? 'text-ink-300' : (change < 0) === (p.goal === 'lose_weight') ? 'text-lime' : 'text-warn'}`}>
              {change === 0 ? 'No change yet' : `${change > 0 ? '+' : ''}${change} kg since start (${p.start_weight_kg} kg)`}</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setLogW(true)}>Log weight</button>
        </div>
        {p.target_weight_kg && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-ink-300 mb-1"><span>{p.start_weight_kg} kg</span><span>Goal {p.target_weight_kg} kg</span></div>
            <div className="h-2.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-lime rounded-full transition-all" style={{ width: `${p.goal_progress ?? 0}%` }} /></div>
            <p className="text-xs text-ink-300 mt-1">{p.goal_progress ?? 0}% of the way there</p>
          </div>
        )}
        {s.weights.length >= 2 && <WeightChart points={s.weights} target={p.target_weight_kg} />}
      </section>

      <section className="card card-pad">
        <div className="flex items-end justify-between mb-3">
          <div><p className="text-xs muted font-semibold">BMI</p><p className="font-display text-4xl font-bold leading-none mt-1">{p.bmi}</p></div>
          <p className={`font-display font-bold ${tone}`}>{p.bmi_category.label}</p>
        </div>
        <BmiGauge bmi={p.bmi} />
        <p className="text-xs muted mt-2">Healthy for {p.height_cm} cm: {p.healthy_range[0]}–{p.healthy_range[1]} kg</p>
      </section>

      <section className="grid grid-cols-3 gap-3">
        <Tile icon={<Flame className="w-4 h-4" />} label="Active streak" value={`${s.streak}d`} accent />
        <Tile icon={<Trophy className="w-4 h-4" />} label="Workouts (7d)" value={`${s.this_week.workouts}/${p.workouts_per_week ?? 4}`} />
        <Link to="/visits" className="block"><Tile icon={<CalendarCheck2 className="w-4 h-4" />} label="Gym visits (30d)" value={String(visits)} /></Link>
      </section>

      <section className="card card-pad">
        <div className="flex items-center justify-between mb-1"><p className="font-semibold">Calories · last 30 days</p>
          {s.avg_kcal_in && <p className="text-xs muted">avg eaten {s.avg_kcal_in} kcal</p>}</div>
        <div className="flex gap-3 text-[11px] muted mb-3">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-lime" />Eaten</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-warn" />Burned</span>
          {target > 0 && <span className="flex items-center gap-1"><span className="w-3 border-t-2 border-dashed border-ink-400" />Target {target}</span>}
        </div>
        <div className="relative h-40 flex items-end gap-[3px]">
          {target > 0 && <div className="absolute inset-x-0 border-t-2 border-dashed border-ink-400/60" style={{ bottom: `${(target / maxK) * 100}%` }} />}
          {s.series.map((x) => (
            <div key={x.day} className="flex-1 h-full flex items-end gap-px" title={`${fmtDate(x.day, false)}: ${Math.round(x.kcal_in)} in / ${Math.round(x.kcal_out)} out`}>
              <div className="flex-1 rounded-t bg-lime" style={{ height: `${(x.kcal_in / maxK) * 100}%` }} />
              <div className="flex-1 rounded-t bg-warn" style={{ height: `${(x.kcal_out / maxK) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] muted mt-1"><span>{fmtDate(s.series[0].day, false)}</span><span>Today</span></div>
      </section>

      <section className="card overflow-hidden">
        <p className="font-semibold px-4 pt-4 pb-2 flex items-center gap-2"><Trophy className="w-4 h-4 text-warn" />Personal records</p>
        {s.records.length === 0 ? <p className="text-sm muted px-4 pb-5">Log strength sets in Train to see your best lifts here.</p> : (
          <ul>{s.records.map((r) => (
            <li key={r.exercise_id} className="flex items-center gap-3 px-4 py-2.5 border-t border-paper-line dark:border-ink-700">
              <span className="flex-1 truncate text-sm font-medium">{r.name}</span>
              <span className="text-xs muted">{fmtDate(r.day, false)}</span>
              <span className="font-display font-bold">{r.best} kg</span>
            </li>
          ))}</ul>
        )}
        {s.records.length > 0 && <p className="text-[11px] muted px-4 pb-3">Estimated one-rep max (Epley formula) from your best set.</p>}
      </section>

      <button onClick={edit} className="w-full card card-pad flex items-center gap-3 text-left">
        <Target className="w-5 h-5" /><span className="flex-1"><span className="block font-semibold text-sm">Change goal or targets</span><span className="text-xs muted">{p.targets.kcal} kcal · {p.targets.protein_g} g protein</span></span><ArrowRight className="w-4 h-4 muted" />
      </button>

      {logW && <WeightSheet current={p.weight_kg} onClose={() => setLogW(false)} onSaved={() => { setLogW(false); void reload(); void reloadFit(); }} />}
    </div>
  );
}

const Tile = ({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) => (
  <div className={`rounded-3xl p-4 h-full ${accent ? 'bg-lime text-ink-900' : 'card'}`}>
    <div className={`${accent ? 'text-ink-700' : 'muted'}`}>{icon}</div>
    <p className="font-display text-2xl font-bold mt-2 leading-none">{value}</p>
    <p className={`text-[11px] mt-1 ${accent ? 'text-ink-700' : 'muted'}`}>{label}</p>
  </div>
);

function WeightChart({ points, target }: { points: { day: string; weight_kg: number }[]; target: number | null }) {
  const W = 320, H = 110, pad = 8;
  const ys = points.map((p) => p.weight_kg).concat(target ? [target] : []);
  const min = Math.min(...ys) - 1, max = Math.max(...ys) + 1;
  const x = (i: number) => pad + (i / Math.max(1, points.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (H - pad * 2);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.weight_kg).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-4" role="img" aria-label="Weight trend">
      {target && <line x1={pad} x2={W - pad} y1={y(target)} y2={y(target)} stroke="#C8F135" strokeOpacity=".5" strokeDasharray="4 4" />}
      <path d={`${d} L${x(points.length - 1)},${H - pad} L${x(0)},${H - pad} Z`} fill="#C8F135" fillOpacity=".08" />
      <path d={d} fill="none" stroke="#C8F135" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => <circle key={p.day} cx={x(i)} cy={y(p.weight_kg)} r={i === points.length - 1 ? 4 : 2.5} fill="#C8F135" />)}
    </svg>
  );
}

function WeightSheet({ current, onClose, onSaved }: { current: number; onClose: () => void; onSaved: () => void }) {
  const [kg, setKg] = useState(current);
  const { busy, run } = useAction();
  return (
    <Sheet open onClose={onClose} title="Log today's weight"
      footer={<button className="btn btn-primary btn-lg w-full" disabled={busy} onClick={() => run(() => api.post('/fit/weight', { weight_kg: kg }), 'Weight saved — BMI & targets updated').then((r) => r && onSaved())}>{busy && <Spinner className="w-4 h-4" />}Save {kg} kg</button>}>
      <div className="flex justify-center py-6"><Stepper value={kg} onChange={setKg} step={0.1} min={30} suffix="kg" /></div>
      <p className="text-xs muted text-center">Weigh yourself in the morning, before breakfast, for the most consistent trend.</p>
    </Sheet>
  );
}
