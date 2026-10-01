import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Dumbbell, Moon, Plus, RefreshCw, Search, Sparkles, Trash2, Utensils, Wand2 } from 'lucide-react';
import { api } from '../lib/api';
import { todayLocal } from '../lib/format';
import { MEALS, cap, foodImg, vegFilterFor, type Food, type Meal } from '../lib/fit';
import { useFit } from '../lib/fitctx';
import { ErrorBox, Field, PageLoader, Sheet, Spinner, useAction, useToast } from '../components/ui';
import { Credits, ExercisePhoto, MacroBar, Stepper } from '../components/fit-ui';

type Kind = 'diet' | 'workout';
interface Macros { kcal: number; protein: number; carbs: number; fat: number }
interface Item {
  id: number; day: string; slot: string; slot_label?: string; pos: number; name: string; done: boolean;
  food_id: number | null; grams: number | null; kcal: number | null; protein: number | null; carbs: number | null; fat: number | null;
  serving_g?: number | null; serving_label?: string | null; veg?: string | null; food_image?: string | null;
  exercise_id: string | null; sets: number | null; reps: string | null; rest_s: number | null; minutes: number | null; images: string[]; target?: string | null; equipment?: string | null;
}
interface PlanDay { day: string; title: string | null; type: string | null; tip: string | null; rest: boolean; items: Item[]; done: number; planned?: Macros; eaten?: Macros }
interface PlanRes {
  plan: { id: number; kind: Kind; span: string; start_day: string; days: number; model: string | null; created_at: string; note: string | null; request: Record<string, unknown> } | null;
  days: PlanDay[]; builds_left?: number;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dow = (d: string) => DOW[new Date(d + 'T00:00:00Z').getUTCDay()];
const modelName = (m: string | null) => !m ? '' : m === 'rules' ? 'coach rules' : m.split(', ').map((x) =>
  x.includes('qwen') ? 'Qwen3' : x.includes('granite') ? 'Granite 4' : x.includes('glm') ? 'GLM-5.3' : x.split('/').pop()).join(' + ');

export default function Coach() {
  const [params, setParams] = useSearchParams();
  const kind: Kind = params.get('tab') === 'workout' ? 'workout' : 'diet';
  const setKind = (k: Kind) => { const p = new URLSearchParams(params); if (k === 'diet') p.delete('tab'); else p.set('tab', k); setParams(p, { replace: true }); };
  const [res, setRes] = useState<PlanRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [rebuild, setRebuild] = useState(false);

  const load = () => { setError(null); return api.get<PlanRes>(`/coach/${kind}`).then(setRes).catch((e) => setError((e as Error).message)); };
  useEffect(() => { setRes(null); setRebuild(false); void load(); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 pt-1">
        <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2"><Sparkles className="w-6 h-6 text-lime-700 dark:text-lime" />AI Coach</h1>
        <div className="flex rounded-full bg-black/5 dark:bg-white/5 p-1">
          {([['diet', 'Diet', <Utensils key="d" className="w-4 h-4" />], ['workout', 'Workout', <Dumbbell key="w" className="w-4 h-4" />]] as const).map(([k, l, icon]) => (
            <button key={k} onClick={() => setKind(k)}
              className={`flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-semibold transition ${kind === k ? 'bg-ink-900 text-white dark:bg-lime dark:text-ink-900' : 'muted'}`}>{icon}{l}</button>
          ))}
        </div>
      </div>
      {error ? <ErrorBox error={error} onRetry={load} /> : !res ? <PageLoader /> : building ? <Building kind={kind} /> : (!res.plan || rebuild) ? (
        <Builder kind={kind} res={res} onCancel={res.plan ? () => setRebuild(false) : undefined}
          onBuilding={setBuilding} onBuilt={(r) => { setRes(r); setRebuild(false); }} />
      ) : (
        <PlanView kind={kind} res={res} setRes={setRes} onRebuild={() => setRebuild(true)} />
      )}
      <Credits />
    </div>
  );
}

function Building({ kind }: { kind: Kind }) {
  return (
    <div className="card-ink p-8 text-center">
      <div className="mx-auto w-16 h-16 rounded-3xl bg-lime/20 text-lime flex items-center justify-center mb-4"><Wand2 className="w-8 h-8 animate-pulse" /></div>
      <p className="font-display text-xl font-bold text-white">Your coach is planning…</p>
      <p className="text-sm text-ink-300 mt-1">{kind === 'diet' ? 'Picking meals for your calories, protein and food preference, then checking the numbers.' : 'Balancing every muscle group and putting exercises in the right order for your goal.'}</p>
      <div className="mt-5 flex justify-center"><Spinner className="w-6 h-6 text-lime" /></div>
    </div>
  );
}

// ── Builder ─────────────────────────────────────────────────────────────
const FOCUS: [string, string][] = [['full', 'Full body'], ['push', 'Push'], ['pull', 'Pull'], ['legs', 'Legs'], ['upper', 'Upper'], ['lower', 'Lower'], ['cardio_core', 'Cardio & core']];

function Builder({ kind, res, onCancel, onBuilding, onBuilt }: { kind: Kind; res: PlanRes; onCancel?: () => void; onBuilding: (b: boolean) => void; onBuilt: (r: PlanRes) => void }) {
  const { fit, edit } = useFit();
  const toast = useToast();
  const req = res.plan?.request ?? {};
  const [span, setSpan] = useState<string>(String(req.span ?? (kind === 'diet' ? 'day' : 'week')));
  const [start, setStart] = useState<string>(String(req.start ?? 'today'));
  const [focus, setFocus] = useState<string>(String(req.focus ?? 'full'));
  const [trainDays, setTrainDays] = useState<number>(Number(req.train_days ?? fit?.profile?.workouts_per_week ?? 4) || 4);
  const [notes, setNotes] = useState<string>(String(req.notes ?? ''));

  if (!fit?.onboarded) {
    return (
      <div className="card card-pad text-sm flex items-center gap-3">
        <span className="flex-1">Set up your fitness profile first — the coach plans around your goal, weight and calorie target.</span>
        <button className="btn btn-primary btn-sm" onClick={edit}>Set up</button>
      </div>
    );
  }
  const spans: [string, string][] = kind === 'diet' ? [['day', 'One day'], ['week', 'Full week']] : [['day', 'One day'], ['3days', '3 days'], ['week', 'Full week']];
  const build = async () => {
    onBuilding(true);
    try {
      const body = kind === 'diet' ? { span, start, notes } : { span, start, focus, train_days: trainDays, notes };
      onBuilt(await api.post<PlanRes>(`/coach/${kind}`, body));
      toast('ok', kind === 'diet' ? 'Your diet plan is ready' : 'Your workout plan is ready');
    } catch (e) { toast('error', (e as Error).message); }
    finally { onBuilding(false); }
  };
  const t = fit.profile?.targets;

  return (
    <section className="card card-pad space-y-5">
      <div>
        <p className="font-semibold text-lg">{kind === 'diet' ? 'Build my diet plan' : 'Build my workout plan'}</p>
        <p className="text-sm muted mt-0.5">{kind === 'diet'
          ? `Indian home-style meals for ${t?.kcal ?? '–'} kcal and ${t?.protein_g ?? '–'} g protein a day, matched to your food preference. Tick items off as you eat them.`
          : 'A balanced plan for your goal: warm-up, big lifts first, then isolation, core, cardio and a cool-down stretch.'}</p>
      </div>
      <Choice label="Plan for" value={span} onChange={setSpan} options={spans} />
      {kind === 'workout' && span === 'day' && <Choice label="Focus" value={focus} onChange={setFocus} options={FOCUS} />}
      {kind === 'workout' && span === 'week' && (
        <div className="flex items-center justify-between gap-3">
          <div><p className="label !mb-0">Training days this week</p><p className="text-[11px] muted">The rest are recovery days</p></div>
          <Stepper value={trainDays} onChange={(v) => setTrainDays(Math.max(2, Math.min(6, Math.round(v))))} step={1} min={2} suffix="days" />
        </div>
      )}
      <Choice label="Starting" value={start} onChange={setStart} options={[['today', 'Today'], ['tomorrow', 'Tomorrow']]} />
      <Field label="Anything the coach should know? (optional)">
        <textarea className="input min-h-[76px] py-3" maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder={kind === 'diet' ? 'e.g. South Indian breakfast, no mushrooms, budget-friendly' : 'e.g. knee pain, only dumbbells, keep it under 45 minutes'} />
      </Field>
      <div className="flex gap-2">
        {onCancel && <button className="btn btn-outline" onClick={onCancel}>Cancel</button>}
        <button className="btn btn-primary btn-lg flex-1" onClick={build}><Sparkles className="w-4 h-4" />{res.plan ? 'Build a new plan' : 'Build my plan'}</button>
      </div>
      {res.plan && <p className="text-[11px] muted">This replaces your current {kind} plan. Items you already ticked stay in your diary.</p>}
      {res.builds_left !== undefined && res.builds_left <= 3 && <p className="text-[11px] muted">{res.builds_left} AI builds left today.</p>}
    </section>
  );
}

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div>
      <p className="label">{label}</p>
      <div className="flex flex-wrap gap-2">{options.map(([k, l]) => <button key={k} className={`chip ${value === k ? 'chip-on' : ''}`} onClick={() => onChange(k)}>{l}</button>)}</div>
    </div>
  );
}

// ── Plan ────────────────────────────────────────────────────────────────
function PlanView({ kind, res, setRes, onRebuild }: { kind: Kind; res: PlanRes; setRes: (r: PlanRes) => void; onRebuild: () => void }) {
  const today = todayLocal();
  const [day, setDay] = useState(() => res.days.find((d) => d.day === today)?.day ?? res.days[0]?.day);
  const { run } = useAction();
  const plan = res.plan!;
  const d = res.days.find((x) => x.day === day) ?? res.days[0];
  const clear = () => run(() => api.del(`/coach/${kind}`), 'Plan cleared').then((r) => r && setRes({ plan: null, days: [], builds_left: res.builds_left }));

  return (
    <>
      <section className="card card-pad">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold">{plan.days === 1 ? `${kind === 'diet' ? 'Diet' : 'Workout'} plan for ${plan.start_day === today ? 'today' : dow(plan.start_day)}` : `${plan.days}-day ${kind} plan`}</p>
            {plan.note && <p className="text-sm muted mt-1 leading-relaxed">{plan.note}</p>}
            <p className="text-[11px] muted mt-2 flex items-center gap-1"><Sparkles className="w-3 h-3" />Built by {modelName(plan.model)} · checked against your targets</p>
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button className="btn btn-outline btn-sm" onClick={onRebuild}><RefreshCw className="w-3.5 h-3.5" />New plan</button>
          <button className="btn btn-ghost btn-sm muted" onClick={clear}><Trash2 className="w-3.5 h-3.5" />Clear</button>
        </div>
      </section>

      {res.days.length > 1 && (
        <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
          {res.days.map((x) => {
            const on = x.day === d.day;
            const all = x.items.length > 0 && x.done === x.items.length;
            return (
              <button key={x.day} onClick={() => setDay(x.day)} className={`min-w-0 rounded-2xl py-2 flex flex-col items-center transition ${on ? 'bg-lime text-ink-900' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}>
                <span className={`text-[10px] font-semibold ${on ? 'text-ink-700' : 'muted'}`}>{x.day === today ? 'Today' : dow(x.day)}</span>
                <span className="font-display font-bold text-lg leading-tight">{Number(x.day.slice(8))}</span>
                <span className={`mt-0.5 w-1.5 h-1.5 rounded-full ${all ? (on ? 'bg-ink-900' : 'bg-lime') : x.rest ? 'bg-transparent' : x.done ? 'bg-warn' : 'bg-black/10 dark:bg-white/15'}`} />
              </button>
            );
          })}
        </div>
      )}

      {d && (kind === 'diet' ? <DietDay d={d} setRes={setRes} /> : <WorkoutDay d={d} setRes={setRes} />)}
    </>
  );
}

/** Round tick button — logs the item to the diary (or removes that log entry). */
function Tick({ item, future, onToggle }: { item: Item; future: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} disabled={future} aria-pressed={item.done} aria-label={item.done ? `Mark ${item.name} as not done` : `Mark ${item.name} as done`}
      title={future ? 'You can tick this off on the day' : undefined}
      className={`w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 transition ${item.done ? 'bg-lime border-lime text-ink-900' : 'border-paper-line dark:border-ink-500 hover:border-lime'} disabled:opacity-40`}>
      {item.done && <Check className="w-4 h-4" strokeWidth={3} />}
    </button>
  );
}

function useToggle(setRes: (r: PlanRes) => void, kind: Kind) {
  const { run } = useAction();
  return (item: Item, reload = true) => run(() => api.post(`/coach/items/${item.id}/done`, { done: !item.done }),
    item.done ? undefined : kind === 'diet' ? `Logged ${item.name} to your diary` : `Logged ${item.name} to your workouts`)
    .then(async (r) => { if (r && reload) setRes(await api.get<PlanRes>(`/coach/${kind}`)); });
}

function DietDay({ d, setRes }: { d: PlanDay; setRes: (r: PlanRes) => void }) {
  const { fit } = useFit();
  const toggle = useToggle(setRes, 'diet');
  const { run } = useAction();
  const [editing, setEditing] = useState<Item | null>(null);
  const [adding, setAdding] = useState<Meal | null>(null);
  const future = d.day > todayLocal();
  const t = fit?.profile?.targets;
  const p = d.planned!, e = d.eaten!;

  return (
    <>
      <section className="card-ink p-5">
        <div className="flex items-end justify-between gap-3">
          <div><p className="text-xs text-ink-300">{future ? 'Planned' : 'Eaten so far'}</p>
            <p className="font-display text-3xl font-bold text-white leading-none mt-1">{Math.round(future ? p.kcal : e.kcal)}<span className="text-base text-ink-300"> / {Math.round(p.kcal)} kcal</span></p></div>
          <p className="text-sm text-lime font-semibold">{d.done}/{d.items.length} ticked</p>
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4 [&_.muted]:text-ink-300 text-white">
          <MacroBar label="Protein" value={future ? p.protein : e.protein} target={t?.protein_g ?? Math.round(p.protein)} color="#C8F135" />
          <MacroBar label="Carbs" value={future ? p.carbs : e.carbs} target={t?.carbs_g ?? Math.round(p.carbs)} color="#4DA3FF" />
          <MacroBar label="Fat" value={future ? p.fat : e.fat} target={t?.fat_g ?? Math.round(p.fat)} color="#F5A524" />
        </div>
        <p className="text-[11px] text-ink-400 mt-3">Plan totals: {Math.round(p.protein)} g protein · {Math.round(p.carbs)} g carbs · {Math.round(p.fat)} g fat{t?.kcal ? ` · your target ${t.kcal} kcal` : ''}</p>
      </section>
      {d.tip && <p className="text-sm rounded-2xl bg-lime/15 px-4 py-3">💡 {d.tip}</p>}

      {MEALS.map((m) => {
        const items = d.items.filter((i) => i.slot === m.key);
        const kcal = items.reduce((s, i) => s + (i.kcal ?? 0), 0);
        return (
          <section key={m.key} className="card overflow-hidden">
            <div className="flex items-center gap-3 px-4 pt-4 pb-2">
              <span className="text-2xl">{m.emoji}</span>
              <div className="flex-1"><p className="font-semibold">{m.label}</p><p className="text-xs muted">{Math.round(kcal)} kcal</p></div>
              <button className="btn btn-outline btn-sm" onClick={() => setAdding(m.key)}><Plus className="w-4 h-4" />Add</button>
            </div>
            <ul className="pb-1">
              {items.map((it) => (
                <li key={it.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-paper-line dark:border-ink-700">
                  <Tick item={it} future={future} onToggle={() => toggle(it)} />
                  {it.food_image && <img src={foodImg(it.food_image, true)!} alt="" loading="lazy" width={40} height={30} className="w-10 h-[30px] rounded-lg object-cover shrink-0" />}
                  <button className="flex-1 min-w-0 text-left" onClick={() => setEditing(it)}>
                    <p className={`text-sm font-medium truncate ${it.done ? 'line-through muted' : ''}`}>{it.name}</p>
                    <p className="text-xs muted">{amountLabel(it)} · P {Math.round(it.protein ?? 0)} g</p>
                  </button>
                  <p className="font-display font-bold text-sm">{Math.round(it.kcal ?? 0)}</p>
                </li>
              ))}
              {!items.length && <li className="px-4 pb-3 text-xs muted">Nothing planned — tap Add.</li>}
            </ul>
          </section>
        );
      })}
      {future && <p className="text-center text-xs muted">You can tick these off on {dow(d.day)} — ticking logs the food to your diary.</p>}

      {editing && <AmountEdit item={editing} onClose={() => setEditing(null)}
        onSave={(g) => run(() => api.patch<PlanRes>(`/coach/items/${editing.id}`, { grams: g }), 'Amount updated').then((r) => { if (r) { setRes(r); setEditing(null); } })}
        onRemove={() => run(() => api.del<PlanRes>(`/coach/items/${editing.id}`), 'Removed from plan').then((r) => { if (r) { setRes(r); setEditing(null); } })} />}
      {adding && <AddFood day={d.day} meal={adding} onClose={() => setAdding(null)} onAdded={(r) => { setRes(r); setAdding(null); }} />}
    </>
  );
}

function amountLabel(it: { grams: number | null; serving_g?: number | null; serving_label?: string | null }) {
  const g = Math.round(it.grams ?? 0);
  if (!it.serving_g || !it.serving_label || /^\d+(\.\d+)?\s*(g|ml)$/i.test(it.serving_label)) return `${g} g`;
  const n = Math.round(((it.grams ?? 0) / it.serving_g) * 10) / 10;
  const unit = it.serving_label.replace(/\s*\(.*\)\s*$/, '').replace(/^\d+(\.\d+)?\s*/, '');
  return `${n} × ${unit} (${g} g)`;
}

function AmountEdit({ item, onClose, onSave, onRemove }: { item: Item; onClose: () => void; onSave: (g: number) => void; onRemove: () => void }) {
  const [g, setG] = useState(Math.round(item.grams ?? 100));
  const k = item.grams ? g / item.grams : 1;
  return (
    <Sheet open onClose={onClose} title={item.name}
      footer={<div className="flex gap-2"><button className="btn btn-outline" onClick={onRemove}><Trash2 className="w-4 h-4" />Remove</button>
        <button className="btn btn-primary btn-lg flex-1" disabled={!(g > 0)} onClick={() => onSave(g)}>Save · {Math.round((item.kcal ?? 0) * k)} kcal</button></div>}>
      <div className="flex items-center justify-between gap-3 mb-3"><span className="text-sm">Amount</span>
        <Stepper value={g} onChange={setG} step={item.serving_g && item.serving_g < 100 ? item.serving_g : 10} min={5} suffix="g" /></div>
      <p className="text-xs muted">{amountLabel({ ...item, grams: g })} · P {Math.round((item.protein ?? 0) * k)} g · C {Math.round((item.carbs ?? 0) * k)} g · F {Math.round((item.fat ?? 0) * k)} g</p>
      {item.done && <p className="text-xs muted mt-2">Already ticked — your diary entry updates too.</p>}
    </Sheet>
  );
}

function AddFood({ day, meal, onClose, onAdded }: { day: string; meal: Meal; onClose: () => void; onAdded: (r: PlanRes) => void }) {
  const { fit } = useFit();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [foods, setFoods] = useState<Food[] | null>(null);
  const [pick, setPick] = useState<Food | null>(null);
  const [g, setG] = useState(100);
  const { busy, run } = useAction();
  const veg = vegFilterFor(fit?.profile?.diet_prefs);
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    let off = false;
    setFoods(null);
    api.get<{ recent: Food[]; results: Food[] }>(`/fit/foods?q=${encodeURIComponent(debounced)}${veg ? `&veg=${veg}` : ''}`)
      .then((r) => { if (!off) setFoods(debounced ? r.results : [...r.recent, ...r.results.filter((x) => !r.recent.some((y) => y.id === x.id))]); })
      .catch(() => { if (!off) setFoods([]); });
    return () => { off = true; };
  }, [debounced, veg]);
  const label = MEALS.find((m) => m.key === meal)?.label;

  if (pick) {
    return (
      <Sheet open onClose={() => setPick(null)} title={pick.name}
        footer={<button className="btn btn-primary btn-lg w-full" disabled={busy || !(g > 0)} onClick={() =>
          run(() => api.post<PlanRes>('/coach/diet/items', { day, meal, food_id: pick.id, grams: g }), `Added to ${label}`).then((r) => r && onAdded(r))}>
          {busy && <Spinner className="w-4 h-4" />}Add {Math.round((pick.kcal * g) / 100)} kcal to {label}</button>}>
        <div className="flex items-center justify-between gap-3 mb-3"><span className="text-sm">{pick.serving_label}</span>
          <Stepper value={g} onChange={setG} step={pick.serving_g < 100 ? pick.serving_g : 10} min={5} suffix="g" /></div>
        <p className="text-xs muted">P {Math.round((pick.protein * g) / 10) / 10} g · C {Math.round((pick.carbs * g) / 10) / 10} g · F {Math.round((pick.fat * g) / 10) / 10} g</p>
        <button className="btn btn-ghost btn-sm mt-3 -ml-3" onClick={() => setPick(null)}>← Back to search</button>
      </Sheet>
    );
  }
  return (
    <Sheet open onClose={onClose} title={`Add to ${label}`}>
      <div className="relative mb-3">
        <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 muted" />
        <input className="input pl-11" autoFocus placeholder="Search roti, dal, egg, paneer…" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
      </div>
      {!foods ? <div className="py-8 flex justify-center"><Spinner /></div> : foods.length === 0 ? <p className="text-sm muted py-4 text-center">No match — try a simpler word.</p> : (
        <ul className="-mx-2">
          {foods.slice(0, 40).map((f) => (
            <li key={f.id}>
              <button className="w-full flex items-center gap-3 rounded-2xl px-2 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/5" onClick={() => { setPick(f); setG(f.serving_g); }}>
                <span className="flex-1 min-w-0"><span className="block text-sm font-medium truncate">{f.name}</span>
                  <span className="text-xs muted">{f.serving_label} · {Math.round((f.kcal * f.serving_g) / 100)} kcal</span></span>
                <Plus className="w-4 h-4 muted" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function WorkoutDay({ d, setRes }: { d: PlanDay; setRes: (r: PlanRes) => void }) {
  const toggle = useToggle(setRes, 'workout');
  const { run } = useAction();
  const future = d.day > todayLocal();
  // ~45 s of work per set + the prescribed rest, plus a minute to set up each exercise
  const minutes = Math.round(d.items.reduce((s, i) => s + (i.minutes ?? ((i.sets ?? 0) * (0.75 + (i.rest_s ?? 60) / 60) + 1)), 0));

  return (
    <>
      <section className={d.rest ? 'card card-pad' : 'card-ink p-5'}>
        <div className="flex items-center gap-3">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${d.rest ? 'bg-info/15 text-info' : 'bg-lime text-ink-900'}`}>{d.rest ? <Moon className="w-6 h-6" /> : <Dumbbell className="w-6 h-6" />}</div>
          <div className="flex-1 min-w-0">
            <p className={`font-display text-xl font-bold ${d.rest ? '' : 'text-white'}`}>{d.title}</p>
            <p className={`text-xs ${d.rest ? 'muted' : 'text-ink-300'}`}>{d.items.length} steps · about {minutes} min · {d.done}/{d.items.length} done</p>
          </div>
        </div>
        {d.tip && <p className={`text-sm mt-3 ${d.rest ? 'muted' : 'text-ink-200'}`}>💡 {d.tip}</p>}
      </section>

      <ol className="space-y-2.5">
        {d.items.map((it, i) => (
          <li key={it.id} className={`card p-3 flex items-center gap-3 ${it.done ? 'opacity-70' : ''}`}>
            <Tick item={it} future={future} onToggle={() => toggle(it)} />
            <ExercisePhoto images={it.images.slice(0, 2)} alt={it.name} className="w-14 h-14 rounded-2xl shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide muted">{i + 1}. {it.slot_label}</p>
              <p className={`font-semibold text-sm leading-tight truncate ${it.done ? 'line-through' : ''}`}>{it.name}</p>
              <p className="text-xs mt-0.5"><span className="text-lime-700 dark:text-lime font-semibold">{it.sets ? `${it.sets} × ${it.reps}` : `${it.minutes} min`}</span>
                {it.rest_s ? <span className="muted"> · rest {it.rest_s}s</span> : null}{it.equipment ? <span className="muted"> · {cap(it.equipment)}</span> : null}</p>
            </div>
            {!it.done && <button className="icon-btn w-9 h-9 muted shrink-0" aria-label={`Swap ${it.name}`} title="Swap for a similar exercise"
              onClick={() => run(() => api.post<PlanRes>(`/coach/items/${it.id}/swap`, {})).then((r) => r && setRes(r))}><RefreshCw className="w-4 h-4" /></button>}
          </li>
        ))}
      </ol>
      <p className="text-center text-xs muted">{future ? `You can tick these off on ${dow(d.day)}.` : 'Ticking logs the exercise with the planned sets (using the weight you lifted last time). Swap any move for a similar one.'}</p>
    </>
  );
}
