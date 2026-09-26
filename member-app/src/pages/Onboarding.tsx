import { useState } from 'react';
import { ArrowLeft, ArrowRight, Drumstick, Dumbbell, Egg, Flame, HeartPulse, Leaf, Scale, Sprout, TrendingDown, TrendingUp } from 'lucide-react';
import { api } from '../lib/api';
import { ACTIVITY_LABEL, GOAL_LABEL, type Activity, type FitProfile, type Goal } from '../lib/fit';
import { Spinner, useAction } from '../components/ui';

export interface RawProfile {
  birth_year: number | null; height_cm: number | null; weight_kg: number | null; target_weight_kg: number | null; goal: Goal | null;
  activity: Activity | null; workouts_per_week: number | null; diet_pref: string | null;
}

const GOALS: { key: Goal; icon: React.ReactNode; hint: string }[] = [
  { key: 'lose_weight', icon: <TrendingDown />, hint: 'Burn fat, feel lighter' },
  { key: 'build_muscle', icon: <Dumbbell />, hint: 'Get stronger, add lean muscle' },
  { key: 'gain_weight', icon: <TrendingUp />, hint: 'Healthy weight gain' },
  { key: 'get_fit', icon: <HeartPulse />, hint: 'Stamina, energy & health' },
  { key: 'maintain', icon: <Scale />, hint: 'Keep my current shape' },
];
const DIETS = [
  { key: 'veg', label: 'Vegetarian', icon: <Leaf /> }, { key: 'egg', label: 'Eggetarian', icon: <Egg /> },
  { key: 'nonveg', label: 'Non-veg', icon: <Drumstick /> }, { key: 'vegan', label: 'Vegan', icon: <Sprout /> },
];

export default function Onboarding({ initial, gender: initialGender, onDone, onSkip, editing }: {
  initial?: RawProfile | null; gender?: string | null; onDone: (p: FitProfile) => void; onSkip?: () => void; editing?: boolean;
}) {
  const year = new Date().getFullYear();
  const [step, setStep] = useState(editing ? 1 : 0);
  const [f, setF] = useState({
    age: initial?.birth_year ? String(year - initial.birth_year) : '', gender: initialGender ?? '',
    height: initial?.height_cm ? String(initial.height_cm) : '', weight: initial?.weight_kg ? String(initial.weight_kg) : '',
    target: initial?.target_weight_kg ? String(initial.target_weight_kg) : '', goal: (initial?.goal ?? '') as Goal | '',
    activity: (initial?.activity ?? 'moderate') as Activity, wpw: initial?.workouts_per_week ?? 4, diet: (initial?.diet_pref ?? '').split(',').filter(Boolean) as string[],
  });
  const [ftMode, setFtMode] = useState(false);
  const [ft, setFt] = useState({ ft: '', inch: '' });
  const [result, setResult] = useState<FitProfile | null>(null);
  const { busy, run } = useAction();
  const set = (k: keyof typeof f, v: unknown) => setF({ ...f, [k]: v });

  const heightCm = ftMode ? Math.round((Number(ft.ft) * 12 + Number(ft.inch || 0)) * 2.54) : Number(f.height);
  const valid = [
    true,
    Number(f.age) >= 12 && Number(f.age) <= 90 && !!f.gender,
    heightCm >= 120 && heightCm <= 230 && Number(f.weight) >= 30 && Number(f.weight) <= 250,
    !!f.goal && (!f.target || (Number(f.target) >= 30 && Number(f.target) <= 250)),
    !!f.activity,
  ];
  const suggestTarget = () => {
    if (!heightCm || !f.weight) return '';
    const lo = 18.5 * (heightCm / 100) ** 2, hi = 22.9 * (heightCm / 100) ** 2, w = Number(f.weight);
    if (f.goal === 'lose_weight') return String(Math.max(Math.round(hi), Math.round(w - 5)));
    if (f.goal === 'gain_weight' || f.goal === 'build_muscle') return String(Math.min(Math.round(w + 5), Math.round(Math.max(lo, w) + 8)));
    return '';
  };

  const submit = async () => {
    const r = await run(() => api.put<{ profile: FitProfile }>('/fit/profile', {
      age: Number(f.age), gender: f.gender, height_cm: heightCm, weight_kg: Number(f.weight), target_weight_kg: f.target ? Number(f.target) : null,
      goal: f.goal, activity: f.activity, workouts_per_week: f.wpw, diet_pref: f.diet,
    }));
    if (r) { setResult(r.profile); setStep(5); }
  };

  const Choice = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" onClick={onClick} className={`w-full text-left rounded-3xl border-2 p-4 transition active:scale-[.99]
      ${on ? 'border-lime bg-lime/10' : 'border-paper-line dark:border-ink-600 hover:border-ink-300'}`}>{children}</button>
  );

  return (
    <div className="min-h-dvh bg-paper dark:bg-ink-900 flex flex-col">
      <div className="max-w-lg w-full mx-auto px-5 pt-[max(env(safe-area-inset-top),1.25rem)] flex-1 flex flex-col">
        {step > 0 && step < 5 && (
          <div className="flex items-center gap-3 mb-6">
            <button className="icon-btn -ml-2" onClick={() => (step === 1 && editing ? onSkip?.() : setStep(step - 1))} aria-label="Back"><ArrowLeft className="w-5 h-5" /></button>
            <div className="flex-1 flex gap-1.5">{[1, 2, 3, 4].map((s) => <span key={s} className={`h-1.5 flex-1 rounded-full ${s <= step ? 'bg-lime' : 'bg-black/10 dark:bg-white/10'}`} />)}</div>
            {onSkip && !editing && <button className="text-sm muted" onClick={onSkip}>Skip</button>}
          </div>
        )}

        {step === 0 && (
          <div className="flex-1 flex flex-col justify-center text-center py-10">
            <div className="mx-auto w-20 h-20 rounded-3xl bg-lime text-ink-900 flex items-center justify-center mb-6"><Flame className="w-10 h-10" /></div>
            <h1 className="text-3xl font-bold">Let's build your plan</h1>
            <p className="muted mt-3">A few quick questions to calculate your BMI, daily calories and protein — so the diet and workout trackers work for <b>you</b>.</p>
            <button className="btn btn-primary btn-lg w-full mt-10" onClick={() => setStep(1)}>Start<ArrowRight className="w-5 h-5" /></button>
            {onSkip && <button className="btn btn-ghost w-full mt-2" onClick={onSkip}>Maybe later</button>}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold">About you</h2>
            <div className="grid grid-cols-3 gap-2">
              {[['male', 'Male', '♂'], ['female', 'Female', '♀'], ['other', 'Other', '⚧']].map(([k, l, s]) => (
                <Choice key={k} on={f.gender === k} onClick={() => set('gender', k)}><div className="text-center"><p className="text-2xl">{s}</p><p className="font-semibold text-sm mt-1">{l}</p></div></Choice>
              ))}
            </div>
            <label className="block"><span className="label">Age (years)</span>
              <input className="input text-2xl font-display font-bold h-14" inputMode="numeric" value={f.age} onChange={(e) => set('age', e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="25" /></label>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold">Height & weight</h2>
            <div>
              <div className="flex items-center justify-between"><span className="label">Height</span>
                <button type="button" className="text-xs font-semibold underline muted" onClick={() => setFtMode(!ftMode)}>{ftMode ? 'Use cm' : 'Use feet / inches'}</button></div>
              {ftMode ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="relative"><input className="input text-2xl font-display font-bold h-14 pr-10" inputMode="numeric" value={ft.ft} onChange={(e) => setFt({ ...ft, ft: e.target.value.replace(/\D/g, '').slice(0, 1) })} placeholder="5" /><span className="absolute right-4 top-1/2 -translate-y-1/2 muted">ft</span></div>
                  <div className="relative"><input className="input text-2xl font-display font-bold h-14 pr-10" inputMode="numeric" value={ft.inch} onChange={(e) => setFt({ ...ft, inch: e.target.value.replace(/\D/g, '').slice(0, 2) })} placeholder="8" /><span className="absolute right-4 top-1/2 -translate-y-1/2 muted">in</span></div>
                </div>
              ) : (
                <div className="relative"><input className="input text-2xl font-display font-bold h-14 pr-12" inputMode="decimal" value={f.height} onChange={(e) => set('height', e.target.value.replace(/[^\d.]/g, '').slice(0, 5))} placeholder="170" /><span className="absolute right-4 top-1/2 -translate-y-1/2 muted">cm</span></div>
              )}
              {ftMode && heightCm > 0 && <p className="text-xs muted mt-1">= {heightCm} cm</p>}
            </div>
            <label className="block"><span className="label">Current weight</span>
              <div className="relative"><input className="input text-2xl font-display font-bold h-14 pr-12" inputMode="decimal" value={f.weight} onChange={(e) => set('weight', e.target.value.replace(/[^\d.]/g, '').slice(0, 5))} placeholder="70" /><span className="absolute right-4 top-1/2 -translate-y-1/2 muted">kg</span></div></label>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold">What's your goal?</h2>
            <div className="space-y-2.5">
              {GOALS.map((g) => (
                <Choice key={g.key} on={f.goal === g.key} onClick={() => setF({ ...f, goal: g.key, target: f.target || '' })}>
                  <div className="flex items-center gap-3">
                    <span className={`w-11 h-11 rounded-2xl flex items-center justify-center [&>svg]:w-5 [&>svg]:h-5 ${f.goal === g.key ? 'bg-lime text-ink-900' : 'bg-black/5 dark:bg-white/5'}`}>{g.icon}</span>
                    <span><span className="block font-semibold">{GOAL_LABEL[g.key]}</span><span className="text-xs muted">{g.hint}</span></span>
                  </div>
                </Choice>
              ))}
            </div>
            {(f.goal === 'lose_weight' || f.goal === 'gain_weight' || f.goal === 'build_muscle') && (
              <label className="block pt-2"><span className="label">Target weight (optional)</span>
                <div className="relative"><input className="input font-display font-bold pr-12" inputMode="decimal" value={f.target} placeholder={suggestTarget()}
                  onChange={(e) => set('target', e.target.value.replace(/[^\d.]/g, '').slice(0, 5))} /><span className="absolute right-4 top-1/2 -translate-y-1/2 muted">kg</span></div>
                {suggestTarget() && !f.target && <button type="button" className="text-xs underline muted mt-1" onClick={() => set('target', suggestTarget())}>Use suggested {suggestTarget()} kg</button>}
              </label>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <h2 className="text-2xl font-bold">Your routine</h2>
            <div className="space-y-2">
              {(Object.keys(ACTIVITY_LABEL) as Activity[]).map((a) => (
                <Choice key={a} on={f.activity === a} onClick={() => set('activity', a)}>
                  <span className="block font-semibold text-sm">{ACTIVITY_LABEL[a][0]}</span><span className="text-xs muted">{ACTIVITY_LABEL[a][1]}</span>
                </Choice>
              ))}
            </div>
            <div>
              <span className="label">Workouts per week: <b className="text-inherit">{f.wpw}</b></span>
              <input type="range" min={0} max={7} value={f.wpw} onChange={(e) => set('wpw', Number(e.target.value))} className="w-full accent-lime" />
            </div>
            <div>
              <span className="label">Food preference <span className="font-normal">— pick all that apply</span></span>
              <div className="grid grid-cols-4 gap-2">
                {DIETS.map((d) => (
                  <Choice key={d.key} on={f.diet.includes(d.key)} onClick={() => set('diet', f.diet.includes(d.key) ? f.diet.filter((x) => x !== d.key) : [...f.diet, d.key])}>
                    <div className="text-center [&>svg]:w-5 [&>svg]:h-5 [&>svg]:mx-auto">{d.icon}<p className="text-[11px] font-semibold mt-1">{d.label}</p></div>
                  </Choice>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 5 && result && <Result p={result} onDone={() => onDone(result)} />}
      </div>

      {step > 0 && step < 5 && (
        <div className="max-w-lg w-full mx-auto px-5 py-4 safe-bottom">
          {step < 4
            ? <button className="btn btn-primary btn-lg w-full" disabled={!valid[step]} onClick={() => setStep(step + 1)}>Continue<ArrowRight className="w-5 h-5" /></button>
            : <button className="btn btn-primary btn-lg w-full" disabled={!valid.every(Boolean) || busy} onClick={submit}>{busy && <Spinner className="w-4 h-4" />}Calculate my plan</button>}
        </div>
      )}
    </div>
  );
}

export function BmiGauge({ bmi }: { bmi: number }) {
  // 15 → 35 scale with Asian-Indian bands
  const pos = Math.max(0, Math.min(100, ((bmi - 15) / 20) * 100));
  const bands = [[15, 18.5, '#4DA3FF'], [18.5, 23, '#C8F135'], [23, 25, '#F5A524'], [25, 35, '#F0524F']] as const;
  return (
    <div>
      <div className="relative h-3 rounded-full overflow-hidden flex">
        {bands.map(([a, b, c]) => <div key={a} style={{ width: `${((b - a) / 20) * 100}%`, background: c }} />)}
      </div>
      <div className="relative h-4"><div className="absolute -top-1 w-1 h-5 rounded-full bg-ink-900 dark:bg-white shadow" style={{ left: `calc(${pos}% - 2px)` }} /></div>
      <div className="flex justify-between text-[10px] muted"><span>18.5</span><span>23</span><span>25</span><span>35</span></div>
    </div>
  );
}

function Result({ p, onDone }: { p: FitProfile; onDone: () => void }) {
  const tone = { under: 'text-info', normal: 'text-lime-700 dark:text-lime', over: 'text-warn', obese: 'text-bad' }[p.bmi_category.key];
  return (
    <div className="py-4 space-y-4">
      <h2 className="text-2xl font-bold">Your plan is ready 🎯</h2>
      <div className="card card-pad">
        <div className="flex items-end justify-between mb-3">
          <div><p className="text-xs muted font-semibold">Your BMI</p><p className="font-display text-5xl font-bold leading-none mt-1">{p.bmi}</p></div>
          <p className={`font-display font-bold text-lg ${tone}`}>{p.bmi_category.label}</p>
        </div>
        <BmiGauge bmi={p.bmi} />
        <p className="text-sm muted mt-3">Healthy weight for your height: <b className="text-inherit">{p.healthy_range[0]}–{p.healthy_range[1]} kg</b> (Asian-Indian BMI guideline).</p>
      </div>
      <div className="card-ink p-5">
        <p className="text-ink-300 text-sm">Daily target · {GOAL_LABEL[p.goal]}</p>
        <p className="font-display text-4xl font-bold text-lime mt-1">{p.targets.kcal} <span className="text-lg text-white">kcal</span></p>
        <div className="grid grid-cols-4 gap-2 mt-4 text-center">
          {[['Protein', p.targets.protein_g, 'g'], ['Carbs', p.targets.carbs_g, 'g'], ['Fat', p.targets.fat_g, 'g'], ['Water', p.targets.water_ml ? (p.targets.water_ml / 1000).toFixed(1) : '–', 'L']].map(([k, v, u]) => (
            <div key={k as string} className="rounded-2xl bg-white/5 py-2.5"><p className="font-display font-bold text-white text-lg leading-none">{v}<span className="text-xs text-ink-300">{u}</span></p><p className="text-[10px] text-ink-300 mt-1">{k}</p></div>
          ))}
        </div>
        {p.tdee && <p className="text-xs text-ink-400 mt-4">Your body uses about {p.tdee} kcal/day (BMR {p.bmr} × activity). {p.goal === 'lose_weight' ? 'A ~500 kcal deficit ≈ 0.5 kg loss per week.' : p.goal === 'build_muscle' ? 'A small surplus + high protein builds lean muscle.' : p.goal === 'gain_weight' ? 'A steady surplus for healthy gain.' : ''}</p>}
      </div>
      <button className="btn btn-primary btn-lg w-full" onClick={onDone}>Let's go<ArrowRight className="w-5 h-5" /></button>
      <p className="text-[11px] muted text-center">Estimates for healthy adults — not medical advice. Check with a doctor if you have a health condition.</p>
    </div>
  );
}
