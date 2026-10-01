// AI coach API test — member worker running locally (.\run-local.ps1 member), real Workers AI models.
//   node --experimental-strip-types test/coach-e2e.ts
import { execFileSync } from 'node:child_process';

const MEMBER = 'http://127.0.0.1:8789/api';
let pass = 0, fail = 0;
const sql = (q: string) => JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'challenge-gym', '--local',
  '-c', 'wrangler.device.toml', '--persist-to', '.wrangler/state', '--json', '--command', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0].results;
const check = (name: string, cond: unknown, detail: unknown = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); }
};
let cookie = '';
async function call<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T; ms: number }> {
  const t = Date.now();
  const r = await fetch(MEMBER + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  const ct = r.headers.get('content-type') ?? '';
  return { status: r.status, data: (ct.includes('json') ? await r.json() : await r.text()) as T, ms: Date.now() - t };
}
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

console.log('\n── setup: member with an untouched default login');
const m = sql(`SELECT m.id, m.essl_id FROM members m JOIN accounts a ON a.member_id=m.id WHERE a.role='member' AND a.must_change_password=1 AND a.active=1
               AND m.archived=0 AND m.app_access=1 AND m.essl_id GLOB '[0-9]*' ORDER BY m.id LIMIT 1`)[0];
sql(`DELETE FROM coach_plans WHERE member_id=${m.id}; DELETE FROM coach_usage WHERE member_id=${m.id}; DELETE FROM food_logs WHERE member_id=${m.id};
     DELETE FROM workout_logs WHERE member_id=${m.id}; DELETE FROM login_attempts`);
let r = await call('POST', '/auth/login', { id: m.essl_id, password: m.essl_id });
check(`member #${m.essl_id} signs in`, r.status === 200, r.data);

r = await call('PUT', '/fit/profile', { age: 30, gender: 'male', height_cm: 170, weight_kg: 82, target_weight_kg: 72, goal: 'lose_weight', activity: 'light', workouts_per_week: 4, diet_pref: ['veg', 'egg'] });
const targets = r.data.profile.targets;
check('profile: lose weight, veg + egg', r.status === 200, r.data);

console.log('\n── diet plan');
r = await call('GET', '/coach/diet');
check('no plan yet, 5 AI requests a day', r.data.plan === null && r.data.builds_left === 5, r.data);
r = await call('POST', '/coach/diet', { span: 'day', notes: 'South Indian breakfast please' });
check(`day plan built by ${r.data.plan?.model} in ${r.ms} ms`, r.status === 200 && r.data.days?.length === 1, r.data);
const d1 = r.data.days[0];
const meals = new Set(d1.items.map((i: any) => i.slot));
check('has breakfast, lunch, dinner', ['breakfast', 'lunch', 'dinner'].every((x) => meals.has(x)), [...meals]);
check(`calories ${d1.planned.kcal} within ±12% of ${targets.kcal}`, Math.abs(d1.planned.kcal - targets.kcal) / targets.kcal <= 0.12, d1.planned);
console.log(`    protein ${d1.planned.protein} g of ${targets.protein_g} g · ${d1.items.map((i: any) => `${i.slot[0]}:${i.name} ${i.grams}g`).join(' | ')}`);
check('no non-veg foods for veg + egg', d1.items.every((i: any) => i.veg !== 'nonveg'), d1.items.filter((i: any) => i.veg === 'nonveg'));
check('tip + note present', !!d1.tip && !!r.data.plan.note, { tip: d1.tip, note: r.data.plan.note });

const item = d1.items.find((i: any) => i.slot === 'breakfast');
r = await call('POST', `/coach/items/${item.id}/done`, { done: true });
check('tick → logged', r.status === 200 && r.data.done === true, r.data);
r = await call('GET', `/fit/day?date=${today}`);
const logged = r.data.meals.breakfast.items.find((x: any) => x.food_id === item.food_id);
check('ticked food is in the diary with planned grams', logged && Math.abs(logged.grams - item.grams) < 0.2, r.data.meals.breakfast);
r = await call('PATCH', `/coach/items/${item.id}`, { grams: item.grams * 2 });
const doubled = r.data.days[0].items.find((i: any) => i.id === item.id);
check('change amount → macros + diary updated', Math.abs(doubled.kcal - item.kcal * 2) <= 2 && doubled.done, doubled);
await call('DELETE', `/fit/food-logs/${logged.id}`);
r = await call('GET', '/coach/diet');
check('deleting the diary entry un-ticks the plan item', r.data.days[0].items.find((i: any) => i.id === item.id).done === false);
r = await call('POST', '/coach/diet/items', { day: today, meal: 'snacks', food_id: 32, grams: 118 });
check('add a food (banana) to snacks', r.data.days[0].items.some((i: any) => i.food_id === 32 && i.slot === 'snacks'), r.data);
const banana = r.data.days[0].items.find((i: any) => i.food_id === 32);
r = await call('DELETE', `/coach/items/${banana.id}`);
check('remove it again', !r.data.days[0].items.some((i: any) => i.id === banana.id));

r = await call('POST', '/coach/diet', { span: 'week' });
check(`week plan built by ${r.data.plan?.model} in ${r.ms} ms`, r.status === 200 && r.data.days?.length === 7, r.data);
if (r.status === 200) {
  const lunches = new Set(r.data.days.map((d: any) => d.items.filter((i: any) => i.slot === 'lunch').map((i: any) => i.food_id).sort().join(',')));
  check(`varied lunches (${lunches.size} distinct of 7)`, lunches.size >= 4);
  const off = r.data.days.filter((d: any) => Math.abs(d.planned.kcal - targets.kcal) / targets.kcal > 0.15);
  check('every day within ±15% of the calorie target', off.length === 0, off.map((d: any) => d.planned.kcal));
  const future = r.data.days[1].items[0];
  r = await call('POST', `/coach/items/${future.id}/done`, { done: true });
  check('future day cannot be ticked yet', r.status === 400, r.data);
}

console.log('\n── workout plan');
r = await call('POST', '/coach/workout', { span: 'day', focus: 'push' });
check(`push day built by ${r.data.plan?.model} in ${r.ms} ms`, r.status === 200 && r.data.days?.length === 1, r.data);
const push = r.data.days[0].items;
console.log(`    ${push.map((i: any) => `${i.slot}: ${i.name}${i.sets ? ` ${i.sets}×${i.reps}` : ` ${i.minutes} min`}`).join(' | ')}`);
check('order: warm-up first, stretch last', push[0].slot === 'warmup' && push[push.length - 1].slot === 'stretch', push.map((i: any) => i.slot));
check('chest press before isolation', push.findIndex((i: any) => i.slot === 'chest_press') < push.findIndex((i: any) => i.slot === 'triceps'));
check('no exercise twice in a day', new Set(push.map((i: any) => i.exercise_id)).size === push.length);
check('lose weight → 3×12–15 + cardio finisher', push.find((i: any) => i.slot === 'chest_press')?.reps === '12–15' && push.some((i: any) => i.slot === 'cardio' && i.minutes === 20));

const press = push.find((i: any) => i.slot === 'chest_press');
r = await call('POST', `/coach/items/${press.id}/swap`, {});
const swapped = r.data.days[0].items.find((i: any) => i.id === press.id);
check(`swap → ${swapped?.name}`, swapped && swapped.exercise_id !== press.exercise_id && swapped.slot === 'chest_press', r.data);
r = await call('POST', `/coach/items/${press.id}/done`, { done: true });
r = await call('GET', `/fit/day?date=${today}`);
const wl = r.data.workouts.find((w: any) => w.exercise_id === swapped.exercise_id);
check('tick exercise → workout logged with planned sets', wl && wl.sets.length === swapped.sets && wl.sets[0].reps === 15, wl);

r = await call('POST', '/coach/workout', { span: 'week', train_days: 4 });
check(`week plan built by ${r.data.plan?.model} in ${r.ms} ms`, r.status === 200 && r.data.days?.length === 7, r.data);
if (r.status === 200) {
  const types = r.data.days.map((d: any) => d.type);
  console.log(`    ${types.join(' → ')}`);
  check('4 training days + 3 rest days', types.filter((t: string) => t === 'rest').length === 3, types);
  check('upper/lower split covers every muscle group twice', types.filter((t: string) => t === 'upper').length === 2 && types.filter((t: string) => t === 'lower').length === 2);
  const [u1, u2] = r.data.days.filter((d: any) => d.type === 'upper');
  const accessory = (d: any) => d.items.filter((i: any) => ['biceps', 'triceps', 'cardio', 'warmup'].includes(i.slot)).map((i: any) => i.exercise_id);
  const same = accessory(u1).filter((x: string, k: number) => x === accessory(u2)[k]);
  check('2nd Upper day keeps the main lifts, rotates accessories', u1.items.find((i: any) => i.slot === 'chest_press').exercise_id === u2.items.find((i: any) => i.slot === 'chest_press').exercise_id && same.length === 0, { same });
}
r = await call('POST', '/coach/workout', { span: '3days' });
check(`3-day plan: ${r.data.days?.map((d: any) => d.type).join(', ')}`, r.status === 200 && r.data.days.length === 3 && r.data.days.every((d: any) => d.type === 'full'));

r = await call('GET', '/coach/workout');
check('5 requests used → none left', r.data.builds_left === 0, r.data.builds_left);
r = await call('POST', '/coach/workout', { span: 'day' });
check('6th request today is refused (429)', r.status === 429 && /5 AI coach requests/.test(r.data.error), r.data);
sql(`DELETE FROM coach_usage WHERE member_id=${m.id}`); // new day for the rest of the test

console.log('\n── workout follows the request');
r = await call('POST', '/coach/workout', { span: 'day', notes: 'Provide lats, upper back, and lower back workout' });
const back = r.data.days?.[0];
console.log(`    ${back?.title}: ${back?.items.map((i: any) => `${i.slot}: ${i.name}`).join(' | ')}  (${r.data.plan?.model}, ${r.ms} ms)`);
check('request → its own day, titled for the back', r.status === 200 && back.type === 'custom' && /^Back/.test(back.title), back && { type: back.type, title: back.title });
const backSlots = new Set(['warmup', 'vertical_pull', 'lat_2', 'row', 'upper_back', 'lower_back', 'hinge', 'cardio', 'stretch']);
check('every exercise trains what was asked (no chest/legs/shoulder press)', back?.items.every((i: any) => backSlots.has(i.slot)), back?.items.map((i: any) => i.slot));
check('lats, upper back and lower back all covered', ['vertical_pull', 'row', 'lower_back'].every((s) => back?.items.some((i: any) => i.slot === s)));
check('built by Clef-flash', r.data.plan?.model === '@cf/cloudflare/clef-flash', r.data.plan?.model);
r = await call('POST', '/coach/workout', { span: 'day', notes: 'leg day but I have knee pain' });
const legs = r.data.days?.[0];
console.log(`    ${legs?.title}: ${legs?.items.map((i: any) => i.name).join(' | ')}`);
check('knee pain → no squats, lunges, leg extensions, jumps or running', legs && !legs.items.some((i: any) => /squat|lunge|step-?up|leg extension|leg press|jump|run/i.test(i.name)), legs?.items.map((i: any) => i.name));
check('…but still a leg session (hamstrings / glutes / calves)', legs?.items.some((i: any) => ['ham_curl', 'glute', 'calves', 'hinge'].includes(i.slot)), legs?.items.map((i: any) => i.slot));
r = await call('POST', '/coach/workout', { span: 'week', train_days: 4, notes: 'chest and arms' });
check('week with a request: first session is the requested one, the rest stay balanced', r.status === 200 && r.data.days[0].type === 'custom' && r.data.days.filter((d: any) => d.type === 'lower').length === 2,
  r.data.days?.map((d: any) => d.type));
sql(`DELETE FROM coach_usage WHERE member_id=${m.id}`);

console.log('\n── vegan preference');
await call('PUT', '/fit/profile', { age: 30, gender: 'female', height_cm: 160, weight_kg: 50, goal: 'build_muscle', activity: 'moderate', workouts_per_week: 5, diet_pref: ['vegan'] });
r = await call('POST', '/coach/diet', { span: 'day' });
const dairy = /paneer|curd|milk|yogurt|lassi|raita|ghee|butter|cheese|whey|buttermilk|egg/i;
check(`vegan day plan (${r.data.plan?.model}) has no dairy/egg/meat`, r.status === 200 && r.data.days[0].items.every((i: any) => i.veg === 'veg' && !dairy.test(i.name)),
  r.data.days?.[0]?.items.map((i: any) => i.name));
r = await call('POST', '/coach/workout', { span: '3days' });
check(`build muscle → push/pull/legs: ${r.data.days?.map((d: any) => d.type).join(', ')}`, r.data.days?.map((d: any) => d.type).join() === 'push,pull,legs');
check('build muscle → no cardio finisher', !r.data.days?.some((d: any) => d.items.some((i: any) => i.slot === 'cardio')));

sql(`DELETE FROM coach_plans WHERE member_id=${m.id}; DELETE FROM coach_usage WHERE member_id=${m.id}; DELETE FROM food_logs WHERE member_id=${m.id};
     DELETE FROM workout_logs WHERE member_id=${m.id}; DELETE FROM fitness_profiles WHERE member_id=${m.id}; DELETE FROM weight_logs WHERE member_id=${m.id}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
