// AI coach: builds a diet plan (day / week) and a workout plan (day / 3 days / week) for the member.
// The model chooses foods/exercises from shortlists taken from our catalog; lib/planner.ts owns the
// structure (balanced split, exercise order, sets/reps) and the calorie maths, so a plan is always
// usable even when a model answers badly. Items are ticked off by logging them to the diet/workout log.
import { Hono } from 'hono';
import type { AppEnv, Env } from '../../env';
import { requireMember } from '../../lib/auth';
import { all, assert, first, int, run, str } from '../../lib/db';
import { addDays, isDate } from '../../lib/dates';
import { askClef, askJson, clefChoice, CLEF_MODEL, modelsFor, type ChatMessage, type ClefQuestion } from '../../lib/ai';
import { exerciseCatalog, foodCatalog } from '../../lib/catalog';
import { ageFromBirthYear, bmi, bmiCategory, round, type Goal } from '../../lib/fitness';
import { logFood, logWorkout, MEAL_KEYS } from '../../lib/fitlog';
import {
  DAY_TITLE, FOCUSES, JOINT_LABEL, MEAL_SPLIT, MUSCLES, SLOTS, avoidPattern, balanceDay, dayTotals, daySlots, dietCandidates, guardSlots, isProteinFood, macrosFor, mealIssues, mealRoles,
  mergeDuplicates, partitionDishes, planDays, prescribe, readRequest, requestedDay, withoutAvoided, dietFromText, JOINT_MUSCLES, requestedTitle, resolvePicks, roundGrams, scaleDay, slotCandidates,
  type DayType, type ExCandidate, type FoodCandidate, type Joint, type Muscle, type PlannedFood,
} from '../../lib/planner';
import { loadProfile, todayFor, type Profile } from './fitness';

export const coach = new Hono<AppEnv>();
coach.use('*', requireMember());

const mid = (c: { get: (k: 'session') => { mid: number | null } }) => c.get('session').mid!;

/** AI requests (plan builds) per member per day. Failed builds are not counted. */
const DAILY_LIMIT = 5;
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekday = (d: string) => WEEKDAY[new Date(d + 'T00:00:00Z').getUTCDay()];
const GOAL_TEXT: Record<Goal, string> = {
  lose_weight: 'lose fat / weight', gain_weight: 'gain weight', build_muscle: 'build muscle', maintain: 'maintain weight & stay fit', get_fit: 'improve overall fitness',
};
/** Daily diet tips used when the plan comes from Clef (a decision model writes no prose). */
const DIET_TIPS = [
  'Drink a glass of water before each meal and aim for 3–4 litres through the day.',
  'Eat your protein first at lunch and dinner — it keeps you full longer.',
  'Prep tomorrow’s breakfast tonight so a busy morning does not push you to skip it.',
  'Fill half your plate with vegetables at lunch and dinner.',
  'Have dinner 2–3 hours before bed for better sleep and digestion.',
  'Cook with measured oil — 1 teaspoon is about 45 kcal.',
  'If you train in the evening, keep the snack 60–90 minutes before your workout.',
];
const DIET_TEXT: Record<string, string> = { veg: 'vegetarian', egg: 'eggs allowed', nonveg: 'non-vegetarian', vegan: 'vegan (no dairy, no egg)' };
const DAY_TIP: Record<DayType, string> = {
  full: 'Leave 1–2 reps in the tank on every set and keep your form strict.',
  push: 'Keep your shoulder blades pinned back on every press.',
  pull: 'Lead with your elbows and squeeze your back at the top of each rep.',
  legs: 'Push your knees out and keep your chest up — depth before weight.',
  upper: 'Alternate pushing and pulling moves to keep your shoulders balanced.',
  lower: 'Brace your core before every rep and control the way down.',
  cardio_core: 'Keep cardio at a pace where you can still talk in short sentences.',
  custom: 'Start each exercise with a lighter warm-up set, then work at a weight that leaves 1–2 good reps in reserve.',
  rest: 'Recovery is when muscle grows — walk, stretch, sleep 7–8 hours and drink water.',
};

interface PlanRow { id: number; kind: 'diet' | 'workout'; span: string; start_day: string; days: number; meta: string | null; model: string | null; created_at: string }
interface DayMeta { title?: string; type?: DayType; tip?: string | null; rest?: boolean }
interface PlanMeta { note?: string | null; request?: Record<string, unknown>; days?: Record<string, DayMeta> }

function profileLine(p: Profile, sex: string | null, today: string) {
  const age = p.birth_year ? ageFromBirthYear(p.birth_year, today) : null;
  const b = p.height_cm && p.weight_kg ? bmi(p.weight_kg, p.height_cm) : null;
  return [age ? `${age} y` : null, sex, p.weight_kg ? `${p.weight_kg} kg` : null, p.height_cm ? `${p.height_cm} cm` : null,
    b ? `BMI ${b} (${bmiCategory(b).label})` : null, p.target_weight_kg ? `target weight ${p.target_weight_kg} kg` : null,
    p.goal ? `goal: ${GOAL_TEXT[p.goal]}` : null, p.activity ? `activity: ${p.activity.replace('_', ' ')}` : null].filter(Boolean).join(', ');
}

async function checkQuota(env: Env, memberId: number, today: string) {
  const u = await first<{ n: number }>(env.DB, `SELECT n FROM coach_usage WHERE member_id=? AND day=?`, memberId, today);
  assert((u?.n ?? 0) < DAILY_LIMIT, 429, `You have used all ${DAILY_LIMIT} AI coach requests for today — please try again tomorrow.`);
}
const countUse = (env: Env, memberId: number, today: string) =>
  run(env.DB, `INSERT INTO coach_usage (member_id, day, n) VALUES (?, ?, 1) ON CONFLICT(member_id, day) DO UPDATE SET n=n+1`, memberId, today);

/**
 * What the member asked for: muscles to train and joints/regions to protect. Keyword rules always
 * run. Clef-flash (when enabled for workouts) also reads the request: its "pain / can't train"
 * answers are always added, its muscle answers only when the keywords found none — and a painful
 * region always wins over a request ("back and biceps, leg pain" never becomes a leg day).
 */
async function understandRequest(env: Env, notes: string | null, useClef: boolean): Promise<{ muscles: Muscle[]; avoid: Joint[] }> {
  const kw = readRequest(notes);
  if (!notes || !useClef) return kw;
  const q: Record<string, ClefQuestion> = {};
  for (const [m, def] of Object.entries(MUSCLES)) {
    q[`m_${m}`] = { type: 'noul', instructions: `Does the member ask to TRAIN their ${def.label} in this workout? Answer no if they only mention pain, an injury or that they cannot train it.` };
  }
  for (const [j, label] of Object.entries(JOINT_LABEL)) {
    q[`j_${j}`] = { type: 'noul', instructions: `Does the member say their ${label} hurt, are injured, or that they cannot or should not train their ${label}?` };
  }
  try {
    const a = await askClef(env, `A gym member wrote this request for their workout plan: "${notes}"`, q);
    const muscles = new Set<Muscle>(kw.muscles);
    const avoid = new Set<Joint>(kw.avoid);
    if (!kw.muscles.length) for (const m of Object.keys(MUSCLES) as Muscle[]) if ((a[`m_${m}`]?.noul ?? 0) >= 0.8) muscles.add(m);
    // Clef's pain answers never cancel muscles the member explicitly asked for ("leg day, knee pain" stays a leg day without knee-loading moves).
    const asked = new Set(kw.muscles);
    for (const j of Object.keys(JOINT_LABEL) as Joint[]) {
      if ((a[`j_${j}`]?.noul ?? 0) >= 0.6 && !JOINT_MUSCLES[j].some((m) => asked.has(m))) avoid.add(j);
    }
    return withoutAvoided([...muscles], [...avoid]);
  } catch {
    return kw;
  }
}
/** Replace the member's current plan of this kind with a new one (old items' logs stay in the diary). */
async function savePlan(env: Env, memberId: number, kind: 'diet' | 'workout', span: string, start: string, days: number, meta: PlanMeta, model: string,
  items: Record<string, unknown>[]) {
  await run(env.DB, `DELETE FROM coach_plans WHERE member_id=? AND kind=?`, memberId, kind);
  const plan = await first<{ id: number }>(env.DB,
    `INSERT INTO coach_plans (member_id, kind, span, start_day, days, meta, model) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    memberId, kind, span, start, days, JSON.stringify(meta), model);
  const cols = ['day', 'slot', 'pos', 'food_id', 'exercise_id', 'name', 'grams', 'kcal', 'protein', 'carbs', 'fat', 'sets', 'reps', 'rest_s', 'minutes'];
  const stmt = env.DB.prepare(`INSERT INTO coach_plan_items (plan_id, ${cols.join(', ')}) VALUES (?${', ?'.repeat(cols.length)})`);
  if (items.length) await env.DB.batch(items.map((it) => stmt.bind(plan!.id, ...cols.map((k) => it[k] ?? null))));
}

// ── Read ────────────────────────────────────────────────────────────────
interface ItemRow {
  id: number; plan_id: number; day: string; slot: string; pos: number; food_id: number | null; exercise_id: string | null; name: string;
  grams: number | null; kcal: number | null; protein: number | null; carbs: number | null; fat: number | null;
  sets: number | null; reps: string | null; rest_s: number | null; minutes: number | null; log_id: number | null; done: number;
  serving_g?: number | null; serving_label?: string | null; veg?: string | null; food_image?: string | null;
  images?: string | null; target?: string | null; equipment?: string | null; tracking?: string | null;
}

async function planView(env: Env, memberId: number, kind: 'diet' | 'workout') {
  const plan = await first<PlanRow>(env.DB, `SELECT * FROM coach_plans WHERE member_id=? AND kind=? ORDER BY id DESC LIMIT 1`, memberId, kind);
  if (!plan) return { plan: null, days: [] };
  const items = kind === 'diet'
    ? await all<ItemRow>(env.DB,
      `SELECT i.*, (l.id IS NOT NULL) AS done, f.serving_g, f.serving_label, f.veg, f.image AS food_image FROM coach_plan_items i
       LEFT JOIN food_logs l ON l.id=i.log_id AND l.member_id=? LEFT JOIN foods f ON f.id=i.food_id
       WHERE i.plan_id=? ORDER BY i.day, i.pos, i.id`, memberId, plan.id)
    : await all<ItemRow>(env.DB,
      `SELECT i.*, (l.id IS NOT NULL) AS done, e.images, e.target, e.equipment, e.tracking FROM coach_plan_items i
       LEFT JOIN workout_logs l ON l.id=i.log_id AND l.member_id=? LEFT JOIN exercises e ON e.id=i.exercise_id
       WHERE i.plan_id=? ORDER BY i.day, i.pos, i.id`, memberId, plan.id);
  const meta: PlanMeta = plan.meta ? JSON.parse(plan.meta) : {};
  type Macros = { kcal: number | null; protein: number | null; carbs: number | null; fat: number | null };
  const sum = (rows: Macros[]) => ({
    kcal: round(rows.reduce((s, r) => s + (r.kcal ?? 0), 0)), protein: round(rows.reduce((s, r) => s + (r.protein ?? 0), 0), 1),
    carbs: round(rows.reduce((s, r) => s + (r.carbs ?? 0), 0), 1), fat: round(rows.reduce((s, r) => s + (r.fat ?? 0), 0), 1),
  });
  const days = Array.from({ length: plan.days }, (_, i) => {
    const day = addDays(plan.start_day, i);
    const rows = items.filter((r) => r.day === day).map((r) => ({
      ...r, done: !!r.done, images: r.images ? JSON.parse(r.images) as string[] : [], slot_label: kind === 'workout' ? SLOTS[r.slot]?.label ?? r.slot : undefined,
    }));
    const dm = meta.days?.[day] ?? {};
    return {
      day, title: dm.title ?? null, type: dm.type ?? null, tip: dm.tip ?? null, rest: !!dm.rest, items: rows,
      done: rows.filter((r) => r.done).length,
      ...(kind === 'diet' ? { planned: sum(rows), eaten: sum(rows.filter((r) => r.done)) } : {}),
    };
  });
  return {
    plan: { id: plan.id, kind: plan.kind, span: plan.span, start_day: plan.start_day, days: plan.days, model: plan.model, created_at: plan.created_at, note: meta.note ?? null, request: meta.request ?? {} },
    days,
  };
}

const kindParam = (v: string) => {
  assert(v === 'diet' || v === 'workout', 404, 'Not found');
  return v;
};

coach.get('/:kind', async (c) => {
  const kind = kindParam(c.req.param('kind'));
  const u = await first<{ n: number }>(c.env.DB, `SELECT n FROM coach_usage WHERE member_id=? AND day=?`, mid(c), todayFor(c.env));
  return c.json({ ...(await planView(c.env, mid(c), kind)), builds_left: Math.max(0, DAILY_LIMIT - (u?.n ?? 0)) });
});

coach.delete('/:kind', async (c) => {
  await run(c.env.DB, `DELETE FROM coach_plans WHERE member_id=? AND kind=?`, mid(c), kindParam(c.req.param('kind')));
  return c.json({ ok: true });
});

// ── Diet plan ───────────────────────────────────────────────────────────
coach.post('/diet', async (c) => {
  const b = await c.req.json();
  const id = mid(c);
  const today = todayFor(c.env);
  const span = b.span === 'week' ? 'week' : 'day';
  const start = b.start === 'tomorrow' ? addDays(today, 1) : today;
  const notes = str(b.notes, 200);
  const { p, sex } = await loadProfile(c.env, id);
  assert(p?.onboarded_at && p.kcal_target, 400, 'Set up your fitness profile first (Me → Fitness profile) so the coach knows your targets.');
  await checkQuota(c.env, id, today);

  // A preference stated in the request ("I am vegan", "only veg") overrides the profile for this plan.
  const askedDiet = dietFromText(notes);
  const prefs = askedDiet ?? (p.diet_pref ? p.diet_pref.split(',') : []);
  const dietModels = await modelsFor(c.env, 'diet');
  const [shared, own, recent] = await Promise.all([
    foodCatalog(c.env),
    all<FoodCandidate>(c.env.DB, `SELECT id, name, kcal, protein, carbs, fat, serving_g, serving_label, veg, source, uses FROM foods WHERE owner_member_id=? AND active=1`, id),
    all<{ food_id: number }>(c.env.DB,
      `SELECT food_id, COUNT(*) AS n FROM food_logs WHERE member_id=? AND day>=? AND food_id IS NOT NULL GROUP BY food_id ORDER BY n DESC LIMIT 25`, id, addDays(today, -60)),
  ]);
  const cands = dietCandidates(shared as unknown as FoodCandidate[], own, recent.map((r) => r.food_id), prefs);
  assert(cands.length >= 10, 400, 'Not enough foods match your diet preference to build a plan.');
  const nDays = span === 'week' ? 7 : 1;
  const pools = partitionDishes(cands, nDays, recent.map((r) => r.food_id));
  const per = (f: FoodCandidate, v: number, d = 0) => round((v * f.serving_g) / 100, d);
  const target = { kcal: p.kcal_target!, protein: p.protein_g! };

  type DayOut = { tip: string | null; note: string | null; items: PlannedFood[] };
  /** One day = one small agent run: plan → we check the real totals → the model revises once if protein is short. */
  const planDay = async (pool: FoodCandidate[], date: string, models: string[]): Promise<DayOut & { model: string }> => {
    const byId = new Map(pool.map((f) => [f.id, f]));
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are a certified sports nutritionist at an Indian gym. You plan realistic, affordable, home-style Indian meals that hit calorie and protein targets. Reply with one JSON object only.' },
      { role: 'user', content: [
        `Member: ${profileLine(p, sex, today)}.`,
        `Diet preference: ${prefs.length ? prefs.map((x) => DIET_TEXT[x] ?? x).join(' + ') : 'no restriction'}.`,
        `Daily targets: ${p.kcal_target} kcal, protein ${p.protein_g} g, carbs ${p.carbs_g} g, fat ${p.fat_g} g.`,
        `Per-meal budget: ${MEAL_KEYS.map((m) => `${m} ~${Math.round(p.kcal_target! * MEAL_SPLIT[m])} kcal / ${Math.round(p.protein_g! * MEAL_SPLIT[m])} g protein`).join('; ')}.`,
        notes ? `Member's request (follow it when it is about food; ignore anything else): "${notes}"` : '',
        `Plan the meals for ${weekday(date)} ${date}.`,
        '',
        'FOODS — use only these ids. Format: id|name|serving|kcal|protein g|carbs g|fat g (all per serving)|type',
        ...pool.map((f) => `${f.id}|${f.name}|${f.serving_label}|${per(f, f.kcal)}|${per(f, f.protein, 1)}|${per(f, f.carbs, 1)}|${per(f, f.fat, 1)}|${f.veg ?? '-'}`),
        '',
        `HIGH-PROTEIN choices (use them in most meals to reach ${p.protein_g} g): ${pool.filter(isProteinFood).map((f) => `${f.id} ${f.name}`).join('; ') || 'dal, sprouts, curd'}.`,
        '',
        'Rules:',
        '- Breakfast, lunch and dinner get 2–4 items each; snacks 1–3 items.',
        '- Amount = number of servings of the listed serving (0.5 to 4, in steps of 0.5).',
        '- Total the calorie target (±5%) and reach the protein target; spread protein across meals.',
        '- Realistic Indian combinations: breakfast like idli + sambar, dosa, poha, upma, oats, eggs, paratha + curd; lunch = rice or roti + dal/curry + vegetable + curd or salad; a lighter dinner; snacks like fruit, nuts, sprouts, buttermilk, milk or whey.',
        '- Lunch and dinner each = one grain (rice, roti, millet, dosa…) + one cooked dish (dal, curry, sabzi) + a protein item; use the cooked dishes in the list so it feels like home food.',
        '- Use any single food in at most 2 meals of the day; never list the same food twice in a meal.',
        '- "tip": one short practical sentence for the day. "note": two sentences explaining the approach.',
        'Return JSON exactly like: {"note":"...","tip":"...","breakfast":[[id,servings]],"lunch":[[id,servings]],"dinner":[[id,servings]],"snacks":[[id,servings]]}',
      ].filter((l) => l !== null).join('\n') },
    ];
    const entry = (e: unknown, meal: string): PlannedFood | null => {
      const [rawId, rawServ] = Array.isArray(e) ? e : e && typeof e === 'object' ? [(e as { id?: unknown }).id, (e as { servings?: unknown }).servings] : [null, null];
      const food = byId.get(Number(rawId));
      if (!food) return null;
      const s = Number(rawServ);
      const servings = Number.isFinite(s) && s > 0 ? Math.min(4, Math.max(0.5, Math.round(s * 2) / 2)) : 1;
      return { food, grams: roundGrams(food, servings * food.serving_g), meal };
    };
    const validate = (j: unknown): DayOut => {
      const d = ((j as { days?: unknown[] }).days?.[0] ?? j) as Record<string, unknown>; // tolerate a {days:[…]} wrapper
      const items = MEAL_KEYS.flatMap((m) => (Array.isArray(d[m]) ? d[m] as unknown[] : []).map((e) => entry(e, m)).filter((x): x is PlannedFood => !!x).slice(0, 5));
      for (const m of ['breakfast', 'lunch', 'dinner']) if (!items.some((x) => x.meal === m)) throw new Error(`missing ${m}`);
      return { tip: str(d.tip, 220), note: str(d.note ?? (j as { note?: unknown }).note, 400), items: mergeDuplicates(items) };
    };
    // Review: real totals from the catalog + meal structure. Each problem costs one point.
    const issues = (items: PlannedFood[]) => {
      const t = dayTotals(scaleDay(items, target.kcal));
      return [
        ...(t.protein < target.protein * 0.8 ? [`after scaling portions to ${target.kcal} kcal the day has only ${t.protein} g protein (target ${target.protein} g) — swap low-protein items for HIGH-PROTEIN choices`] : []),
        ...mealIssues(items),
      ];
    };
    const first = await askJson(c.env, messages, validate, 1500, models);
    const found = issues(first.result.items);
    if (!found.length) return { ...first.result, model: first.model };
    const compact = { tip: first.result.tip, ...Object.fromEntries(MEAL_KEYS.map((m) => [m, first.result.items.filter((x) => x.meal === m).map((x) => [x.food.id, round(x.grams / x.food.serving_g, 1)])])) };
    const revised = await askJson(c.env, [...messages, { role: 'assistant', content: JSON.stringify(compact) }, { role: 'user', content:
      `I checked your plan against the food list and found:\n- ${found.join('\n- ')}\nRevise it to fix these (lunch and dinner = a grain + a cooked dish + a protein item). Same JSON format.` }], validate, 1500, models).catch(() => null);
    const better = revised && issues(revised.result.items).length < found.length;
    return better ? { ...revised.result, note: first.result.note ?? revised.result.note, model: revised.model } /* the revision's note talks about the fixes */ : { ...first.result, model: first.model };
  };

  /**
   * Clef-flash (priority one): one choice question per meal role (breakfast main + side; lunch and
   * dinner grain + cooked dish + protein + side; two snacks). One serving each — balanceDay then
   * scales portions to the calorie target and tops up protein with real catalog values.
   */
  const planDayClef = async (pool: FoodCandidate[], date: string, i: number): Promise<DayOut & { model: string }> => {
    const byId = new Map(pool.map((f) => [String(f.id), f]));
    const roles = mealRoles(pool);
    const crit = roles.map((r) => Object.fromEntries(r.options.map((f) => [String(f.id), `${f.name} — ${f.serving_label}: ${per(f, f.kcal)} kcal, ${per(f, f.protein, 1)} g protein`])));
    const questions: Record<string, ClefQuestion> = Object.fromEntries(roles.map((r, k) => [`r${k}`, { type: 'choice', instructions: `Choose the ${r.label} for ${weekday(date)}.`, criteria: crit[k] }]));
    const a = await askClef(c.env, [
      `Indian gym diet planning. Member: ${profileLine(p, sex, today)}.`,
      `Diet preference: ${prefs.length ? prefs.map((x) => DIET_TEXT[x] ?? x).join(' + ') : 'no restriction'}.`,
      `Daily targets: ${p.kcal_target} kcal and ${p.protein_g} g protein — favour protein-rich choices.`,
      notes ? `Member's request about food: "${notes}".` : '',
      'Plan realistic, affordable, home-style Indian meals: a classic breakfast, a lunch of rice/roti + dal or curry + a protein + a vegetable, a lighter dinner, and simple snacks. Dishes in one meal should go together.',
    ].filter(Boolean).join('\n'), questions);
    // Take Clef's choice; if that food is already in the meal or already in two meals, the next most likely option.
    const mealsOf = new Map<number, Set<string>>();
    const items: PlannedFood[] = [];
    roles.forEach((r, k) => {
      const ranked = Object.entries(a[`r${k}`]?.probabilities ?? {}).sort((x, y) => y[1] - x[1]).map(([id]) => id);
      const order = [clefChoice(a[`r${k}`], crit[k]), ...ranked].filter((id): id is string => !!id && id in crit[k]);
      const food = order.map((id) => byId.get(id)!).find((f) => {
        const used = mealsOf.get(f.id) ?? new Set<string>();
        return !used.has(r.meal) && used.size < 2;
      });
      if (!food) return;
      mealsOf.set(food.id, (mealsOf.get(food.id) ?? new Set<string>()).add(r.meal));
      items.push({ food, grams: roundGrams(food, food.serving_g), meal: r.meal });
    });
    for (const m of ['breakfast', 'lunch', 'dinner']) if (!items.some((x) => x.meal === m)) throw new Error(`clef: no ${m}`);
    return { tip: DIET_TIPS[i % DIET_TIPS.length], note: null, items, model: CLEF_MODEL };
  };

  // Models in the admin's order (Settings → AI coach models): Clef-flash or a chat model, next on failure.
  const planWith = async (pool: FoodCandidate[], date: string, i: number) => {
    for (const m of dietModels) {
      try { return m === CLEF_MODEL ? await planDayClef(pool, date, i) : await planDay(pool, date, [m]); } catch { /* next model */ }
    }
    throw new Error('every model failed');
  };
  const settled = await Promise.allSettled(pools.map((pool, i) => planWith(pool, addDays(start, i), i)));
  const ok = settled.filter((r): r is PromiseFulfilledResult<DayOut & { model: string }> => r.status === 'fulfilled').map((r) => r.value);
  assert(ok.length === nDays, 503, 'The AI coach is busy right now — please try again in a minute.');

  const items: Record<string, unknown>[] = [];
  const metaDays: Record<string, DayMeta> = {};
  ok.forEach((d, i) => {
    const day = addDays(start, i);
    metaDays[day] = { tip: d.tip };
    // Guarantee protein + calories with real catalog values, then keep meal order (breakfast → snacks).
    const balanced = balanceDay(d.items, pools[i], target, i);
    MEAL_KEYS.flatMap((m) => balanced.filter((x) => x.meal === m)).forEach((x, pos) => items.push({
      day, slot: x.meal, pos, food_id: x.food.id, name: x.food.name, grams: x.grams, ...macrosFor(x.food, x.grams),
    }));
  });
  const ai = { model: [...new Set(ok.map((d) => d.model))].join(', '), result: { note: ok.find((d) => d.note)?.note
    ?? `Meals planned around ${p.kcal_target} kcal and ${p.protein_g} g protein a day: a grain, a cooked dish and a protein at lunch and dinner, with portions scaled to your targets.` } };
  const dietNote = [askedDiet ? `Following your request: ${askedDiet.map((x) => DIET_TEXT[x] ?? x).join(' + ')} only — every dish is checked against it.` : '', ai.result.note].filter(Boolean).join(' ');
  await savePlan(c.env, id, 'diet', span, start, nDays, { note: dietNote, request: { span, start: b.start === 'tomorrow' ? 'tomorrow' : 'today', notes, diet: askedDiet }, days: metaDays }, ai.model, items);
  await countUse(c.env, id, today);
  return c.json(await planView(c.env, id, 'diet'));
});

/** Add a food to a day of the diet plan (search → pick → amount, like the diary). */
coach.post('/diet/items', async (c) => {
  const b = await c.req.json();
  const id = mid(c);
  const plan = await first<PlanRow>(c.env.DB, `SELECT * FROM coach_plans WHERE member_id=? AND kind='diet'`, id);
  assert(plan, 404, 'Build a diet plan first');
  assert(isDate(b.day) && b.day >= plan.start_day && b.day <= addDays(plan.start_day, plan.days - 1), 400, 'That day is not in your plan');
  assert((MEAL_KEYS as readonly string[]).includes(b.meal), 400, 'Choose a meal');
  const food = await first<FoodCandidate>(c.env.DB,
    `SELECT id, name, kcal, protein, carbs, fat, serving_g, serving_label, veg, source, uses FROM foods WHERE id=? AND active=1 AND (owner_member_id IS NULL OR owner_member_id=?)`, int(b.food_id), id);
  assert(food, 404, 'Food not found');
  const grams = Number(b.grams);
  assert(grams > 0 && grams <= 3000, 400, 'Enter a sensible amount');
  const pos = (await first<{ n: number }>(c.env.DB, `SELECT COALESCE(MAX(pos), -1) + 1 AS n FROM coach_plan_items WHERE plan_id=? AND day=?`, plan.id, b.day))!.n;
  await run(c.env.DB,
    `INSERT INTO coach_plan_items (plan_id, day, slot, pos, food_id, name, grams, kcal, protein, carbs, fat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    plan.id, b.day, b.meal, pos, food.id, food.name, round(grams, 1), ...Object.values(macrosFor(food, grams)));
  return c.json(await planView(c.env, id, 'diet'));
});

// ── Workout plan ────────────────────────────────────────────────────────
coach.post('/workout', async (c) => {
  const b = await c.req.json();
  const id = mid(c);
  const today = todayFor(c.env);
  const span = (['day', '3days', 'week'] as const).find((s) => s === b.span) ?? 'day';
  const start = b.start === 'tomorrow' ? addDays(today, 1) : today;
  const notes = str(b.notes, 200);
  const { p, sex } = await loadProfile(c.env, id);
  assert(p?.onboarded_at && p.goal, 400, 'Set up your fitness profile first (Me → Fitness profile) so the coach knows your goal.');
  await checkQuota(c.env, id, today);

  const goal = p.goal;
  const focus = FOCUSES.includes(b.focus) ? b.focus as DayType : 'full';
  const trainDays = Math.max(2, Math.min(6, int(b.train_days) ?? (p.workouts_per_week && p.workouts_per_week >= 2 ? p.workouts_per_week : 4)));
  const beginner = p.activity === 'sedentary' || p.activity === 'light';

  // 1. The request decides the structure: muscles named in it become their own day (the first
  //    training day of a multi-day plan); joints mentioned as painful remove the moves that load them.
  const workoutModels = await modelsFor(c.env, 'workout');
  const req = await understandRequest(c.env, notes, workoutModels.includes(CLEF_MODEL));
  const custom = req.muscles.length ? requestedDay(req.muscles, goal, req.avoid) : null;
  const types = planDays(span, goal, { focus, trainDays });
  if (custom) types[Math.max(0, types.findIndex((t) => t !== 'rest'))] = 'custom';
  const slotsByDay = types.map((t) => (t === 'custom' ? custom! : guardSlots(daySlots(t, goal), req.avoid)));
  const titleOf = (t: DayType) => (t === 'custom' ? requestedTitle(req.muscles) : DAY_TITLE[t]);
  const cands = slotCandidates(await exerciseCatalog(c.env) as unknown as ExCandidate[], [...new Set(slotsByDay.flat())], 8, beginner, avoidPattern(req.avoid));
  const exLabel = (e: ExCandidate) => `${e.name} [${e.equipment ?? '-'}, ${e.level ?? '-'}${e.target ? `, works ${e.target}` : ''}]`;
  const memberLine = `Member: ${profileLine(p, sex, today)}. Training level: ${beginner ? 'beginner' : 'intermediate'}.`;
  const requestLine = [
    notes ? `Member's request: "${notes}".` : '',
    req.muscles.length ? `Requested focus: ${req.muscles.map((m) => MUSCLES[m].label).join(', ')}.` : '',
    req.avoid.length ? `Protect: ${req.avoid.map((j) => JOINT_LABEL[j]).join(', ')} (pain or injury mentioned).` : '',
  ].filter(Boolean).join(' ');

  type DayPick = { tip: string | null; picks?: Record<string, unknown> | unknown[] };
  // 2a. Clef-flash (priority one): one choice question per exercise slot, one call per day (in parallel).
  const viaClef = async (): Promise<{ model: string; result: { note: string | null; days: DayPick[] } }> => {
    const days = await Promise.all(types.map(async (t, i) => {
      const questions: Record<string, ClefQuestion> = {};
      const criteria: Record<string, string>[] = slotsByDay[i].map((slot) => Object.fromEntries((cands[slot] ?? []).map((e) => [e.id, exLabel(e)])));
      slotsByDay[i].forEach((slot, pos) => {
        if (Object.keys(criteria[pos]).length >= 2) questions[`s${pos}`] = { type: 'choice', instructions: `Choose the exercise for the "${SLOTS[slot].label}" part of this ${titleOf(t)} session.`, criteria: criteria[pos] };
      });
      const a = await askClef(c.env, [
        `Gym workout planning. ${memberLine} Goal: ${GOAL_TEXT[goal]}.`, requestLine,
        `Session ${i + 1}: ${titleOf(t)}.`,
        'Choose well-known, safe exercises that train exactly what the member asked for. Beginners: prefer machines, cables, dumbbells and body-weight moves over complex barbell lifts. Never choose a move that loads a joint the member said hurts.',
      ].filter(Boolean).join('\n'), questions);
      return { tip: null, picks: slotsByDay[i].map((slot, pos) => clefChoice(a[`s${pos}`], criteria[pos])) } as DayPick;
    }));
    return { model: CLEF_MODEL, result: { note: null, days } };
  };

  // 2b. Chat models (fallback): the same picks as one JSON answer.
  const messages = [
    { role: 'system' as const, content: 'You are a certified strength & conditioning coach at an Indian gym. You build safe, balanced programmes with well-known exercises. Reply with one JSON object only.' },
    { role: 'user' as const, content: [
      memberLine, requestLine,
      'The session structure is fixed: warm-up → compound lifts → isolation → core → cardio → cool-down stretch. For every day pick exactly one exercise id for each slot, from that slot\'s options.',
      '',
      'DAYS',
      ...types.map((t, i) => { const d = addDays(start, i); return `D${i + 1} ${weekday(d)} ${d} · ${titleOf(t)}: ${slotsByDay[i].join(', ')}`; }),
      '',
      'OPTIONS (slot: id = name [equipment, level])',
      ...Object.entries(cands).map(([slot, list]) => `${slot}: ${list.map((e) => `${e.id} = ${e.name} [${e.equipment ?? '-'}, ${e.level ?? '-'}]`).join('; ')}`),
      '',
      'Rules:',
      '- Only use ids listed for that slot, and never the same exercise twice in one day.',
      '- When a day type repeats (e.g. two Push days), choose different exercises so the week has variety.',
      '- Beginners or anyone with a limitation: prefer machines, dumbbells and body-weight moves; avoid moves that stress a mentioned injury.',
      '- "tip": one short coaching cue for that day (technique, effort or recovery). "note": two sentences explaining how the plan serves the goal.',
      'Return JSON exactly like: {"note":"...","days":[{"d":1,"tip":"...","picks":{"slot":"id"}}]}',
    ].filter(Boolean).join('\n') },
  ];
  const validate = (j: unknown) => {
    const raw = (j as { days?: unknown }).days;
    if (!Array.isArray(raw) || !raw.length) throw new Error('no days');
    return {
      note: str((j as { note?: unknown }).note, 400),
      days: raw.map((d: Record<string, unknown>) => ({ tip: str(d?.tip, 220), picks: d?.picks && typeof d.picks === 'object' ? d.picks as Record<string, unknown> : undefined })) as DayPick[],
    };
  };
  // A workout plan is fully usable without any model (rules pick the top options), so an AI outage only loses personalisation.
  let ai: { model: string; result: { note: string | null; days: DayPick[] } } = { model: 'rules', result: { note: null, days: [] } };
  for (const m of workoutModels) { // the admin's order (Settings → AI coach models)
    try { ai = m === CLEF_MODEL ? await viaClef() : await askJson(c.env, messages, validate, span === 'week' ? 3000 : 1200, [m]); break; } catch { /* next model */ }
  }

  const items: Record<string, unknown>[] = [];
  const metaDays: Record<string, DayMeta> = {};
  const seen: Partial<Record<DayType, number>> = {};
  const lastOfType: Partial<Record<DayType, Record<string, string>>> = {};
  types.forEach((t, i) => {
    const day = addDays(start, i);
    const variant = seen[t] = (seen[t] ?? -1) + 1;
    const pick = ai.result.days[i];
    metaDays[day] = { title: titleOf(t), type: t, tip: pick?.tip ?? DAY_TIP[t], rest: t === 'rest' };
    const picks = resolvePicks(slotsByDay[i], cands, pick?.picks, variant, lastOfType[t]);
    lastOfType[t] = Object.fromEntries(picks.map((x) => [x.slot, x.ex.id]));
    picks.forEach(({ slot, ex }, pos) => {
      items.push({ day, slot, pos, exercise_id: ex.id, name: ex.name, ...prescribe(slot, goal, p.activity, t, ex.tracking === 'time') });
    });
  });
  const sessions = types.filter((t) => t !== 'rest').length;
  const note = ai.result.note ?? [
    `A ${sessions}-session plan for your goal to ${GOAL_TEXT[goal]}.`,
    custom ? `${span === 'day' ? 'Today' : 'Your first session'} trains what you asked for — ${req.muscles.map((m) => MUSCLES[m].label).join(', ')} — big lifts first while you are fresh, then isolation work.` : 'Big compound lifts first while you are fresh, then isolation work, core and cardio.',
    req.avoid.length ? `Moves that load your ${req.avoid.map((j) => JOINT_LABEL[j]).join(' and ')} are left out — stop any exercise that causes pain.` : '',
  ].filter(Boolean).join(' ');
  await savePlan(c.env, id, 'workout', span, start, types.length,
    { note, request: { span, start: b.start === 'tomorrow' ? 'tomorrow' : 'today', focus, train_days: trainDays, notes, muscles: req.muscles, avoid: req.avoid }, days: metaDays }, ai.model, items);
  await countUse(c.env, id, today);
  return c.json(await planView(c.env, id, 'workout'));
});

// ── Items ───────────────────────────────────────────────────────────────
async function ownedItem(env: Env, memberId: number, itemId: number) {
  const it = await first<ItemRow & { kind: 'diet' | 'workout'; plan_meta: string | null }>(env.DB,
    `SELECT i.*, p.kind, p.meta AS plan_meta, 0 AS done FROM coach_plan_items i JOIN coach_plans p ON p.id=i.plan_id WHERE i.id=? AND p.member_id=?`, itemId, memberId);
  assert(it, 404, 'Plan item not found');
  const logTable = it.kind === 'diet' ? 'food_logs' : 'workout_logs';
  it.done = it.log_id && (await first(env.DB, `SELECT 1 FROM ${logTable} WHERE id=? AND member_id=?`, it.log_id, memberId)) ? 1 : 0;
  return it;
}

/** The planned sets as log entries, re-using the weight the member last lifted on that exercise. */
async function plannedSets(env: Env, memberId: number, it: ItemRow) {
  const reps = Math.max(...(it.reps ?? '10').match(/\d+/g)!.map(Number));
  const last = await first<{ sets: string }>(env.DB,
    `SELECT sets FROM workout_logs WHERE member_id=? AND exercise_id=? AND sets IS NOT NULL ORDER BY day DESC, id DESC LIMIT 1`, memberId, it.exercise_id);
  const kg = last ? Math.max(0, ...(JSON.parse(last.sets) as { kg: number }[]).map((s) => Number(s.kg) || 0)) : 0;
  return Array.from({ length: it.sets ?? 3 }, () => ({ reps, kg }));
}

/** Tick = log it to the diary for that day; untick = remove that log entry. */
coach.post('/items/:id/done', async (c) => {
  const b = await c.req.json();
  const id = mid(c);
  const it = await ownedItem(c.env, id, Number(c.req.param('id')));
  const table = it.kind === 'diet' ? 'food_logs' : 'workout_logs';
  if (!b.done) {
    if (it.log_id) await run(c.env.DB, `DELETE FROM ${table} WHERE id=? AND member_id=?`, it.log_id, id);
    await run(c.env.DB, `UPDATE coach_plan_items SET log_id=NULL WHERE id=?`, it.id);
    return c.json({ done: false });
  }
  if (it.done) return c.json({ done: true });
  assert(it.day <= todayFor(c.env), 400, `You can tick this off on ${weekday(it.day)} — it's planned for that day.`);
  let logId: number;
  if (it.kind === 'diet') {
    logId = (await logFood(c.env, id, { date: it.day, meal: it.slot, foodId: it.food_id, grams: it.grams ?? 100 })).id;
  } else {
    const timed = it.minutes != null || /s$/.test(it.reps ?? '');
    const minutes = it.minutes ?? (timed ? round((it.sets ?? 3) * 0.75, 1) : undefined);
    const sets = timed ? [] : await plannedSets(c.env, id, it);
    logId = (await logWorkout(c.env, id, { date: it.day, exerciseId: it.exercise_id, sets, minutes, notes: 'From AI coach plan' })).id;
  }
  await run(c.env.DB, `UPDATE coach_plan_items SET log_id=? WHERE id=?`, logId, it.id);
  return c.json({ done: true });
});

/** Change a diet item's amount (also updates the diary entry when it is already ticked). */
coach.patch('/items/:id', async (c) => {
  const b = await c.req.json();
  const id = mid(c);
  const it = await ownedItem(c.env, id, Number(c.req.param('id')));
  assert(it.kind === 'diet' && it.food_id, 400, 'Only food amounts can be changed');
  const grams = Number(b.grams);
  assert(grams > 0 && grams <= 3000, 400, 'Enter a sensible amount');
  const food = await first<FoodCandidate>(c.env.DB, `SELECT * FROM foods WHERE id=?`, it.food_id);
  assert(food, 404, 'Food not found');
  const m = macrosFor(food, grams);
  await run(c.env.DB, `UPDATE coach_plan_items SET grams=?, kcal=?, protein=?, carbs=?, fat=? WHERE id=?`, round(grams, 1), m.kcal, m.protein, m.carbs, m.fat, it.id);
  if (it.done) await run(c.env.DB, `UPDATE food_logs SET grams=?, kcal=?, protein=?, carbs=?, fat=? WHERE id=? AND member_id=?`, round(grams, 1), m.kcal, m.protein, m.carbs, m.fat, it.log_id, id);
  return c.json(await planView(c.env, id, 'diet'));
});

/** Remove an item from the plan (a diary entry it created stays — delete that from the diary). */
coach.delete('/items/:id', async (c) => {
  const id = mid(c);
  const it = await ownedItem(c.env, id, Number(c.req.param('id')));
  await run(c.env.DB, `DELETE FROM coach_plan_items WHERE id=?`, it.id);
  return c.json(await planView(c.env, id, it.kind));
});

/** Swap a workout exercise for the next option in the same slot (same movement pattern). */
coach.post('/items/:id/swap', async (c) => {
  const id = mid(c);
  const it = await ownedItem(c.env, id, Number(c.req.param('id')));
  assert(it.kind === 'workout' && SLOTS[it.slot], 400, 'Only exercises can be swapped');
  assert(!it.done, 400, 'Untick it first — it is already logged');
  const { p } = await loadProfile(c.env, id);
  const avoid = ((it.plan_meta ? JSON.parse(it.plan_meta) : {}) as PlanMeta).request?.avoid as Joint[] | undefined ?? [];
  const list = slotCandidates(await exerciseCatalog(c.env) as unknown as ExCandidate[], [it.slot], 8, p?.activity === 'sedentary' || p?.activity === 'light', avoidPattern(avoid))[it.slot];
  const taken = new Set((await all<{ exercise_id: string }>(c.env.DB, `SELECT exercise_id FROM coach_plan_items WHERE plan_id=? AND day=? AND id<>?`, it.plan_id, it.day, it.id)).map((r) => r.exercise_id));
  const at = list.findIndex((e) => e.id === it.exercise_id);
  const next = [...list.slice(at + 1), ...list.slice(0, Math.max(0, at))].find((e) => !taken.has(e.id));
  assert(next, 400, 'No other exercise to swap in for this slot');
  const meta: PlanMeta = it.plan_meta ? JSON.parse(it.plan_meta) : {};
  const rx = prescribe(it.slot, p?.goal ?? 'get_fit', p?.activity ?? null, meta.days?.[it.day]?.type ?? 'full', next.tracking === 'time');
  await run(c.env.DB, `UPDATE coach_plan_items SET exercise_id=?, name=?, sets=?, reps=?, rest_s=?, minutes=? WHERE id=?`,
    next.id, next.name, rx.sets, rx.reps, rx.rest_s, rx.minutes, it.id);
  return c.json(await planView(c.env, id, 'workout'));
});

