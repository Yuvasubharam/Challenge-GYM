// Curated foods / recipe API test (member + admin workers running locally, foods-cg.sql loaded).
//   npx tsx test/foods-e2e.ts
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { signToken } from '../src/lib/crypto';

const ADMIN = 'http://127.0.0.1:8788/api';
const MEMBER = 'http://127.0.0.1:8789/api';
let pass = 0, fail = 0;
const sql = (q: string) => JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'challenge-gym', '--local',
  '-c', 'wrangler.device.toml', '--persist-to', '.wrangler/state', '--json', '--command', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0].results;
const check = (name: string, cond: unknown, detail: unknown = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 400)}`); }
};
async function call<T = any>(base: string, method: string, path: string, body?: unknown, cookie = ''): Promise<{ status: number; data: T; cookie: string }> {
  const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  const ct = r.headers.get('content-type') ?? '';
  return { status: r.status, data: (ct.includes('json') ? await r.json() : await r.text()) as T, cookie: sc ? sc.split(';')[0] : cookie };
}

console.log('\n── setup');
const m = sql(`SELECT m.id, m.essl_id, m.mobile FROM members m WHERE m.archived=0 AND length(m.mobile)=10 AND m.essl_id NOT LIKE 'CG%' AND (SELECT COUNT(*) FROM members x WHERE x.mobile=m.mobile)=1 ORDER BY m.id DESC LIMIT 1`)[0];
sql(`DELETE FROM accounts WHERE member_id=${m.id}; DELETE FROM food_logs WHERE member_id=${m.id}; DELETE FROM login_attempts; UPDATE members SET app_access=1 WHERE id=${m.id}`);
let r = await call(MEMBER, 'POST', '/auth/activate', { mobile: m.mobile, memberId: m.essl_id, password: 'secret1' });
const mc = r.cookie;
check(`member #${m.essl_id} signed in`, r.status === 200, r.data);

console.log('\n── search');
const search = async (q: string) => (await call(MEMBER, 'GET', `/fit/foods?q=${encodeURIComponent(q)}`, undefined, mc)).data.results as any[];
for (const [q, want] of [['fried rice', 'Egg fried rice'], ['egg curry', 'Egg curry (Andhra style)'], ['chicken 65', 'Chicken 65'], ['gongura', 'Gongura chicken'], ['pesarattu', 'Pesarattu (green moong dosa)']] as const) {
  const res = await search(q);
  check(`"${q}" finds ${want}`, res.some((f) => f.name === want), res.map((f) => f.name));
}
const fr = await search('fried rice');
const egg = fr.find((f) => f.name === 'Egg fried rice');
check('list rows carry image + has_recipe, not the recipe text', egg?.image === 'food/egg-fried-rice.webp' && egg.has_recipe === 1 && !('steps' in egg) && !('ingredients' in egg), egg);
const poori = await search('poori');
check('oil-soaked INDB poori (738 kcal) hidden', !poori.some((f) => f.kcal > 700), poori.map((f) => `${f.name} ${f.kcal}`));
check('curated poori present (330 kcal)', poori.some((f) => f.name === 'Poori' && f.kcal === 330), poori.map((f) => `${f.name} ${f.kcal}`));
const boiled = await search('boiled egg');
check('45-kcal "Boiled egg (Ubla anda)" hidden', !boiled.some((f) => f.name.startsWith('Boiled egg')), boiled.map((f) => f.name));
const vegOnly = (await call(MEMBER, 'GET', '/fit/foods?q=fried%20rice&veg=veg', undefined, mc)).data.results as any[];
check('veg filter excludes egg/chicken fried rice', vegOnly.length > 0 && vegOnly.every((f) => f.veg === 'veg'), vegOnly.map((f) => f.name));

console.log('\n── details');
r = await call(MEMBER, 'GET', `/fit/foods/${egg.id}`, undefined, mc);
check('details: ingredients + steps arrays', r.status === 200 && r.data.ingredients.length >= 5 && r.data.steps.length >= 3, r.data);
check('details: photo credit + recipe meta', /Wikimedia Commons/.test(r.data.image_credit) && r.data.recipe_serves === 2 && r.data.recipe_min === 20, r.data);
r = await call(MEMBER, 'GET', `/fit/foods/99999999`, undefined, mc);
check('unknown food → 404', r.status === 404);
const hiddenId = sql(`SELECT id FROM foods WHERE source='indb' AND active=0 LIMIT 1`)[0].id;
r = await call(MEMBER, 'GET', `/fit/foods/${hiddenId}`, undefined, mc);
check('hidden food → 404', r.status === 404);
r = await call(MEMBER, 'GET', `/fit/foods/${egg.id}`);
check('details need sign-in', r.status === 401, r.status);

console.log('\n── day view');
const day = new Date().toISOString().slice(0, 10);
r = await call(MEMBER, 'POST', '/fit/food-logs', { date: day, meal: 'lunch', food_id: egg.id, servings: 1 }, mc);
check('log egg fried rice', r.status === 200, r.data);
r = await call(MEMBER, 'GET', `/fit/day?date=${day}`, undefined, mc);
const item = r.data.meals?.lunch?.items?.[0];
check('logged item has image + has_recipe', item?.image === 'food/egg-fried-rice.webp' && item.has_recipe === 1, item);
check('1 plate = 250 g = 438 kcal', Math.round(item?.kcal) === 438, item);

console.log('\n── admin');
// Local DB is a prod copy (no known admin password): sign a short admin session for the owner account.
const secret = /^JWT_SECRET\s*=\s*"?([^"\r\n]+)/m.exec(readFileSync('.dev.vars', 'utf8'))![1];
const owner = sql(`SELECT id, display_name AS name FROM accounts WHERE role='owner' AND active=1 LIMIT 1`)[0];
const admin = `cg_admin=${await signToken({ aid: owner.id, role: 'owner', mid: null, name: owner.name, aud: 'admin' }, secret, 600)}`;
r = await call(ADMIN, 'GET', '/foods?source=cg&size=100', undefined, admin);
check('admin: curated filter → 185', r.data.total === 185 && r.data.stats.curated === 185, { total: r.data.total, stats: r.data.stats });
r = await call(ADMIN, 'GET', `/foods/${egg.id}`, undefined, admin);
check('admin: detail includes recipe', r.data.steps?.length >= 3, r.data);
const steps = r.data.steps as string[];
r = await call(ADMIN, 'PATCH', `/foods/${egg.id}`, { steps: [...steps, 'Serve hot.'].join('\n') }, admin);
check('admin: edit steps (one per line)', r.status === 200, r.data);
r = await call(MEMBER, 'GET', `/fit/foods/${egg.id}`, undefined, mc);
check('member sees edited steps', r.data.steps.at(-1) === 'Serve hot.', r.data.steps);
await call(ADMIN, 'PATCH', `/foods/${egg.id}`, { steps }, admin);
r = await call(ADMIN, 'PATCH', `/foods/${egg.id}`, { steps: Array.from({ length: 41 }, (_, i) => `step ${i}`) }, admin);
check('admin: > 40 steps rejected', r.status === 400, r.data);

sql(`DELETE FROM food_logs WHERE member_id=${m.id}; DELETE FROM accounts WHERE member_id=${m.id}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
