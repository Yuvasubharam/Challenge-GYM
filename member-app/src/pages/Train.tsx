import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Camera, Clock3, Copy, Dumbbell, Flame, ListChecks, Plus, Search, SlidersHorizontal, Trash2, Trophy, X } from 'lucide-react';
import { api, qs } from '../lib/api';
import { date as fmtDate, todayLocal } from '../lib/format';
import { cap, type Day, type Exercise, type SetEntry } from '../lib/fit';
import { useFit } from '../lib/fitctx';
import { ErrorBox, PageLoader, Sheet, Spinner, useAction, useLoad } from '../components/ui';
import { Credits, DateStrip, ExercisePhoto, ExerciseVideo, Stepper } from '../components/fit-ui';

interface Summary { this_week: { workouts: number; kcal_out: number }; streak: number }
type View = 'log' | 'exercises';

export default function Train() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get('view') === 'exercises' ? 'exercises' : 'log';
  const [date, setDate] = useState(params.get('date') ?? todayLocal());
  const [open, setOpen] = useState<string | null>(null);
  const setView = (v: View) => { const p = new URLSearchParams(params); if (v === 'log') p.delete('view'); else p.set('view', v); setParams(p); window.scrollTo({ top: 0 }); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 pt-1">
        <h1 className="text-2xl sm:text-3xl font-bold">Train</h1>
        <div className="flex rounded-full bg-black/5 dark:bg-white/5 p-1">
          {([['log', 'Log', <ListChecks key="l" className="w-4 h-4" />], ['exercises', 'Exercises', <Dumbbell key="e" className="w-4 h-4" />]] as const).map(([k, l, icon]) => (
            <button key={k} onClick={() => setView(k)}
              className={`flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-semibold transition ${view === k ? 'bg-ink-900 text-white dark:bg-lime dark:text-ink-900' : 'muted'}`}>{icon}{l}</button>
          ))}
        </div>
      </div>
      {view === 'log'
        ? <LogView date={date} setDate={setDate} onAdd={() => setView('exercises')} onOpen={setOpen} />
        : <Library date={date} onOpen={setOpen} />}
      {open && <ExerciseSheet id={open} date={date} onClose={() => setOpen(null)} onLogged={() => { setOpen(null); setView('log'); }} />}
    </div>
  );
}

// ── Log view ────────────────────────────────────────────────────────────
function LogView({ date, setDate, onAdd, onOpen }: { date: string; setDate: (d: string) => void; onAdd: () => void; onOpen: (id: string) => void }) {
  const { fit } = useFit();
  const { data: d, error, reload } = useLoad(() => api.get<Day>(`/fit/day?date=${date}`), [date]);
  const { data: sum, reload: reloadSum } = useLoad(() => api.get<Summary>('/fit/summary?days=7'), [d]);
  const { run } = useAction();
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const weekly = fit?.profile?.workouts_per_week ?? 4;

  return (
    <>
      <DateStrip value={date} onChange={setDate} />
      {!d ? <PageLoader /> : <>
        <section className="grid grid-cols-3 gap-3">
          <div className="rounded-3xl p-4 bg-lime text-ink-900"><Flame className="w-4 h-4" /><p className="font-display text-3xl font-bold mt-2 leading-none">{Math.round(d.burned)}</p><p className="text-[11px] mt-1 text-ink-700">kcal burned</p></div>
          <div className="card p-4"><Clock3 className="w-4 h-4 muted" /><p className="font-display text-3xl font-bold mt-2 leading-none">{Math.round(d.minutes)}</p><p className="text-[11px] mt-1 muted">minutes</p></div>
          <div className="card p-4"><Trophy className="w-4 h-4 muted" /><p className="font-display text-3xl font-bold mt-2 leading-none">{sum?.this_week.workouts ?? '–'}<span className="text-base muted">/{weekly}</span></p><p className="text-[11px] mt-1 muted">days this week</p></div>
        </section>

        {d.workouts.length === 0 ? (
          <button onClick={onAdd} className="w-full card card-pad text-center py-10 border-dashed hover:border-lime transition">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-lime/20 text-lime-700 dark:text-lime flex items-center justify-center mb-3"><Dumbbell className="w-7 h-7" /></div>
            <p className="font-semibold">No exercise logged {date === todayLocal() ? 'today' : 'this day'}</p>
            <p className="text-sm muted mt-1">Tap to pick from 2,000+ exercises</p>
          </button>
        ) : (
          <section className="space-y-2.5">
            {d.workouts.map((w) => (
              <div key={w.id} className="card p-3 flex items-center gap-3">
                <button onClick={() => w.exercise_id && onOpen(w.exercise_id)} className="shrink-0"><ExercisePhoto images={w.images.slice(0, 1)} alt={w.name} className="w-16 h-16 rounded-2xl" /></button>
                <button className="flex-1 min-w-0 text-left" onClick={() => w.exercise_id && onOpen(w.exercise_id)}>
                  <p className="font-semibold truncate">{w.name}</p>
                  <p className="text-xs muted truncate">{w.sets.length ? w.sets.map((s) => `${s.reps}×${s.kg || 'BW'}`).join(' · ') : `${w.duration_min} min`}</p>
                  <p className="text-xs mt-0.5"><span className="text-lime-700 dark:text-lime font-semibold">{Math.round(w.kcal)} kcal</span>{w.volume_kg ? <span className="muted"> · {Math.round(w.volume_kg)} kg volume</span> : null}</p>
                </button>
                <button className="icon-btn muted" aria-label="Remove" onClick={() => run(() => api.del(`/fit/workouts/${w.id}`)).then(() => { void reload(); void reloadSum(); })}><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            <button onClick={onAdd} className="btn btn-primary w-full"><Plus className="w-4 h-4" />Add exercise</button>
          </section>
        )}
        {sum && sum.streak > 1 && <p className="text-center text-sm">🔥 <b>{sum.streak}-day</b> active streak — keep it going!</p>}
      </>}
    </>
  );
}

// ── Exercise library (inline, keeps the app navigation visible) ─────────
interface Facet { value: string; n: number }
interface Facets { body: Facet[]; target: Facet[]; equipment: Facet[]; level: Facet[]; type: Facet[] }
const EMPTY = { q: '', body: '', target: '', equipment: '', level: '', type: '', photos: '' };
const TYPES: [string, string][] = [['', 'All'], ['strength', 'Strength'], ['cardio', 'Cardio'], ['stretching', 'Stretching'], ['plyometrics', 'Plyometrics']];

function Library({ date, onOpen }: { date: string; onOpen: (id: string) => void }) {
  const [f, setF] = useState(EMPTY);
  const [q, setQ] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [items, setItems] = useState<Exercise[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => { const t = setTimeout(() => setF((x) => ({ ...x, q: q.trim() })), 250); return () => clearTimeout(t); }, [q]);

  // Changing a parent filter clears a child value that no longer exists (e.g. Chest → Muscle "quads").
  const set = (k: keyof typeof EMPTY, v: string) => setF((x) => ({ ...x, [k]: v, ...(k === 'body' ? { target: '' } : {}) }));
  const active = (['body', 'target', 'equipment', 'level', 'type', 'photos'] as const).filter((k) => f[k]).length;
  const query = qs(f);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    Promise.all([api.get<{ results: Exercise[]; total: number | null; next: number | null }>(`/fit/exercises${query}`), api.get<Facets>(`/fit/exercises/facets${query}`)])
      .then(([r, fc]) => { if (cancelled) return; setItems(r.results); setTotal(r.total); setNext(r.next); setFacets(fc); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [query]);

  const more = async () => {
    if (next === null) return;
    setLoadingMore(true);
    const r = await api.get<{ results: Exercise[]; next: number | null }>(`/fit/exercises${qs({ ...f, offset: next })}`).catch(() => null);
    setLoadingMore(false);
    if (r) { setItems([...(items ?? []), ...r.results]); setNext(r.next); }
  };

  const browsing = !f.q && active === 0;
  const opt = (list: Facet[] | undefined, current: string) => {
    const l = list ?? [];
    return current && !l.some((x) => x.value === current) ? [{ value: current, n: 0 }, ...l] : l;
  };

  return (
    <div>
      {/* Sticky filter bar (sits under the page, above the bottom nav) */}
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-2 pb-3 bg-paper/95 dark:bg-ink-900/95 backdrop-blur space-y-2.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1"><Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 muted" />
            <input className="input pl-11 pr-9" placeholder="Search bench press, squat, curl…" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
            {q && <button className="absolute right-2 top-1/2 -translate-y-1/2 icon-btn w-8 h-8" onClick={() => setQ('')} aria-label="Clear search"><X className="w-4 h-4" /></button>}</div>
          <button className={`btn sm:hidden ${active ? 'btn-dark' : 'btn-outline'}`} onClick={() => setShowFilters(!showFilters)}>
            <SlidersHorizontal className="w-4 h-4" />{active ? active : ''}</button>
        </div>
        <div className={`${showFilters ? 'grid' : 'hidden'} sm:grid grid-cols-2 sm:grid-cols-4 gap-2`}>
          <Select label="Body part" value={f.body} onChange={(v) => set('body', v)} options={opt(facets?.body, f.body)} />
          <Select label="Muscle" value={f.target} onChange={(v) => set('target', v)} options={opt(facets?.target, f.target)} />
          <Select label="Equipment" value={f.equipment} onChange={(v) => set('equipment', v)} options={opt(facets?.equipment, f.equipment)} />
          <Select label="Level" value={f.level} onChange={(v) => set('level', v)} options={opt(facets?.level, f.level)} />
        </div>
        <div className="flex items-center gap-2 scroll-x">
          {TYPES.map(([v, l]) => {
            const n = v ? facets?.type.find((x) => x.value === v)?.n : undefined;
            return <button key={v} className={`chip ${f.type === v ? 'chip-on' : ''}`} onClick={() => set('type', v)}>{l}{n !== undefined && <span className="opacity-60">{n}</span>}</button>;
          })}
          <span className="w-px h-5 bg-paper-line dark:bg-ink-600 shrink-0" />
          <button className={`chip ${f.photos ? 'chip-on' : ''}`} onClick={() => set('photos', f.photos ? '' : 'yes')}><Camera className="w-3.5 h-3.5" />With photo</button>
          {(active > 0 || f.q) && <button className="chip text-bad" onClick={() => { setF(EMPTY); setQ(''); }}><X className="w-3.5 h-3.5" />Clear</button>}
        </div>
      </div>

      <div className="flex items-center justify-between text-xs muted mt-1 mb-3">
        <span>{items === null ? 'Loading…' : browsing ? `Popular picks · ${total ?? items.length}` : `${total ?? items.length} exercise${total === 1 ? '' : 's'}`}
          {f.body && ` · ${cap(f.body)}`}{f.target && ` · ${cap(f.target)}`}{f.equipment && ` · ${cap(f.equipment)}`}</span>
        <span>Logging to <b className="text-inherit">{date === todayLocal() ? 'today' : fmtDate(date, false)}</b></span>
      </div>

      {items === null ? <div className="py-16 flex justify-center"><Spinner /></div> : items.length === 0 ? (
        <div className="card card-pad text-center py-12"><p className="font-semibold">No exercises match</p><p className="text-sm muted mt-1">Try removing a filter.</p>
          <button className="btn btn-outline btn-sm mt-4" onClick={() => { setF(EMPTY); setQ(''); }}>Clear filters</button></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((e) => (
            <button key={e.id} onClick={() => onOpen(e.id)} className="text-left rounded-3xl overflow-hidden bg-ink-900 text-white relative group aspect-[4/5]">
              <ExercisePhoto images={e.images.slice(0, 1)} alt={e.name} className="absolute inset-0 w-full h-full group-hover:scale-105 transition-transform duration-300" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
              <div className="absolute bottom-0 inset-x-0 p-3">
                <p className="font-display font-bold leading-tight text-sm">{e.name}</p>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {e.target && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-lime text-ink-900">{cap(e.target)}</span>}
                  {e.equipment && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-white/15">{cap(e.equipment)}</span>}
                </div>
              </div>
              {e.tracking === 'time' && <span className="absolute top-2 left-2 badge bg-lime text-ink-900">Cardio</span>}
              {e.level && <span className="absolute top-2 right-2 badge bg-black/50 text-white">{cap(e.level)}</span>}
            </button>
          ))}
        </div>
      )}
      {next !== null && <div className="flex justify-center mt-5"><button className="btn btn-outline" disabled={loadingMore} onClick={more}>{loadingMore && <Spinner className="w-4 h-4" />}Show more</button></div>}
      <Credits />
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Facet[] }) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select className={`input h-10 text-sm py-0 ${value ? 'border-lime-600 dark:border-lime font-semibold' : ''}`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{label}: all</option>
        {options.map((o) => <option key={o.value} value={o.value}>{cap(o.value)}{o.n ? ` (${o.n})` : ''}</option>)}
      </select>
    </label>
  );
}

// ── Exercise detail + logger ────────────────────────────────────────────
interface ExerciseFull extends Exercise {
  secondary: string[]; instructions: string[]; instructions_hi: string[] | null; description: string | null; video: string | null;
  history: { day: string; sets: SetEntry[]; duration_min: number; kcal: number; best_e1rm: number | null; volume_kg: number }[]; best_e1rm: number | null;
}

function ExerciseSheet({ id, date, onClose, onLogged }: { id: string; date: string; onClose: () => void; onLogged: () => void }) {
  const { fit } = useFit();
  const { data: ex } = useLoad(() => api.get<ExerciseFull>(`/fit/exercises/${encodeURIComponent(id)}`), [id]);
  const [lang, setLang] = useState<'en' | 'hi'>('en');
  const [sets, setSets] = useState<SetEntry[]>([]);
  const [minutes, setMinutes] = useState(20);
  const { busy, run } = useAction();
  useEffect(() => {
    if (!ex) return;
    const last = ex.history.find((h) => h.sets.length)?.sets;
    setSets(last?.length ? last.map((s) => ({ ...s })) : [{ reps: 10, kg: 0 }, { reps: 10, kg: 0 }, { reps: 10, kg: 0 }]);
    const lastMin = ex.history.find((h) => h.duration_min)?.duration_min;
    if (lastMin) setMinutes(Math.round(lastMin));
  }, [ex]);
  if (!ex) return <Sheet open onClose={onClose} title="Exercise"><div className="py-10 flex justify-center"><Spinner /></div></Sheet>;

  const weight = fit?.profile?.weight_kg ?? 70;
  const mins = ex.tracking === 'time' ? minutes : sets.length * 2.5;
  const estKcal = Math.round(ex.met * weight * (mins / 60));
  const steps = lang === 'hi' && ex.instructions_hi ? ex.instructions_hi : ex.instructions;
  const upd = (i: number, k: keyof SetEntry, v: number) => setSets(sets.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const save = () => run(() => api.post('/fit/workouts', ex.tracking === 'time' ? { date, exercise_id: ex.id, duration_min: minutes } : { date, exercise_id: ex.id, sets }),
    `Logged ${ex.name}`).then((r) => r && onLogged());

  return (
    <Sheet open onClose={onClose} title={ex.name}
      footer={<button className="btn btn-primary btn-lg w-full" disabled={busy || (ex.tracking === 'sets' ? !sets.some((s) => s.reps > 0) : !(minutes > 0))} onClick={save}>
        {busy && <Spinner className="w-4 h-4" />}Log for {date === todayLocal() ? 'today' : fmtDate(date, false)} · ~{estKcal} kcal</button>}>
      <ExercisePhoto images={ex.images} alt={ex.name} className="w-full aspect-[4/3] rounded-3xl mb-4" />
      <div className="flex flex-wrap gap-1.5 mb-4">
        {ex.target && <span className="badge bg-lime text-ink-900">{cap(ex.target)}</span>}
        {ex.secondary.slice(0, 3).map((s) => <span key={s} className="badge bg-black/5 dark:bg-white/10">{cap(s)}</span>)}
        {ex.equipment && <span className="badge bg-black/5 dark:bg-white/10">{cap(ex.equipment)}</span>}
        {ex.level && <span className="badge bg-black/5 dark:bg-white/10">{cap(ex.level)}</span>}
      </div>
      {ex.description && <p className="text-sm muted leading-relaxed whitespace-pre-line mb-5">{ex.description}</p>}

      {ex.tracking === 'time' ? (
        <div className="flex items-center justify-between mb-5 rounded-3xl bg-black/[.03] dark:bg-white/[.04] p-4">
          <span className="font-semibold">Duration</span><Stepper value={minutes} onChange={setMinutes} step={5} min={1} suffix="min" />
        </div>
      ) : (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2"><p className="font-semibold">Sets</p>
            {ex.best_e1rm && <p className="text-xs muted flex items-center gap-1"><Trophy className="w-3.5 h-3.5 text-warn" />Best est. 1RM {ex.best_e1rm} kg</p>}</div>
          <div className="space-y-2">
            {sets.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-ink-900 text-lime dark:bg-lime dark:text-ink-900 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                <Stepper value={s.reps} onChange={(v) => upd(i, 'reps', Math.round(v))} step={1} min={0} suffix="reps" />
                <Stepper value={s.kg} onChange={(v) => upd(i, 'kg', v)} step={2.5} min={0} suffix="kg" />
                <button className="icon-btn w-8 h-8 muted shrink-0" onClick={() => setSets(sets.filter((_, j) => j !== i))} aria-label="Remove set"><X className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <button className="btn btn-outline btn-sm" onClick={() => setSets([...sets, { ...(sets[sets.length - 1] ?? { reps: 10, kg: 0 }) }])}><Copy className="w-3.5 h-3.5" />Repeat last set</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSets([...sets, { reps: 10, kg: 0 }])}><Plus className="w-3.5 h-3.5" />Add set</button>
          </div>
          <p className="text-[11px] muted mt-2">Use 0 kg for body-weight exercises. Calories are estimated from time under training (~2.5 min per set).</p>
        </div>
      )}

      {(steps.length > 0 || ex.video) && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2"><p className="font-semibold">How to do it</p>
            {ex.instructions_hi && <div className="flex rounded-full bg-black/5 dark:bg-white/5 p-0.5 text-xs">
              {(['en', 'hi'] as const).map((l) => <button key={l} className={`px-3 h-7 rounded-full font-semibold ${lang === l ? 'bg-ink-900 text-white dark:bg-lime dark:text-ink-900' : ''}`} onClick={() => setLang(l)}>{l === 'en' ? 'English' : 'हिंदी'}</button>)}
            </div>}</div>
          {ex.video && <ExerciseVideo video={ex.video} />}
          <ol className="space-y-2 text-sm">{steps.map((s, i) => <li key={i} className="flex gap-3"><span className="font-display font-bold text-lime-700 dark:text-lime">{i + 1}</span><span className="muted leading-relaxed">{s}</span></li>)}</ol>
        </div>
      )}

      {ex.history.length > 0 && (
        <div>
          <p className="font-semibold mb-2">Your history</p>
          <ul className="text-sm space-y-1.5">{ex.history.slice(0, 6).map((h, i) => (
            <li key={i} className="flex justify-between gap-3"><span className="muted">{fmtDate(h.day, false)}</span>
              <span className="text-right truncate">{h.sets.length ? h.sets.map((s) => `${s.reps}×${s.kg || 'BW'}`).join(' · ') : `${h.duration_min} min`}</span></li>
          ))}</ul>
        </div>
      )}
      <Credits />
    </Sheet>
  );
}
