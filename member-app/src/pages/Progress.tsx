import { Link } from 'react-router-dom';
import { ArrowRight, CalendarCheck2, Flame, Target, Trophy } from 'lucide-react';
import { api } from '../lib/api';
import { date as fmtDate } from '../lib/format';
import { GOAL_LABEL } from '../lib/fit';
import { useFit } from '../lib/fitctx';
import { ErrorBox, PageLoader, useLoad } from '../components/ui';
import { WeightCard } from '../components/weight';
import { BmiGauge } from './Onboarding';

interface Summary {
  series: { day: string; kcal_in: number; kcal_out: number; workouts: number; minutes: number; water_ml: number; gym_visit: boolean; protein: number }[];
  streak: number; this_week: { workouts: number; kcal_out: number }; avg_kcal_in: number | null;
  records: { exercise_id: string; name: string; best: number; day: string }[];
}

export default function Progress() {
  const { fit, reload: reloadFit, edit } = useFit();
  const { data: s, error, reload } = useLoad(() => api.get<Summary>('/fit/summary?days=30'));
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

  const visits = s.series.filter((x) => x.gym_visit).length;
  const target = p.targets.kcal ?? 0;
  const maxK = Math.max(target, ...s.series.map((x) => Math.max(x.kcal_in, x.kcal_out)), 1);
  const tone = { under: 'text-info', normal: 'text-lime-700 dark:text-lime', over: 'text-warn', obese: 'text-bad' }[p.bmi_category.key];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl sm:text-3xl font-bold pt-1">Progress</h1>

      <p className="text-sm muted -mt-2 flex items-center gap-1.5"><Target className="w-4 h-4" />Goal: {GOAL_LABEL[p.goal]}{p.target_weight_kg ? ` · ${p.target_weight_kg} kg` : ''}</p>
      <WeightCard goalProgress={p.goal_progress} onChanged={() => { void reload(); void reloadFit(); }} />

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

