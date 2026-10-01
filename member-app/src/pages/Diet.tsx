import { useEffect, useMemo, useState } from 'react';
import { ChefHat, Clock, Copy, GlassWater, Info, Plus, Search, Trash2, Users } from 'lucide-react';
import { api } from '../lib/api';
import { todayLocal } from '../lib/format';
import { DIET_LABEL, MEALS, foodImg, mealNow, vegFilterFor, type Day, type Food, type FoodDetail, type Meal } from '../lib/fit';
import { useFit } from '../lib/fitctx';
import CoachLink from '../components/CoachLink';
import { ErrorBox, Field, PageLoader, Ring, Sheet, Spinner, useAction, useLoad } from '../components/ui';
import { Credits, DateStrip, MacroBar, Stepper } from '../components/fit-ui';

const yesterday = (d: string) => new Date(Date.parse(d + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);

export default function Diet() {
  const [date, setDate] = useState(todayLocal());
  const { data: d, error, reload } = useLoad(() => api.get<Day>(`/fit/day?date=${date}`), [date]);
  const [adding, setAdding] = useState<Meal | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const { run } = useAction();
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl sm:text-3xl font-bold pt-1">Diet</h1>
      <CoachLink kind="diet" />
      <DateStrip value={date} onChange={setDate} />
      {!d ? <PageLoader /> : <>
        <CalorieCard d={d} />
        <WaterCard d={d} onChange={reload} />
        {MEALS.map((m) => {
          const meal = d.meals[m.key];
          return (
            <section key={m.key} className="card overflow-hidden">
              <div className="flex items-center gap-3 px-4 pt-4 pb-2">
                <span className="text-2xl">{m.emoji}</span>
                <div className="flex-1"><p className="font-semibold">{m.label}</p><p className="text-xs muted">{Math.round(meal.kcal)} kcal · P {Math.round(meal.protein)} · C {Math.round(meal.carbs)} · F {Math.round(meal.fat)}</p></div>
                <button className="btn btn-primary btn-sm" onClick={() => setAdding(m.key)}><Plus className="w-4 h-4" />Add</button>
              </div>
              {meal.items.length === 0 ? (
                <button className="w-full text-left px-4 pb-4 text-xs muted flex items-center gap-1.5 hover:underline"
                  onClick={() => run(() => api.post<{ copied: number }>('/fit/food-logs/copy', { date, from_date: yesterday(date), meal: m.key })).then((r) => { if (r?.copied) void reload(); })}>
                  <Copy className="w-3.5 h-3.5" />Same as yesterday
                </button>
              ) : (
                <ul className="pb-1">
                  {meal.items.map((it) => (
                    <li key={it.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-paper-line dark:border-ink-700">
                      {it.image && <img src={foodImg(it.image, true)!} alt="" loading="lazy" width={40} height={30} className="w-10 h-[30px] rounded-lg object-cover shrink-0" />}
                      <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{it.name}</p><p className="text-xs muted">{Math.round(it.grams)} g · P {it.protein} · C {it.carbs} · F {it.fat}</p></div>
                      <p className="font-display font-bold text-sm">{Math.round(it.kcal)}</p>
                      {it.food_id && (it.has_recipe || it.image) ? <DetailsButton recipe={!!it.has_recipe} onClick={() => setViewing(it.food_id)} /> : null}
                      <button className="icon-btn w-8 h-8 muted" aria-label="Remove" onClick={() => run(() => api.del(`/fit/food-logs/${it.id}`)).then(reload)}><Trash2 className="w-4 h-4" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
        <Credits />
      </>}
      {adding && <FoodSheet date={date} meal={adding} onClose={() => setAdding(null)} onAdded={() => { void reload(); }} />}
      {viewing && <FoodDetailSheet foodId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function CalorieCard({ d }: { d: Day }) {
  const { fit, edit } = useFit();
  const t = d.targets;
  if (!t?.kcal) {
    return (
      <div className="card card-pad text-sm flex items-center gap-3">
        <span className="flex-1">Set up your profile to get a daily calorie & protein target.</span>
        <button className="btn btn-primary btn-sm" onClick={edit}>Set up</button>
      </div>
    );
  }
  const budget = t.kcal + d.burned;
  const pct = budget ? (d.eaten.kcal / budget) * 100 : 0;
  const over = d.remaining !== null && d.remaining < 0;
  return (
    <section className="card-ink p-5">
      <div className="flex items-center gap-5">
        <Ring value={pct} size={128} stroke={12} tone={over ? 'bad' : 'lime'}>
          <div><p className="font-display text-3xl font-bold text-white leading-none">{Math.abs(Math.round(d.remaining ?? 0))}</p><p className="text-[11px] text-ink-300 mt-1">{over ? 'kcal over' : 'kcal left'}</p></div>
        </Ring>
        <div className="flex-1 grid grid-cols-1 gap-2 text-sm">
          <Row k="Goal" v={t.kcal} />
          <Row k="Food" v={`− ${Math.round(d.eaten.kcal)}`} />
          <Row k="Exercise" v={`+ ${Math.round(d.burned)}`} accent />
          <div className="border-t border-white/10 pt-2"><Row k="Remaining" v={Math.round(d.remaining ?? 0)} bold /></div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 mt-5 [&_.muted]:text-ink-300 text-white">
        <MacroBar label="Protein" value={d.eaten.protein} target={t.protein_g} color="#C8F135" />
        <MacroBar label="Carbs" value={d.eaten.carbs} target={t.carbs_g} color="#4DA3FF" />
        <MacroBar label="Fat" value={d.eaten.fat} target={t.fat_g} color="#F5A524" />
      </div>
      {!!fit?.profile?.diet_prefs?.length && <p className="text-[11px] text-ink-400 mt-3">Food search starts filtered for: {fit.profile.diet_prefs.map((d) => DIET_LABEL[d] ?? d).join(' + ')}. Change it in Me → Fitness profile.</p>}
    </section>
  );
}

const Row = ({ k, v, accent, bold }: { k: string; v: React.ReactNode; accent?: boolean; bold?: boolean }) => (
  <div className="flex justify-between"><span className="text-ink-300">{k}</span><span className={`${bold ? 'font-display font-bold text-white' : 'text-white'} ${accent ? 'text-lime' : ''}`}>{v}</span></div>
);

const GLASS_ML = 250;
const WATER_MAX_ML = 5000; // 20 glasses

function WaterCard({ d, onChange }: { d: Day; onChange: () => void }) {
  const { run } = useAction();
  const target = Math.min(WATER_MAX_ML, d.targets?.water_ml ?? 2500);
  const targetGlasses = Math.ceil(target / GLASS_ML);
  const filled = Math.round(d.water_ml / GLASS_ML);
  const setGlasses = (n: number) => run(() => api.put('/fit/water', { date: d.date, ml: Math.max(0, n) * GLASS_ML })).then(onChange);
  return (
    <section className="card card-pad">
      <div className="flex items-center justify-between mb-3">
        <p className="font-semibold flex items-center gap-2"><GlassWater className="w-5 h-5 text-info" />Water</p>
        <p className="text-sm"><b>{(d.water_ml / 1000).toFixed(2)}</b> <span className="muted">/ {(target / 1000).toFixed(1)} L goal</span></p>
      </div>
      <div className="grid grid-cols-10 gap-1.5">
        {Array.from({ length: WATER_MAX_ML / GLASS_ML }, (_, i) => (
          <button key={i} aria-label={`${i + 1} glasses`} onClick={() => setGlasses(i + 1 === filled ? i : i + 1)}
            className={`h-10 rounded-b-xl rounded-t-md border-2 transition ${i < filled ? 'bg-info/80 border-info' : i < targetGlasses ? 'border-info/40 hover:border-info' : 'border-dashed border-paper-line dark:border-ink-600 hover:border-info'}`} />
        ))}
      </div>
      <p className="text-[11px] muted mt-2">Tap a glass (250 ml) to fill up to it; tap the last one again to undo. Solid outlines are your goal; dashed ones go up to 5 L.</p>
    </section>
  );
}

function FoodSheet({ date, meal: initialMeal, onClose, onAdded }: { date: string; meal: Meal; onClose: () => void; onAdded: () => void }) {
  const { fit } = useFit();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [veg, setVeg] = useState<'' | 'veg' | 'egg'>(vegFilterFor(fit?.profile?.diet_prefs));
  const [pick, setPick] = useState<Food | null>(null);
  const [info, setInfo] = useState<Food | null>(null);
  const [custom, setCustom] = useState(false);
  const [meal, setMeal] = useState<Meal>(initialMeal ?? mealNow());
  const [added, setAdded] = useState(0);
  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  const { data } = useLoad(() => api.get<{ recent: Food[]; results: Food[] }>(`/fit/foods?q=${encodeURIComponent(debounced)}${veg ? `&veg=${veg}` : ''}`), [debounced, veg]);

  if (custom) return <CustomFoodSheet onClose={() => setCustom(false)} onCreated={(f) => { setCustom(false); setPick(f); }} />;
  // Details can open from the list or from the amount step; closing returns to whichever was under it.
  if (info) return <FoodDetailSheet foodId={info.id} onClose={() => setInfo(null)} onAdd={() => { setPick(info); setInfo(null); }} />;
  if (pick) return <AmountSheet food={pick} date={date} meal={meal} setMeal={setMeal} onBack={() => setPick(null)} onInfo={() => setInfo(pick)} onAdded={() => { setAdded(added + 1); setPick(null); setQ(''); onAdded(); }} />;

  return (
    <Sheet open onClose={onClose} title={`Add to ${MEALS.find((m) => m.key === meal)?.label}`}>
      <div className="relative mb-3">
        <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 muted" />
        <input className="input pl-11" autoFocus placeholder="Search roti, dal, egg, chicken, dosa…" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
      </div>
      <div className="flex gap-2 mb-3">
        {([['', 'All'], ['veg', '🟢 Veg'], ['egg', '🟡 Veg + egg']] as const).map(([k, l]) => <button key={k} className={`chip ${veg === k ? 'chip-on' : ''}`} onClick={() => setVeg(k)}>{l}</button>)}
      </div>
      {added > 0 && <p className="text-xs text-lime-700 dark:text-lime font-semibold mb-2">✓ {added} item{added > 1 ? 's' : ''} added — keep adding or close.</p>}
      {!data ? <div className="py-8 flex justify-center"><Spinner /></div> : <>
        {!debounced && data.recent.length > 0 && <FoodList title="Recent" foods={data.recent} onPick={setPick} onInfo={setInfo} />}
        <FoodList title={debounced ? `Results for “${debounced}”` : 'Popular'} foods={data.results} onPick={setPick} onInfo={setInfo} />
        {debounced && data.results.length === 0 && <p className="text-sm muted py-4 text-center">No match. Try a simpler word, or add it yourself.</p>}
      </>}
      <button className="btn btn-outline w-full mt-3" onClick={() => setCustom(true)}><Plus className="w-4 h-4" />Create a custom food</button>
    </Sheet>
  );
}

const vegDot = (v: Food['veg']) => (v === 'nonveg' ? 'bg-bad' : v === 'egg' ? 'bg-warn' : 'bg-ok');

function FoodList({ title, foods, onPick, onInfo }: { title: string; foods: Food[]; onPick: (f: Food) => void; onInfo: (f: Food) => void }) {
  if (!foods.length) return null;
  return (
    <div className="mb-2">
      <p className="text-xs font-semibold muted mb-1">{title}</p>
      <ul className="-mx-2">
        {foods.map((f) => (
          <li key={f.id} className="flex items-center rounded-2xl hover:bg-black/5 dark:hover:bg-white/5">
            <button className="flex-1 min-w-0 flex items-center gap-3 px-2 py-2.5 text-left" onClick={() => onPick(f)}>
              {f.image ? (
                <span className="relative shrink-0">
                  <img src={foodImg(f.image, true)!} alt="" loading="lazy" width={48} height={36} className="w-12 h-9 rounded-lg object-cover bg-black/5" />
                  <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-sm ring-2 ring-white dark:ring-ink-800 ${vegDot(f.veg)}`} />
                </span>
              ) : <span className={`w-2.5 h-2.5 rounded-sm shrink-0 ${vegDot(f.veg)}`} title={f.veg ?? ''} />}
              <span className="flex-1 min-w-0"><span className="block text-sm font-medium truncate">{f.name}</span>
                <span className="text-xs muted">{f.serving_label} · {Math.round((f.kcal * f.serving_g) / 100)} kcal{f.owner_member_id ? ' · mine' : ''}</span></span>
              <Plus className="w-4 h-4 muted shrink-0" />
            </button>
            {(f.has_recipe || f.image) ? <DetailsButton recipe={!!f.has_recipe} onClick={() => onInfo(f)} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** ⓘ / chef-hat button that opens a food's details (photo, nutrition, recipe). */
function DetailsButton({ recipe, onClick }: { recipe: boolean; onClick: () => void }) {
  return (
    <button className="icon-btn w-9 h-9 shrink-0 muted hover:text-lime-700 dark:hover:text-lime" onClick={onClick}
      aria-label={recipe ? 'Recipe & details' : 'Details'} title={recipe ? 'Recipe & details' : 'Details'}>
      {recipe ? <ChefHat className="w-[18px] h-[18px]" /> : <Info className="w-[18px] h-[18px]" />}
    </button>
  );
}

/** Photo, nutrition per serving and the home recipe. onAdd shows an "Add" button (from the food search). */
function FoodDetailSheet({ foodId, onClose, onAdd }: { foodId: number; onClose: () => void; onAdd?: () => void }) {
  const { data: f, error, reload } = useLoad(() => api.get<FoodDetail>(`/fit/foods/${foodId}`), [foodId]);
  const per = (v: number) => Math.round(((v * (f?.serving_g ?? 100)) / 100) * 10) / 10;
  return (
    <Sheet open onClose={onClose} title={f?.name ?? 'Food details'}
      footer={onAdd && f ? <button className="btn btn-primary btn-lg w-full" onClick={onAdd}><Plus className="w-4 h-4" />Add to meal</button> : undefined}>
      {error ? <ErrorBox error={error} onRetry={reload} /> : !f ? <div className="py-10 flex justify-center"><Spinner /></div> : (
        <div className="space-y-4">
          {f.image && (
            <figure>
              <img src={foodImg(f.image)!} alt={f.name} width={480} height={360} className="w-full aspect-[4/3] object-cover rounded-3xl bg-black/5" />
              {f.image_credit && <figcaption className="text-[10px] muted mt-1 px-1">Photo: {f.image_credit}</figcaption>}
            </figure>
          )}
          <div className="rounded-3xl bg-lime/15 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold flex items-center gap-2"><span className={`w-2.5 h-2.5 rounded-sm ${vegDot(f.veg)}`} />{f.serving_label}</p>
              <p><span className="font-display text-3xl font-bold">{Math.round(per(f.kcal))}</span> <span className="text-xs muted">kcal</span></p>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3 text-center text-sm">
              <div className="rounded-2xl bg-white/70 dark:bg-ink-800 py-2"><b>{per(f.protein)} g</b><p className="text-[11px] muted">Protein</p></div>
              <div className="rounded-2xl bg-white/70 dark:bg-ink-800 py-2"><b>{per(f.carbs)} g</b><p className="text-[11px] muted">Carbs</p></div>
              <div className="rounded-2xl bg-white/70 dark:bg-ink-800 py-2"><b>{per(f.fat)} g</b><p className="text-[11px] muted">Fat</p></div>
            </div>
            <p className="text-[11px] muted mt-2">Per 100 g: {f.kcal} kcal · P {f.protein} · C {f.carbs} · F {f.fat}{f.fiber != null ? ` · fibre ${f.fiber}` : ''}</p>
          </div>
          {f.ingredients.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold flex items-center gap-2"><ChefHat className="w-4 h-4" />Ingredients</h3>
                <p className="text-xs muted flex items-center gap-3">
                  {f.recipe_serves ? <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />Serves {f.recipe_serves}</span> : null}
                  {f.recipe_min ? <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{f.recipe_min} min</span> : null}
                </p>
              </div>
              <ul className="space-y-1.5 text-sm">
                {f.ingredients.map((x, i) => <li key={i} className="flex gap-2"><span className="text-lime-700 dark:text-lime">•</span><span>{x}</span></li>)}
              </ul>
            </section>
          )}
          {f.steps.length > 0 && (
            <section>
              <h3 className="font-semibold mb-2">How to make it</h3>
              <ol className="space-y-2.5 text-sm">
                {f.steps.map((x, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="w-6 h-6 rounded-full bg-ink-900 text-white dark:bg-lime dark:text-ink-900 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                    <span className="pt-0.5">{x}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {f.steps.length > 0 && <p className="text-[11px] muted">Nutrition is estimated for this home-style recipe; restaurant versions usually have more oil. Weigh your plate for the most accurate log.</p>}
        </div>
      )}
    </Sheet>
  );
}

function AmountSheet({ food, date, meal, setMeal, onBack, onInfo, onAdded }: { food: Food; date: string; meal: Meal; setMeal: (m: Meal) => void; onBack: () => void; onInfo: () => void; onAdded: () => void }) {
  const [mode, setMode] = useState<'serving' | 'grams'>(food.serving_g === 100 && food.serving_label === '100 g' ? 'grams' : 'serving');
  const [servings, setServings] = useState(1);
  const [grams, setGrams] = useState(food.serving_g);
  const { busy, run } = useAction();
  const g = mode === 'serving' ? servings * food.serving_g : grams;
  const m = useMemo(() => ({ kcal: Math.round((food.kcal * g) / 100), p: Math.round(food.protein * g) / 100, c: Math.round(food.carbs * g) / 100, f: Math.round(food.fat * g) / 100 }), [food, g]);
  return (
    <Sheet open onClose={onBack} title={food.name}
      footer={<button className="btn btn-primary btn-lg w-full" disabled={busy || !(g > 0)} onClick={() =>
        run(() => api.post('/fit/food-logs', { date, meal, food_id: food.id, grams: g }), `Added ${food.name}`).then((r) => r && onAdded())}>
        {busy && <Spinner className="w-4 h-4" />}Add {m.kcal} kcal</button>}>
      <div className="text-center rounded-3xl bg-lime/15 py-5 mb-4">
        <p className="font-display text-5xl font-bold">{m.kcal}</p><p className="text-xs muted">kcal · {Math.round(g)} g</p>
        <div className="flex justify-center gap-5 mt-3 text-sm"><span>P <b>{m.p.toFixed(1)}</b></span><span>C <b>{m.c.toFixed(1)}</b></span><span>F <b>{m.f.toFixed(1)}</b></span></div>
      </div>
      <div className="flex rounded-full bg-black/5 dark:bg-white/5 p-1 mb-4">
        {(['serving', 'grams'] as const).map((k) => <button key={k} className={`flex-1 h-9 rounded-full text-sm font-semibold ${mode === k ? 'bg-ink-900 text-white dark:bg-lime dark:text-ink-900' : ''}`} onClick={() => setMode(k)}>{k === 'serving' ? 'Servings' : 'Grams'}</button>)}
      </div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <span className="text-sm">{mode === 'serving' ? food.serving_label : 'Amount'}</span>
        {mode === 'serving' ? <Stepper value={servings} onChange={setServings} step={0.5} /> : <Stepper value={grams} onChange={setGrams} step={10} suffix="g" />}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {MEALS.map((x) => <button key={x.key} className={`chip justify-center ${meal === x.key ? 'chip-on' : ''}`} onClick={() => setMeal(x.key)}>{x.label}</button>)}
      </div>
      <p className="text-[11px] muted mt-4">Values per 100 g: {food.kcal} kcal · P {food.protein} · C {food.carbs} · F {food.fat}. {food.source === 'indb' || food.source === 'cg' ? 'Home-style recipe estimate.' : ''}</p>
      <div className="flex items-center justify-between mt-2">
        <button className="btn btn-ghost btn-sm -ml-3" onClick={onBack}>← Back to search</button>
        {(food.has_recipe || food.image) ? <button className="btn btn-ghost btn-sm -mr-3" onClick={onInfo}>{food.has_recipe ? <><ChefHat className="w-4 h-4" />Recipe & photo</> : <><Info className="w-4 h-4" />Details</>}</button> : null}
      </div>
    </Sheet>
  );
}

function CustomFoodSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (f: Food) => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ name: '', serving_label: '1 serving', serving_g: '100', kcal: '', protein: '', carbs: '', fat: '', veg: 'veg' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = () => run(() => api.post<{ id: number }>('/fit/foods', { ...f, per: 'serving', serving_label: `${f.serving_label} (${f.serving_g} g)` }), 'Saved to your foods')
    .then((r) => {
      if (!r) return;
      const sg = Number(f.serving_g) || 100, k = 100 / sg;
      onCreated({ id: r.id, name: f.name, kcal: Number(f.kcal) * k, protein: Number(f.protein || 0) * k, carbs: Number(f.carbs || 0) * k, fat: Number(f.fat || 0) * k,
        serving_g: sg, serving_label: `${f.serving_label} (${sg} g)`, veg: f.veg as Food['veg'], source: 'custom', owner_member_id: 1 });
    });
  return (
    <Sheet open onClose={onClose} title="Custom food"
      footer={<button className="btn btn-primary btn-lg w-full" disabled={busy || !f.name || !f.kcal} onClick={save}>Save & add</button>}>
      <div className="space-y-3">
        <Field label="Name"><input className="input" value={f.name} onChange={set('name')} placeholder="Mom's chicken curry" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Serving"><input className="input" value={f.serving_label} onChange={set('serving_label')} /></Field>
          <Field label="Serving weight (g)"><input className="input" inputMode="decimal" value={f.serving_g} onChange={set('serving_g')} /></Field>
        </div>
        <p className="text-xs muted">Nutrition for <b>one serving</b> (check the pack label):</p>
        <div className="grid grid-cols-4 gap-2">
          {(['kcal', 'protein', 'carbs', 'fat'] as const).map((k) => <Field key={k} label={k === 'kcal' ? 'kcal' : `${k} g`}><input className="input px-3" inputMode="decimal" value={f[k]} onChange={set(k)} /></Field>)}
        </div>
        <Field label="Type"><select className="input" value={f.veg} onChange={set('veg')}><option value="veg">Veg</option><option value="egg">Contains egg</option><option value="nonveg">Non-veg</option></select></Field>
      </div>
    </Sheet>
  );
}
