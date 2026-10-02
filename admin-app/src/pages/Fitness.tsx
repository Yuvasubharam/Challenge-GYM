import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChefHat, ChevronLeft, ChevronRight, Dumbbell, Eye, EyeOff, ImagePlus, Plus, Search, Star, Trash2, Upload, Users, Utensils, Video, X } from 'lucide-react';
import { api, qs } from '../lib/api';
import { ago } from '../lib/format';
import { useSession } from '../lib/session';
import { Confirm, Empty, ErrorBox, Field, Modal, PageLoader, SectionTitle, Segmented, Spinner, useAction, useLoad, useToast } from '../components/ui';
import { PageHeader } from '../components/Layout';

type Tab = 'overview' | 'foods' | 'exercises';

export default function Fitness() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'overview';
  return (
    <>
      <PageHeader title="Fitness" subtitle="Member diet & workout tracker — food database and exercise library." />
      <div className="mb-5">
        <Segmented<Tab> value={tab} onChange={(t) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true })} options={[
          { value: 'overview', label: 'Overview' }, { value: 'foods', label: 'Food database' }, { value: 'exercises', label: 'Exercise library' },
        ]} />
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'foods' && <Foods />}
      {tab === 'exercises' && <Exercises />}
    </>
  );
}

// ── Shared: pager ───────────────────────────────────────────────────────
export function Pager({ page, pages, total, size, onPage, onSize, sizes = [25, 50, 100] }: {
  page: number; pages: number; total: number; size: number; onPage: (p: number) => void; onSize?: (s: number) => void; sizes?: number[];
}) {
  const from = total ? (page - 1) * size + 1 : 0;
  const to = Math.min(total, page * size);
  // compact page list: 1 … p-1 p p+1 … last
  const nums = [...new Set([1, page - 1, page, page + 1, pages].filter((n) => n >= 1 && n <= pages))].sort((a, b) => a - b);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-paper-line dark:border-ink-700 text-sm">
      <div className="flex items-center gap-3 muted">
        <span>{from}–{to} of {total}</span>
        {onSize && (
          <select className="input h-9 w-auto py-0 pr-8 text-xs" value={size} onChange={(e) => onSize(Number(e.target.value))} aria-label="Rows per page">
            {sizes.map((s) => <option key={s} value={s}>{s} / page</option>)}
          </select>
        )}
      </div>
      <div className="flex items-center gap-1">
        <button className="icon-btn w-9 h-9 disabled:opacity-30" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="w-4 h-4" /></button>
        {nums.map((n, i) => (
          <span key={n} className="flex items-center">
            {i > 0 && n - nums[i - 1] > 1 && <span className="px-1 muted">…</span>}
            <button onClick={() => onPage(n)} className={`min-w-9 h-9 px-2 rounded-full text-sm font-semibold ${n === page ? 'bg-ink-900 text-white dark:bg-lime dark:text-ink-900' : 'hover:bg-black/5 dark:hover:bg-white/10'}`}>{n}</button>
          </span>
        ))}
        <button className="icon-btn w-9 h-9 disabled:opacity-30" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

function useDebounced(v: string, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

const Chips = <T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) => (
  <div className="flex flex-wrap gap-1.5">{options.map(([v, l]) => <button key={v} className={`chip ${value === v ? 'chip-on' : ''}`} onClick={() => onChange(v)}>{l}</button>)}</div>
);

// ── Overview ────────────────────────────────────────────────────────────
interface OverviewData {
  counts: { members: number; app_users: number; app_off: number; onboarded: number; food_loggers_7d: number; workout_loggers_7d: number; food_logs_7d: number; workouts_7d: number };
  goals: { goal: string; n: number }[]; diets: Record<string, number>;
  top_foods: { name: string; n: number }[]; top_exercises: { name: string; n: number }[];
  recent: { id: number; name: string; essl_id: string; goal: string; weight_kg: number; onboarded_at: string }[];
}
const GOAL: Record<string, string> = { lose_weight: 'Lose weight', gain_weight: 'Gain weight', build_muscle: 'Build muscle', maintain: 'Maintain', get_fit: 'Improve fitness' };
const DIET: Record<string, string> = { veg: 'Vegetarian', egg: 'Eggetarian', nonveg: 'Non-veg', vegan: 'Vegan' };

function Overview() {
  const { data, error, reload } = useLoad(() => api.get<OverviewData>('/fitness/overview'));
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <PageLoader />;
  const c = data.counts;
  const maxGoal = Math.max(1, ...data.goals.map((g) => g.n));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Member app users" value={c.app_users} sub={`${c.app_off} switched off`} to="/members?status=app_off" />
        <Kpi label="Set up tracker" value={c.onboarded} sub={c.app_users ? `${Math.round((c.onboarded / c.app_users) * 100)}% of app users` : '—'} />
        <Kpi label="Logging food (7d)" value={c.food_loggers_7d} sub={`${c.food_logs_7d} entries`} />
        <Kpi label="Logging workouts (7d)" value={c.workout_loggers_7d} sub={`${c.workouts_7d} exercises`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card card-pad">
          <SectionTitle title="Member goals" />
          {data.goals.length === 0 ? <p className="text-sm muted">No one has set a goal yet.</p> : data.goals.map((g) => (
            <div key={g.goal} className="mb-2.5">
              <div className="flex justify-between text-sm"><span>{GOAL[g.goal] ?? g.goal}</span><span className="font-semibold">{g.n}</span></div>
              <div className="h-2 rounded-full bg-black/5 dark:bg-white/10 mt-1 overflow-hidden"><div className="h-full bg-lime rounded-full" style={{ width: `${(g.n / maxGoal) * 100}%` }} /></div>
            </div>
          ))}
          {Object.keys(data.diets).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4">{Object.entries(data.diets).map(([k, n]) => <span key={k} className="badge bg-black/5 dark:bg-white/10">{DIET[k] ?? k} · {n}</span>)}</div>
          )}
        </div>
        <TopList title="Most-logged foods (30d)" icon={<Utensils className="w-4 h-4" />} rows={data.top_foods} empty="No food logged yet." />
        <TopList title="Most-logged exercises (30d)" icon={<Dumbbell className="w-4 h-4" />} rows={data.top_exercises} empty="No workouts logged yet." />
      </div>
      <WeightProgress />
      <div className="card overflow-hidden">
        <p className="font-semibold px-4 pt-4 pb-2 flex items-center gap-2"><Users className="w-4 h-4" />Recently set up</p>
        {data.recent.length === 0 ? <p className="text-sm muted px-4 pb-5">Members appear here after finishing the setup questions in the member app.</p> : (
          <ul>{data.recent.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-paper-line dark:border-ink-700 text-sm">
              <Link to={`/members/${r.id}`} className="flex-1 truncate font-semibold hover:underline">{r.name} <span className="muted font-normal">#{r.essl_id}</span></Link>
              <span className="muted">{GOAL[r.goal] ?? r.goal} · {r.weight_kg} kg</span><span className="text-xs muted w-20 text-right">{ago(r.onboarded_at)}</span>
            </li>
          ))}</ul>
        )}
      </div>
    </div>
  );
}

interface WeightRow {
  id: number; name: string; essl_id: string | null; goal: string | null; start_weight_kg: number | null; weight_kg: number | null; target_weight_kg: number | null;
  entries: number; last_day: string | null; change: number; good_change: number; progress: number | null; weeks: number; days_since: number | null; overdue: boolean; reached: boolean;
}
interface WeightProgressData { totals: { tracking: number; weighed_7d: number; overdue: number; reached: number; kg_lost: number; kg_gained: number }; members: WeightRow[] }
type WeightFilter = 'top' | 'overdue' | 'reached' | 'all';

/** Members' weight journeys — success stories for promotions and a list of who needs a nudge. */
function WeightProgress() {
  const { data } = useLoad(() => api.get<WeightProgressData>('/fitness/weight-progress'));
  const [f, setF] = useState<WeightFilter>('top');
  const [rows, setRows] = useState(15);
  const toast = useToast();
  if (!data) return null;
  const t = data.totals;
  const list = data.members.filter((m) => f === 'top' ? m.good_change > 0 : f === 'overdue' ? m.overdue : f === 'reached' ? m.reached : true);
  const promo = [t.kg_lost > 0 && `${t.kg_lost} kg lost`, t.kg_gained > 0 && `${t.kg_gained} kg of healthy gain`].filter(Boolean).join(' and ');
  const promoLine = promo ? `Our members have tracked ${promo} with the Challenge Gym app${t.reached ? ` — ${t.reached} already hit their goal` : ''}! 💪` : '';
  return (
    <div className="card overflow-hidden">
      <div className="px-4 pt-4 pb-2 flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold">Weight progress</p>
        <Chips<WeightFilter> value={f} onChange={(v) => { setF(v); setRows(15); }} options={[['top', 'Top progress'], ['overdue', `Overdue weigh-in (${t.overdue})`], ['reached', `Reached goal (${t.reached})`], ['all', 'All']]} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 px-4 pb-3">
        <MiniStat label="Tracking weight" value={t.tracking} />
        <MiniStat label="Weighed in (7d)" value={t.weighed_7d} />
        <MiniStat label="Total lost (kg)" value={t.kg_lost} />
        <MiniStat label="Healthy gain (kg)" value={t.kg_gained} />
      </div>
      {promoLine && (
        <div className="mx-4 mb-3 rounded-2xl bg-lime/15 p-3 text-sm flex items-start gap-3">
          <span className="flex-1">{promoLine}</span>
          <button className="btn btn-outline btn-sm shrink-0" onClick={() => navigator.clipboard?.writeText(promoLine).then(() => toast('ok', 'Copied'), () => toast('error', 'Could not copy'))}>Copy</button>
        </div>
      )}
      {list.length === 0 ? <p className="text-sm muted px-4 pb-5">{f === 'overdue' ? 'Everyone has weighed in this week.' : 'No members here yet — they appear once they log weigh-ins in the member app.'}</p> : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Member</th><th>Goal</th><th className="text-right">Start → now</th><th className="text-right">Change</th><th>To goal</th><th>Last weigh-in</th></tr></thead>
            <tbody>{list.slice(0, rows).map((m) => (
              <tr key={m.id}>
                <td><Link to={`/members/${m.id}`} className="font-semibold hover:underline">{m.name}</Link> <span className="muted text-xs">#{m.essl_id ?? '—'}</span></td>
                <td className="text-xs muted whitespace-nowrap">{m.goal ? GOAL[m.goal] ?? m.goal : '—'}{m.target_weight_kg ? ` · ${m.target_weight_kg} kg` : ''}</td>
                <td className="text-right whitespace-nowrap text-sm">{m.start_weight_kg ?? '—'} → <b>{m.weight_kg ?? '—'}</b></td>
                <td className={`text-right font-semibold whitespace-nowrap ${m.good_change > 0 ? 'text-ok' : m.good_change < 0 ? 'text-warn' : 'muted'}`}>{m.change > 0 ? '+' : ''}{m.change} kg{m.weeks ? <span className="muted font-normal text-xs"> / {m.weeks}w</span> : null}</td>
                <td className="min-w-28">{m.progress === null ? <span className="muted text-xs">no target</span> : (
                  <div className="flex items-center gap-2"><div className="h-1.5 flex-1 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden"><div className="h-full bg-lime" style={{ width: `${m.progress}%` }} /></div><span className="text-xs w-9 text-right">{m.progress}%</span></div>
                )}</td>
                <td className={`text-xs whitespace-nowrap ${m.overdue ? 'text-warn' : 'muted'}`}>{m.days_since === null ? 'never' : m.days_since === 0 ? 'today' : `${m.days_since}d ago`}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {list.length > rows && <div className="p-3 text-center border-t border-paper-line dark:border-ink-700"><button className="btn btn-outline btn-sm" onClick={() => setRows(rows + 50)}>More</button></div>}
      <p className="text-[11px] muted px-4 py-3 border-t border-paper-line dark:border-ink-700">Ask the member before sharing their name, photo or numbers publicly. Weigh-in reminders are set under Settings → Weigh-in reminders.</p>
    </div>
  );
}

const MiniStat = ({ label, value }: { label: string; value: number }) => (
  <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.04] p-3"><p className="text-xs muted">{label}</p><p className="font-display text-xl font-bold">{value}</p></div>
);

const Kpi = ({ label, value, sub, to }: { label: string; value: number; sub: string; to?: string }) => {
  const body = <div className="card card-pad h-full"><p className="text-xs font-semibold muted">{label}</p><p className="kpi mt-3">{value}</p><p className="text-xs muted mt-2">{sub}</p></div>;
  return to ? <Link to={to}>{body}</Link> : body;
};

function TopList({ title, icon, rows, empty }: { title: string; icon: React.ReactNode; rows: { name: string; n: number }[]; empty: string }) {
  return (
    <div className="card card-pad">
      <SectionTitle title={title} action={<span className="muted">{icon}</span>} />
      {rows.length === 0 ? <p className="text-sm muted">{empty}</p> : (
        <ol className="space-y-2 text-sm">{rows.map((r, i) => (
          <li key={r.name} className="flex gap-3"><span className="w-4 muted text-xs mt-0.5">{i + 1}</span><span className="flex-1 truncate">{r.name}</span><span className="font-semibold">{r.n}×</span></li>
        ))}</ol>
      )}
    </div>
  );
}

// ── Foods ───────────────────────────────────────────────────────────────
interface FoodRow { id: number; name: string; kcal: number; protein: number; carbs: number; fat: number; fiber: number | null; serving_g: number; serving_label: string; veg: string | null; source: string; active: number; uses: number; image: string | null; has_recipe: number }
interface FoodPage {
  stats: { total: number; hidden: number; gym_added: number; curated: number; veg: number; egg: number; nonveg: number; unknown: number };
  total: number; page: number; size: number; pages: number; foods: FoodRow[];
}
const SRC: Record<string, string> = { basic: 'USDA', indb: 'Indian DB', cg: 'Curated', custom: 'Gym' };

function Foods() {
  const { can } = useSession();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const [veg, setVeg] = useState('');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('visible');
  const [sort, setSort] = useState('used');
  const [size, setSize] = useState(25);
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [debounced, veg, source, status, sort, size]);
  const { data, error, reload } = useLoad(() => api.get<FoodPage>(`/foods${qs({ q: debounced, veg, source, status, sort, page, size })}`), [debounced, veg, source, status, sort, page, size]);
  const [edit, setEdit] = useState<FoodRow | 'new' | null>(null);
  const s = data?.stats;
  const admin = can('owner', 'admin');

  return (
    <div className="card overflow-hidden">
      <div className="p-4 space-y-3 border-b border-paper-line dark:border-ink-700">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]"><Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 muted" />
            <input className="input pl-11" placeholder="Search foods (roti, dal, paneer…)" value={q} onChange={(e) => setQ(e.target.value)} type="search" /></div>
          <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="used">Most used</option><option value="name">Name A–Z</option><option value="kcal_desc">Calories high → low</option>
            <option value="kcal_asc">Calories low → high</option><option value="protein">Protein high → low</option><option value="updated">Recently edited</option>
          </select>
          {admin && <button className="btn btn-primary" onClick={() => setEdit('new')}><Plus className="w-4 h-4" />Add food</button>}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 items-center">
          <Chips value={veg} onChange={setVeg} options={[['', `All types${s ? ` · ${s.total}` : ''}`], ['veg', `🟢 Veg${s ? ` · ${s.veg}` : ''}`], ['egg', `🟡 Egg${s ? ` · ${s.egg}` : ''}`], ['nonveg', `🔴 Non-veg${s ? ` · ${s.nonveg}` : ''}`], ['unknown', 'Unknown']]} />
          <Chips value={source} onChange={setSource} options={[['', 'All sources'], ['cg', `Curated + recipe${s ? ` · ${s.curated}` : ''}`], ['indb', 'Indian DB'], ['basic', 'USDA'], ['custom', `Gym-added${s ? ` · ${s.gym_added}` : ''}`]]} />
          <Chips value={status} onChange={setStatus} options={[['visible', 'Visible'], ['hidden', `Hidden${s ? ` · ${s.hidden}` : ''}`], ['all', 'All']]} />
        </div>
      </div>
      {error ? <div className="p-4"><ErrorBox error={error} onRetry={reload} /></div> : !data ? <PageLoader /> : data.foods.length === 0 ? (
        <Empty icon={<Utensils className="w-6 h-6" />} title="No foods match" hint="Change the filters or search." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Food</th><th className="text-right">kcal</th><th className="text-right">Protein</th><th className="text-right">Carbs</th><th className="text-right">Fat</th><th>Serving</th><th>Source</th><th className="text-right">Logged</th></tr></thead>
              <tbody>{data.foods.map((r) => (
                <tr key={r.id} className={`${admin ? 'cursor-pointer' : ''} ${r.active ? '' : 'opacity-40'}`} onClick={() => admin && setEdit(r)}>
                  <td className="min-w-[200px]"><span className={`inline-block w-2 h-2 rounded-sm mr-2 ${r.veg === 'nonveg' ? 'bg-bad' : r.veg === 'egg' ? 'bg-warn' : r.veg === 'veg' ? 'bg-ok' : 'bg-ink-300'}`} />{r.name}
                    {!!r.has_recipe && <ChefHat className="inline w-3.5 h-3.5 ml-1.5 muted" aria-label="Has recipe" />}</td>
                  <td className="text-right font-semibold">{r.kcal}</td><td className="text-right">{r.protein}</td><td className="text-right">{r.carbs}</td><td className="text-right">{r.fat}</td>
                  <td className="text-xs muted whitespace-nowrap">{r.serving_label}</td><td className="text-xs muted">{SRC[r.source] ?? r.source}</td><td className="text-right text-xs muted">{r.uses}×</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <Pager page={data.page} pages={data.pages} total={data.total} size={data.size} onPage={setPage} onSize={setSize} />
          <p className="text-[11px] muted px-4 pb-3">Values per 100 g (or 100 ml). Hidden foods stay in members' past logs but can't be picked again.</p>
        </>
      )}
      {edit && <FoodEditor row={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />}
    </div>
  );
}

function FoodEditor({ row, onClose, onSaved }: { row: FoodRow | 'new'; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState(row === 'new'
    ? { name: '', kcal: '', protein: '', carbs: '', fat: '', fiber: '', serving_g: '100', serving_label: '100 g', veg: 'veg', active: true, ingredients: '', steps: '' }
    : { name: row.name, kcal: String(row.kcal), protein: String(row.protein), carbs: String(row.carbs), fat: String(row.fat), fiber: row.fiber === null ? '' : String(row.fiber),
        serving_g: String(row.serving_g), serving_label: row.serving_label, veg: row.veg ?? '', active: !!row.active, ingredients: '', steps: '' });
  // The list has no recipe text: load it for an existing food, then fill the two text boxes (one item per line).
  const [detail, setDetail] = useState<{ image: string | null; image_credit: string | null } | null>(null);
  const [recipeReady, setRecipeReady] = useState(row === 'new');
  useEffect(() => {
    if (row === 'new') return;
    api.get<{ ingredients: string[]; steps: string[]; image: string | null; image_credit: string | null }>(`/foods/${row.id}`).then((d) => {
      setF((cur) => ({ ...cur, ingredients: d.ingredients.join('\n'), steps: d.steps.join('\n') }));
      setDetail(d);
      setRecipeReady(true);
    }).catch(() => setRecipeReady(true));
  }, [row]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const body = { name: f.name, kcal: Number(f.kcal), protein: Number(f.protein || 0), carbs: Number(f.carbs || 0), fat: Number(f.fat || 0),
    ...(f.fiber !== '' ? { fiber: Number(f.fiber) } : {}), serving_g: Number(f.serving_g || 100), serving_label: f.serving_label, veg: f.veg || null, active: f.active,
    ...(recipeReady ? { ingredients: f.ingredients, steps: f.steps } : {}) };
  const perServing = Math.round((Number(f.kcal || 0) * Number(f.serving_g || 100)) / 100);
  return (
    <Modal open onClose={onClose} title={row === 'new' ? 'Add food' : 'Edit food'}
      footer={<>
        {row !== 'new' && <button className="btn btn-ghost mr-auto" onClick={() => setF({ ...f, active: !f.active })}>{f.active ? <><EyeOff className="w-4 h-4" />Hide</> : <><Eye className="w-4 h-4" />Show</>}</button>}
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !f.name || f.kcal === ''} onClick={() =>
          run(() => (row === 'new' ? api.post('/foods', body) : api.patch(`/foods/${row.id}`, body)), 'Food saved').then((r) => r && onSaved())}>{busy && <Spinner className="w-4 h-4" />}Save</button></>}>
      <div className="space-y-3">
        <Field label="Name"><input className="input" value={f.name} onChange={set('name')} /></Field>
        <p className="text-xs muted">Per 100 g (or 100 ml):</p>
        <div className="grid grid-cols-5 gap-2">
          {(['kcal', 'protein', 'carbs', 'fat', 'fiber'] as const).map((k) => <Field key={k} label={k === 'kcal' ? 'kcal' : `${k} g`}><input className="input px-3" inputMode="decimal" value={f[k]} onChange={set(k)} /></Field>)}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Serving label" hint="Shown to members, e.g. 1 roti (40 g)"><input className="input" value={f.serving_label} onChange={set('serving_label')} /></Field>
          <Field label="Serving weight (g)" hint={`= ${perServing} kcal per serving`}><input className="input" inputMode="decimal" value={f.serving_g} onChange={set('serving_g')} /></Field>
          <Field label="Type"><select className="input" value={f.veg} onChange={set('veg')}><option value="veg">Veg</option><option value="egg">Contains egg</option><option value="nonveg">Non-veg</option><option value="">Unknown</option></select></Field>
          <label className="flex items-center gap-2 text-sm mt-7"><input type="checkbox" className="accent-lime w-4 h-4" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Visible to members</label>
        </div>
        <p className="text-xs font-semibold flex items-center gap-1.5 pt-2"><ChefHat className="w-4 h-4" />Recipe <span className="font-normal muted">— optional, shown to members under ⓘ</span></p>
        {!recipeReady ? <div className="py-4 flex justify-center"><Spinner /></div> : <>
          <Field label="Ingredients" hint="One per line"><textarea className="input min-h-[96px] py-2" value={f.ingredients} onChange={set('ingredients')} placeholder={'2 cups cooked rice\n3 eggs\n1 tbsp soy sauce'} /></Field>
          <Field label="Steps" hint="One step per line"><textarea className="input min-h-[120px] py-2" value={f.steps} onChange={set('steps')} placeholder={'Scramble the eggs and keep aside.\nStir-fry the vegetables…'} /></Field>
        </>}
        {detail?.image_credit && <p className="text-[11px] muted">Photo: {detail.image_credit}</p>}
      </div>
    </Modal>
  );
}

// ── Exercises ───────────────────────────────────────────────────────────
interface ExRow { id: string; name: string; body_part: string | null; target: string | null; equipment: string | null; category: string | null; images: string[]; tracking: string; popular: number; active: number; source: string; has_video: number; uses: number }
type Facet = { value: string; n: number }[];
interface ExFacets { body_parts: Facet; equipment: Facet; targets: Facet; categories: Facet; stats: { total: number; hidden: number; popular: number; with_photos: number } }
interface ExPage { total: number; page: number; size: number; pages: number; exercises: ExRow[]; facets: ExFacets | null }
interface ExFull {
  id: string; name: string; body_part: string | null; target: string | null; secondary: string[]; equipment: string | null; category: string | null; level: string | null;
  description: string | null; instructions: string[]; instructions_hi: string[] | null; images: string[]; video: string | null;
  met: number; tracking: 'sets' | 'time'; popular: number; active: number; source: string; uses: number;
}
const cap = (s: string | null) => (s ? s.replace(/\b\w/g, (m) => m.toUpperCase()) : '');
const photo = (p: string) => `/api/fitness/media/${p.split('/').map(encodeURIComponent).join('/')}`;
const youtubeId = (u: string) => u.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/)?.[1] ?? null;
const isUpload = (p: string) => p.startsWith('u/');

function Exercises() {
  const { can } = useSession();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q);
  const [body, setBody] = useState('');
  const [equipment, setEquipment] = useState('');
  const [photos, setPhotos] = useState('');
  const [status, setStatus] = useState('visible');
  const [popular, setPopular] = useState(false);
  const [sort, setSort] = useState('popular');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(24);
  const [facets, setFacets] = useState<ExPage['facets']>(null);
  const [edit, setEdit] = useState<string | null>(null); // exercise id, or 'new'
  useEffect(() => setPage(1), [debounced, body, equipment, photos, status, popular, sort, size]);
  const { data, error, reload, setData } = useLoad(() => api.get<ExPage>(`/fitness/exercises${qs({ q: debounced, body, equipment, photos, status, popular: popular ? 1 : '', sort, page, size })}`),
    [debounced, body, equipment, photos, status, popular, sort, page, size]);
  useEffect(() => { if (data?.facets) setFacets(data.facets); }, [data]);
  const { run } = useAction();
  const admin = can('owner', 'admin');
  const patch = (e: ExRow, change: Partial<Pick<ExRow, 'active' | 'popular'>>) =>
    run(() => api.patch(`/fitness/exercises/${encodeURIComponent(e.id)}`, Object.fromEntries(Object.entries(change).map(([k, v]) => [k, !!v]))))
      .then((r) => { if (r && data) setData({ ...data, exercises: data.exercises.map((x) => (x.id === e.id ? { ...x, ...change } : x)) }); });
  const st = facets?.stats;

  return (
    <div className="card overflow-hidden">
      <div className="p-4 space-y-3 border-b border-paper-line dark:border-ink-700">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]"><Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 muted" />
            <input className="input pl-11" placeholder="Search exercises or muscles" value={q} onChange={(e) => setQ(e.target.value)} type="search" /></div>
          <select className="input w-auto" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Body part">
            <option value="">All body parts</option>{(facets?.body_parts ?? []).map((b) => <option key={b.value} value={b.value}>{cap(b.value)} ({b.n})</option>)}
          </select>
          <select className="input w-auto" value={equipment} onChange={(e) => setEquipment(e.target.value)} aria-label="Equipment">
            <option value="">All equipment</option>{(facets?.equipment ?? []).map((b) => <option key={b.value} value={b.value}>{cap(b.value)} ({b.n})</option>)}
          </select>
          <select className="input w-auto" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            <option value="popular">Popular first</option><option value="used">Most logged</option><option value="name">Name A–Z</option>
          </select>
          {admin && <button className="btn btn-primary" onClick={() => setEdit('new')}><Plus className="w-4 h-4" />Add exercise</button>}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 items-center">
          <Chips value={photos} onChange={setPhotos} options={[['', `All${st ? ` · ${st.total}` : ''}`], ['yes', `With photo${st ? ` · ${st.with_photos}` : ''}`], ['no', 'No photo']]} />
          <Chips value={status} onChange={setStatus} options={[['visible', 'Visible'], ['hidden', `Hidden${st ? ` · ${st.hidden}` : ''}`], ['all', 'All']]} />
          <button className={`chip ${popular ? 'chip-on' : ''}`} onClick={() => setPopular(!popular)}><Star className="w-3.5 h-3.5" />Popular only{st ? ` · ${st.popular}` : ''}</button>
        </div>
      </div>
      {error ? <div className="p-4"><ErrorBox error={error} onRetry={reload} /></div> : !data ? <PageLoader /> : data.exercises.length === 0 ? (
        <Empty icon={<Dumbbell className="w-6 h-6" />} title="No exercises match" hint="Change the filters or search." />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 p-4">
            {data.exercises.map((e) => (
              <div key={e.id} onClick={() => admin && setEdit(e.id)} title={admin ? 'Edit exercise' : undefined}
                className={`rounded-3xl overflow-hidden border border-paper-line dark:border-ink-700 ${admin ? 'cursor-pointer hover:border-lime transition-colors' : ''} ${e.active ? '' : 'opacity-40'}`}>
                <div className="aspect-square bg-ink-900 relative">
                  {e.images[0] ? <img src={photo(e.images[0])} alt="" loading="lazy" className="w-full h-full object-cover bg-white" />
                    : <div className="w-full h-full flex items-center justify-center text-lime/60"><Dumbbell className="w-10 h-10" /></div>}
                  {e.tracking === 'time' && <span className="absolute top-2 left-2 badge bg-lime text-ink-900">Cardio</span>}
                  <div className="absolute bottom-2 left-2 flex gap-1">
                    {!!e.has_video && <span className="badge bg-black/60 text-white"><Video className="w-3 h-3" />Video</span>}
                    {e.source === 'gym' && <span className="badge bg-black/60 text-white">Gym</span>}
                  </div>
                  {admin && (
                    <div className="absolute top-2 right-2 flex gap-1" onClick={(ev) => ev.stopPropagation()}>
                      <button title={e.popular ? 'Remove from Popular' : 'Show in members’ Popular list'} onClick={() => patch(e, { popular: e.popular ? 0 : 1 })}
                        className={`w-8 h-8 rounded-full flex items-center justify-center ${e.popular ? 'bg-lime text-ink-900' : 'bg-black/50 text-white'}`}><Star className="w-4 h-4" fill={e.popular ? 'currentColor' : 'none'} /></button>
                      <button title={e.active ? 'Hide from members' : 'Show to members'} onClick={() => patch(e, { active: e.active ? 0 : 1 })}
                        className="w-8 h-8 rounded-full flex items-center justify-center bg-black/50 text-white">{e.active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                    </div>
                  )}
                </div>
                <div className="p-2.5">
                  <p className="text-sm font-semibold leading-tight line-clamp-2">{e.name}</p>
                  <p className="text-[11px] muted mt-1 truncate">{cap(e.target ?? e.body_part)} · {cap(e.equipment)}{e.uses ? ` · ${e.uses}× logged` : ''}</p>
                </div>
              </div>
            ))}
          </div>
          <Pager page={data.page} pages={data.pages} total={data.total} size={data.size} onPage={setPage} onSize={setSize} sizes={[24, 48, 96]} />
          <p className="text-[10px] muted px-4 pb-3">Exercise data: exercises-dataset (MIT) · Photos: free-exercise-db (public domain). Click an exercise to edit its details, photos, GIFs or video. ★ pins it to the members' Popular list; hidden exercises can't be picked in the app.</p>
        </>
      )}
      {edit && <ExerciseEditor id={edit} facets={facets} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />}
    </div>
  );
}

function ExerciseEditor({ id, facets, onClose, onSaved }: { id: string; facets: ExFacets | null; onClose: () => void; onSaved: () => void }) {
  const isNew = id === 'new';
  const { data, error, reload } = useLoad(() => (isNew ? Promise.resolve(null) : api.get<ExFull>(`/fitness/exercises/${encodeURIComponent(id)}`)), [id]);
  if (!isNew && !data) {
    return <Modal open onClose={onClose} title="Edit exercise" wide>{error ? <ErrorBox error={error} onRetry={reload} /> : <PageLoader />}</Modal>;
  }
  return <ExerciseForm ex={data} facets={facets} onClose={onClose} onSaved={onSaved} />;
}

const LEVELS = ['beginner', 'intermediate', 'expert'];
const CATEGORIES = ['strength', 'cardio', 'stretching', 'plyometrics', 'powerlifting', 'olympic weightlifting', 'strongman'];
const IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/gif';
const VIDEO_TYPES = 'video/mp4,video/webm';

function ExerciseForm({ ex, facets, onClose, onSaved }: { ex: ExFull | null; facets: ExFacets | null; onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const toast = useToast();
  const [uploading, setUploading] = useState<'images' | 'video' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [f, setF] = useState({
    name: ex?.name ?? '', body_part: ex?.body_part ?? '', target: ex?.target ?? '', secondary: (ex?.secondary ?? []).join(', '),
    equipment: ex?.equipment ?? '', category: ex?.category ?? 'strength', level: ex?.level ?? '', description: ex?.description ?? '',
    steps: (ex?.instructions ?? []).join('\n'), steps_hi: (ex?.instructions_hi ?? []).join('\n'),
    images: ex?.images ?? [], video: ex?.video ?? '', met: String(ex?.met ?? 5), tracking: ex?.tracking ?? 'sets',
    popular: !!ex?.popular, active: ex ? !!ex.active : true,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const lines = (s: string) => s.split('\n').map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);

  const upload = async (files: File[], kind: 'images' | 'video') => {
    if (!files.length) return;
    setUploading(kind);
    try {
      for (const file of files) {
        const max = file.type.startsWith('video/') ? 50 : file.type === 'image/gif' ? 15 : 8;
        if (file.size > max * 1_000_000) { toast('error', `${file.name} is over ${max} MB`); continue; }
        const { path } = await api.upload<{ path: string }>('/fitness/media', file);
        setF((x) => (kind === 'video' ? { ...x, video: path } : { ...x, images: [...x.images, path].slice(0, 10) }));
      }
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setUploading(null);
    }
  };

  const body = {
    name: f.name, body_part: f.body_part, target: f.target, equipment: f.equipment, category: f.category, level: f.level,
    secondary: f.secondary.split(',').map((s) => s.trim()).filter(Boolean), description: f.description,
    instructions: lines(f.steps), instructions_hi: lines(f.steps_hi), images: f.images, video: f.video.trim(),
    met: Number(f.met), tracking: f.tracking, popular: f.popular, active: f.active,
  };
  const save = () => run(() => (ex ? api.patch(`/fitness/exercises/${encodeURIComponent(ex.id)}`, body) : api.post('/fitness/exercises', body)),
    ex ? 'Exercise saved' : 'Exercise added').then((r) => r && onSaved());
  const remove = () => run(() => api.del(`/fitness/exercises/${encodeURIComponent(ex!.id)}`), 'Exercise deleted').then((r) => r && onSaved());
  const move = (i: number) => setF((x) => ({ ...x, images: [x.images[i], ...x.images.filter((_, j) => j !== i)] }));
  const yt = f.video && !isUpload(f.video) ? youtubeId(f.video) : null;

  return (
    <Modal open onClose={onClose} title={ex ? 'Edit exercise' : 'Add exercise'} wide
      footer={<>
        {ex?.source === 'gym' && <button className="btn btn-ghost text-bad mr-auto" onClick={() => setConfirmDelete(true)}><Trash2 className="w-4 h-4" />Delete</button>}
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !!uploading || !f.name.trim()} onClick={save}>{busy && <Spinner className="w-4 h-4" />}Save</button></>}>
      <datalist id="ex-body">{(facets?.body_parts ?? []).map((o) => o.value && <option key={o.value} value={o.value} />)}</datalist>
      <datalist id="ex-target">{(facets?.targets ?? []).map((o) => o.value && <option key={o.value} value={o.value} />)}</datalist>
      <datalist id="ex-equipment">{(facets?.equipment ?? []).map((o) => o.value && <option key={o.value} value={o.value} />)}</datalist>
      <datalist id="ex-category">{[...new Set([...CATEGORIES, ...(facets?.categories ?? []).map((o) => o.value)])].map((v) => v && <option key={v} value={v} />)}</datalist>

      <div className="space-y-5">
        {/* Media */}
        <div>
          <p className="label">Photos & GIFs <span className="muted font-normal">— the first one is the cover; several photos play as a slideshow</span></p>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {f.images.map((p, i) => (
              <div key={p} className="relative aspect-square rounded-2xl overflow-hidden border border-paper-line dark:border-ink-700 bg-white group">
                <img src={photo(p)} alt="" className="w-full h-full object-cover" />
                {i === 0 && <span className="absolute bottom-1 left-1 badge bg-lime text-ink-900">Cover</span>}
                {/\.gif$/.test(p) && <span className="absolute top-1 left-1 badge bg-black/60 text-white">GIF</span>}
                <div className="absolute top-1 right-1 flex gap-1">
                  {i > 0 && <button type="button" title="Make cover" onClick={() => move(i)} className="w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center"><Star className="w-3.5 h-3.5" /></button>}
                  <button type="button" title="Remove" onClick={() => setF((x) => ({ ...x, images: x.images.filter((_, j) => j !== i) }))}
                    className="w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center"><X className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
            {f.images.length < 10 && (
              <label className="aspect-square rounded-2xl border-2 border-dashed border-paper-line dark:border-ink-600 flex flex-col items-center justify-center gap-1 text-xs muted cursor-pointer hover:border-lime">
                {uploading === 'images' ? <Spinner /> : <><ImagePlus className="w-6 h-6" />Add photo / GIF</>}
                <input type="file" accept={IMAGE_TYPES} multiple className="hidden" disabled={!!uploading}
                  onChange={(e) => { void upload([...(e.target.files ?? [])], 'images'); e.target.value = ''; }} />
              </label>
            )}
          </div>
          <p className="text-[11px] muted mt-1">JPEG, PNG or WebP up to 8 MB · GIF up to 15 MB · up to 10 files. Use only media you own or have the right to use.</p>
        </div>

        <div>
          <p className="label">Video</p>
          {f.video && isUpload(f.video) ? (
            <div className="relative rounded-2xl overflow-hidden bg-black">
              <video src={photo(f.video)} controls playsInline preload="metadata" className="w-full max-h-72" />
              <button type="button" onClick={() => setF((x) => ({ ...x, video: '' }))} className="absolute top-2 right-2 btn btn-sm bg-black/60 text-white"><X className="w-3.5 h-3.5" />Remove</button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <input className="input flex-1 min-w-[220px]" placeholder="Paste a YouTube link (or any https:// video link)" value={f.video} onChange={set('video')} />
              <label className={`btn btn-outline cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                {uploading === 'video' ? <Spinner className="w-4 h-4" /> : <Upload className="w-4 h-4" />}Upload video
                <input type="file" accept={VIDEO_TYPES} className="hidden" onChange={(e) => { void upload(e.target.files?.[0] ? [e.target.files[0]] : [], 'video'); e.target.value = ''; }} />
              </label>
            </div>
          )}
          {yt && <div className="mt-2 aspect-video rounded-2xl overflow-hidden bg-black"><iframe src={`https://www.youtube-nocookie.com/embed/${yt}`} title="Video preview" className="w-full h-full" allowFullScreen /></div>}
          {f.video && !isUpload(f.video) && !yt && !/^https:\/\//.test(f.video.trim()) && <p className="text-[11px] text-bad mt-1">Link must start with https://</p>}
          <p className="text-[11px] muted mt-1">MP4 or WebM up to 50 MB. For longer videos, upload to YouTube (unlisted is fine) and paste the link.</p>
        </div>

        {/* Details */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" className="col-span-2"><input className="input" value={f.name} onChange={set('name')} placeholder="e.g. Incline Dumbbell Press" /></Field>
          <Field label="Body part"><input className="input" list="ex-body" value={f.body_part} onChange={set('body_part')} placeholder="chest" /></Field>
          <Field label="Main muscle"><input className="input" list="ex-target" value={f.target} onChange={set('target')} placeholder="pectorals" /></Field>
          <Field label="Other muscles" hint="Comma separated" className="col-span-2"><input className="input" value={f.secondary} onChange={set('secondary')} placeholder="triceps, delts" /></Field>
          <Field label="Equipment"><input className="input" list="ex-equipment" value={f.equipment} onChange={set('equipment')} placeholder="dumbbell" /></Field>
          <Field label="Type"><input className="input" list="ex-category" value={f.category} onChange={set('category')} /></Field>
          <Field label="Level"><select className="input" value={f.level} onChange={set('level')}><option value="">Not set</option>{LEVELS.map((l) => <option key={l} value={l}>{cap(l)}</option>)}</select></Field>
          <Field label="Members log it as"><select className="input" value={f.tracking} onChange={set('tracking')}><option value="sets">Sets × reps × kg</option><option value="time">Minutes (cardio)</option></select></Field>
          <Field label="MET" hint="Effort for calorie estimates: ~3 light, 5 weights, 8+ hard cardio"><input className="input" inputMode="decimal" value={f.met} onChange={set('met')} /></Field>
          <div className="flex flex-col justify-center gap-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-lime w-4 h-4" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Visible to members</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-lime w-4 h-4" checked={f.popular} onChange={(e) => setF({ ...f, popular: e.target.checked })} />Show in Popular list</label>
          </div>
        </div>

        <Field label="Description" hint="Short intro shown above the steps — what it works, key tips, common mistakes.">
          <textarea className="input min-h-[90px] py-3" value={f.description} onChange={set('description')} />
        </Field>
        <Field label="How to do it — English" hint="One step per line.">
          <textarea className="input min-h-[140px] py-3" value={f.steps} onChange={set('steps')} />
        </Field>
        <Field label="How to do it — Hindi (optional)" hint="One step per line. Leave empty to show English only.">
          <textarea className="input min-h-[100px] py-3" value={f.steps_hi} onChange={set('steps_hi')} />
        </Field>
        {ex && <p className="text-[11px] muted">{ex.uses ? `Logged ${ex.uses}× by members — their past logs keep the old name if you rename it.` : 'Not logged by any member yet.'}{ex.source !== 'gym' && ' Built-in exercise: it can be hidden but not deleted.'}</p>}
      </div>
      <Confirm open={confirmDelete} danger title="Delete exercise?" confirmLabel="Delete" busy={busy} onClose={() => setConfirmDelete(false)} onConfirm={remove}
        message={<>“{ex?.name}” will be removed from the library. Members' past workouts keep their entries.</>} />
    </Modal>
  );
}
