// Fitness tracker API test (member + admin workers running locally).
//   npx tsx test/fitness-e2e.ts
import { execFileSync } from 'node:child_process';

const ADMIN = 'http://127.0.0.1:8788/api';
const MEMBER = 'http://127.0.0.1:8789/api';
let pass = 0, fail = 0;
const sql = (q: string) => JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'challenge-gym', '--local',
  '-c', 'wrangler.device.toml', '--persist-to', '.wrangler/state', '--json', '--command', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0].results;
const check = (name: string, cond: unknown, detail: unknown = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); }
};
async function call<T = any>(base: string, method: string, path: string, body?: unknown, cookie = ''): Promise<{ status: number; data: T; cookie: string; headers: Headers }> {
  const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  const ct = r.headers.get('content-type') ?? '';
  return { status: r.status, data: (ct.includes('json') ? await r.json() : await r.text()) as T, cookie: sc ? sc.split(';')[0] : cookie, headers: r.headers };
}

console.log('\n── setup: expired member (tracker must work regardless of plan)');
const m = sql(`SELECT m.id, m.essl_id, m.name, m.mobile FROM members m JOIN v_current_membership cm ON cm.member_id=m.id
               WHERE m.archived=0 AND length(m.mobile)=10 AND cm.end_date < '2026-09-01' AND (SELECT COUNT(*) FROM members x WHERE x.mobile=m.mobile)=1 LIMIT 1`)[0];
sql(`DELETE FROM accounts WHERE member_id=${m.id}; DELETE FROM fitness_profiles WHERE member_id=${m.id}; DELETE FROM food_logs WHERE member_id=${m.id};
     DELETE FROM workout_logs WHERE member_id=${m.id}; DELETE FROM weight_logs WHERE member_id=${m.id}; DELETE FROM water_logs WHERE member_id=${m.id};
     DELETE FROM login_attempts; UPDATE members SET app_access=1 WHERE id=${m.id}`);
const admin = (await call(ADMIN, 'POST', '/auth/login', { username: 'owner', password: 'owner-pass-123' })).cookie;
let r = await call(MEMBER, 'POST', '/auth/activate', { mobile: m.mobile, memberId: m.essl_id, password: 'secret1' });
const mc = r.cookie;
check(`expired member #${m.essl_id} can sign in`, r.status === 200, r.data);

console.log('\n── onboarding & BMI');
r = await call(MEMBER, 'GET', '/fit/profile', undefined, mc);
check('not onboarded yet', r.data.onboarded === false);
r = await call(MEMBER, 'PUT', '/fit/profile', { age: 28, gender: 'male', height_cm: 172, weight_kg: 84, target_weight_kg: 74, goal: 'lose_weight', activity: 'moderate', workouts_per_week: 4, diet_pref: 'egg' }, mc);
const p = r.data.profile;
check('profile saved', r.status === 200 && p, r.data);
check('BMI 28.4 → Obese (Asian-Indian cut-offs)', p.bmi === 28.4 && p.bmi_category.key === 'obese', p.bmi_category);
check('healthy range for 172 cm', p.healthy_range[0] === 54.7 && p.healthy_range[1] === 67.7, p.healthy_range);
check('targets computed (deficit)', p.targets.kcal < p.tdee && p.targets.protein_g === 151 && p.targets.water_ml === 3000, p.targets);
r = await call(MEMBER, 'PUT', '/fit/profile', { age: 5, gender: 'male', height_cm: 172, weight_kg: 84, goal: 'lose_weight', activity: 'moderate' }, mc);
check('invalid age rejected', r.status === 400);

console.log('\n── diet');
r = await call(MEMBER, 'GET', '/fit/foods', undefined, mc);
check('empty search → popular foods', r.data.results.length >= 10);
r = await call(MEMBER, 'GET', '/fit/foods?q=roti', undefined, mc);
const roti = r.data.results.find((f: any) => f.name === 'Chapati/Roti');
check('search "roti" finds Chapati/Roti with serving', roti && roti.serving_label === '1 roti (40 g)', r.data.results.slice(0, 3).map((f: any) => f.name));
r = await call(MEMBER, 'GET', '/fit/foods?q=chicken&veg=veg', undefined, mc);
check('veg filter hides chicken dishes', r.data.results.every((f: any) => f.veg !== 'nonveg'));
r = await call(MEMBER, 'POST', '/fit/food-logs', { meal: 'breakfast', food_id: roti.id, servings: 3 }, mc);
check('log 3 rotis = 120 g', r.status === 200 && r.data.kcal === Math.round(roti.kcal * 1.2), r.data);
const egg = (await call(MEMBER, 'GET', '/fit/foods?q=egg%20boiled', undefined, mc)).data.results.find((f: any) => f.name === 'Egg, whole, boiled');
r = await call(MEMBER, 'POST', '/fit/food-logs', { meal: 'breakfast', food_id: egg.id, servings: 2 }, mc);
check('log 2 boiled eggs = 155 kcal', r.data.kcal === 155, r.data);
r = await call(MEMBER, 'POST', '/fit/foods', { name: 'Gym protein shake', per: 'serving', serving_g: 300, kcal: 240, protein: 30, carbs: 20, fat: 4, veg: 'veg' }, mc);
check('custom food created', r.status === 200);
const shake = r.data.id;
r = await call(MEMBER, 'POST', '/fit/food-logs', { meal: 'snacks', food_id: shake, servings: 1 }, mc);
check('custom food per-serving values kept', r.data.kcal === 240 && r.data.protein === 30, r.data);
r = await call(MEMBER, 'POST', '/fit/food-logs', { meal: 'dinner', food_id: roti.id, grams: 100, date: '2099-01-01' }, mc);
check('future date rejected', r.status === 400);
await call(MEMBER, 'PUT', '/fit/water', { ml: 1500 }, mc);

console.log('\n── workouts');
r = await call(MEMBER, 'GET', '/fit/exercises', undefined, mc);
check('library opens on popular exercises + filters', r.data.results.length >= 30 && r.data.facets?.body_parts?.length >= 8);
r = await call(MEMBER, 'GET', '/fit/exercises?q=bench%20press&body=chest', undefined, mc);
const bench = r.data.results.find((x: any) => x.name === 'Barbell Bench Press');
check('search finds Barbell Bench Press with photos', bench && bench.images.length === 2, r.data.results.slice(0, 3).map((x: any) => x.name));
r = await call(MEMBER, 'GET', `/fit/exercises/${bench.id}`, undefined, mc);
check('detail has steps + Hindi', r.data.instructions.length > 2 && r.data.instructions_hi?.length > 2);
r = await call(MEMBER, 'GET', '/fit/exercises/facets?body=chest', undefined, mc);
const chestTargets = r.data.target.map((t: any) => t.value);
check('facets: Chest narrows Muscle to chest muscles', chestTargets.includes('pectorals') && !chestTargets.includes('quads') && r.data.body.some((b: any) => b.value === 'back'), chestTargets);
r = await call(MEMBER, 'GET', '/fit/exercises?target=pectorals&equipment=barbell', undefined, mc);
check('filter Pectorals · Barbell', r.data.results.length > 0 && r.data.results.every((e: any) => e.target === 'pectorals' && e.equipment === 'barbell') && r.data.total === r.data.results.length, { n: r.data.results.length, total: r.data.total });
r = await call(MEMBER, 'GET', '/fit/exercises?type=cardio&photos=yes', undefined, mc);
check('type Cardio + with photo', r.data.results.length > 0 && r.data.results.every((e: any) => e.tracking === 'time' && e.images.length));
r = await call(MEMBER, 'GET', '/fit/exercises?level=beginner&body=waist', undefined, mc);
check('level filter', r.data.results.length > 0 && r.data.results.every((e: any) => e.level === 'beginner' && e.body_part === 'waist'));
const img = await fetch(`${MEMBER}/fit/media/${bench.images[0]}`);
check('exercise photo served (R2 mirror) with long cache', img.status === 200 && (img.headers.get('content-type') ?? '').includes('image/jpeg') && /max-age=2592000/.test(img.headers.get('cache-control') ?? ''), { s: img.status, cc: img.headers.get('cache-control') });
check('media path traversal blocked', (await fetch(`${MEMBER}/fit/media/..%2F..%2Fsecrets`)).status === 404);
r = await call(MEMBER, 'POST', '/fit/workouts', { exercise_id: bench.id, sets: [{ reps: 10, kg: 40 }, { reps: 8, kg: 50 }, { reps: 6, kg: 55 }] }, mc);
check('strength log: volume, e1RM, calories', r.data.volume_kg === 1130 && r.data.best_e1rm === 66 && r.data.kcal === 53, r.data);
const run = (await call(MEMBER, 'GET', '/fit/exercises?q=treadmill', undefined, mc)).data.results[0];
r = await call(MEMBER, 'POST', '/fit/workouts', { exercise_id: run.id, duration_min: 20 }, mc);
check('treadmill 20 min @ 84 kg = 274 kcal (MET 9.8)', r.data.kcal === 274, r.data);
r = await call(MEMBER, 'POST', '/fit/workouts', { exercise_id: bench.id, sets: [] }, mc);
check('empty strength log rejected', r.status === 400);

console.log('\n── day summary & progress');
r = await call(MEMBER, 'GET', '/fit/day', undefined, mc);
const d = r.data;
check('eaten = rotis + eggs + shake', d.eaten.kcal === Math.round(roti.kcal * 1.2) + 155 + 240, d.eaten);
check('burned = bench + treadmill', d.burned === 327, d.burned);
check('remaining = target − eaten + burned', d.remaining === d.targets.kcal - d.eaten.kcal + d.burned);
check('water + meals grouped', d.water_ml === 1500 && d.meals.breakfast.items.length === 2 && d.meals.snacks.items.length === 1);
r = await call(MEMBER, 'POST', '/fit/weight', { weight_kg: 82.5 }, mc);
check('weight update recalculates BMI + targets', r.data.profile.bmi === 27.9 && r.data.profile.weight_kg === 82.5, r.data.profile);
r = await call(MEMBER, 'GET', '/fit/summary?days=30', undefined, mc);
check('summary series + records + streak', r.data.series.length === 30 && r.data.records.length >= 1 && r.data.streak >= 1, { streak: r.data.streak, rec: r.data.records.length });

console.log('\n── privacy');
const other = sql(`SELECT id FROM food_logs WHERE member_id <> ${m.id} LIMIT 1`)[0];
if (other) check("cannot delete another member's log", (await call(MEMBER, 'DELETE', `/fit/food-logs/${other.id}`, undefined, mc)).status === 200 && sql(`SELECT COUNT(*) n FROM food_logs WHERE id=${other.id}`)[0].n === 1);
const otherShake = await call(MEMBER, 'GET', '/fit/foods?q=gym%20protein%20shake', undefined, '');
check('food API needs login', otherShake.status === 401);

console.log('\n── admin: fitness view, food fix, app access switch');
r = await call(ADMIN, 'GET', `/members/${m.id}/fitness`, undefined, admin);
check('admin sees member fitness', r.data.bmi?.bmi === 27.9 && r.data.workouts.length === 2, r.data.bmi);
const bad = sql(`SELECT id, kcal FROM foods WHERE name='Boiled egg (Ubla anda)'`)[0];
r = await call(ADMIN, 'PATCH', `/foods/${bad.id}`, { kcal: 155, protein: 12.6, fat: 10.6, carbs: 1.1 }, admin);
check('admin corrects a food value', r.status === 200 && sql(`SELECT kcal FROM foods WHERE id=${bad.id}`)[0].kcal === 155);
sql(`UPDATE foods SET kcal=${bad.kcal}, protein=4.43, fat=3.04, carbs=0.12 WHERE id=${bad.id}`); // restore seed value for re-runs
r = await call(ADMIN, 'POST', `/members/${m.id}/app-access`, { enabled: false }, admin);
check('admin switches app off', r.data.app_access === false);
r = await call(MEMBER, 'GET', '/fit/day', undefined, mc);
check('open session is cut off immediately', r.status === 403 && r.data.code === 'app_disabled', r.data);
r = await call(MEMBER, 'POST', '/auth/login', { id: m.essl_id, password: 'secret1' });
check('login refused while off', r.status === 403 && r.data.code === 'app_disabled');
check('member list filter "app_off"', (await call(ADMIN, 'GET', '/members?status=app_off', undefined, admin)).data.members.some((x: any) => x.id === m.id));
await call(ADMIN, 'POST', `/members/${m.id}/app-access`, { enabled: true }, admin);
r = await call(MEMBER, 'POST', '/auth/login', { id: m.essl_id, password: 'secret1' });
check('login works again when switched on', r.status === 200);

console.log('\n── multi-select food preference');
const base = { age: 28, gender: 'male', height_cm: 172, weight_kg: 82.5, goal: 'lose_weight', activity: 'moderate' };
r = await call(MEMBER, 'PUT', '/fit/profile', { ...base, diet_pref: ['egg', 'veg', 'bogus'] }, mc);
check('array saved in fixed order, junk dropped', r.status === 200 && r.data.profile.diet_pref === 'veg,egg' && r.data.profile.diet_prefs.join() === 'veg,egg', r.data.profile?.diet_pref);
r = await call(MEMBER, 'PUT', '/fit/profile', { ...base, diet_pref: 'nonveg' }, mc);
check('old single-value format still accepted', r.data.profile.diet_prefs.join() === 'nonveg');
r = await call(MEMBER, 'PUT', '/fit/profile', { ...base, diet_pref: [] }, mc);
check('empty selection → no preference', r.data.profile.diet_pref === null);

console.log('\n── admin food database: pagination & filters');
r = await call(ADMIN, 'GET', '/foods?size=25&page=1', undefined, admin);
check('page 1 of visible foods, 25 rows', r.data.foods.length === 25 && r.data.pages === Math.ceil(r.data.total / 25) && r.data.total > 1000, { total: r.data.total, pages: r.data.pages });
const p1 = r.data.foods.map((f: any) => f.id);
r = await call(ADMIN, 'GET', '/foods?size=25&page=2', undefined, admin);
check('page 2 has different rows', r.data.page === 2 && r.data.foods.every((f: any) => !p1.includes(f.id)));
r = await call(ADMIN, 'GET', '/foods?veg=nonveg&size=100', undefined, admin);
check('type filter: non-veg only', r.data.foods.length > 0 && r.data.foods.every((f: any) => f.veg === 'nonveg') && r.data.total === r.data.stats.nonveg, { total: r.data.total, stat: r.data.stats.nonveg });
r = await call(ADMIN, 'GET', '/foods?source=basic&sort=protein&size=100', undefined, admin);
check('source filter + sort by protein', r.data.foods.every((f: any) => f.source === 'basic') && r.data.foods[0].protein >= r.data.foods[r.data.foods.length - 1].protein, r.data.foods[0]?.name);
r = await call(ADMIN, 'GET', '/foods?q=paneer&veg=veg&sort=kcal_desc', undefined, admin);
check('search + type + sort combine', r.data.foods.length > 0 && r.data.foods.every((f: any) => /paneer/i.test(f.name) && f.veg === 'veg') && r.data.foods[0].kcal >= r.data.foods[r.data.foods.length - 1].kcal);
r = await call(ADMIN, 'GET', '/foods?status=hidden', undefined, admin);
check('hidden filter', r.data.foods.every((f: any) => f.active === 0));

console.log('\n── admin exercise library');
r = await call(ADMIN, 'GET', '/fitness/exercises?body=chest&photos=yes&size=24', undefined, admin);
check('filter chest + with photo, facets on page 1', r.data.exercises.length === 24 && r.data.exercises.every((e: any) => e.body_part === 'chest' && e.images.length) && r.data.facets?.body_parts.length >= 8, r.data.total);
r = await call(ADMIN, 'GET', '/fitness/exercises?body=chest&photos=yes&size=24&page=2', undefined, admin);
check('page 2 without facets', r.data.page === 2 && r.data.facets === null);
const ex1 = r.data.exercises[0];
r = await call(ADMIN, 'PATCH', `/fitness/exercises/${encodeURIComponent(ex1.id)}`, { popular: !ex1.popular, active: false }, admin);
const after1 = sql(`SELECT popular, active FROM exercises WHERE id='${ex1.id}'`)[0];
check('pin/unpin popular + hide', r.status === 200 && after1.popular === (ex1.popular ? 0 : 1) && after1.active === 0, after1);
r = await call(MEMBER, 'GET', `/fit/exercises?q=${encodeURIComponent(ex1.name)}`, undefined, mc);
check('hidden exercise not offered to members', !r.data.results.some((e: any) => e.id === ex1.id));
await call(ADMIN, 'PATCH', `/fitness/exercises/${encodeURIComponent(ex1.id)}`, { popular: !!ex1.popular, active: true }, admin);
check('restored', sql(`SELECT popular, active FROM exercises WHERE id='${ex1.id}'`)[0].active === 1);
const img2 = await fetch(`${ADMIN}/fitness/media/${ex1.images[0]}`, { headers: { Cookie: admin } });
check('admin exercise photo served', img2.status === 200 && (img2.headers.get('content-type') ?? '').includes('image'));
sql(`UPDATE exercises SET edited=0 WHERE id='${ex1.id}'`);

console.log('\n── admin exercise editing');
const upload = async (type: string, bytes: Uint8Array) => {
  const u = await fetch(`${ADMIN}/fitness/media`, { method: 'PUT', headers: { Cookie: admin, 'Content-Type': type }, body: bytes });
  return { status: u.status, data: await u.json() as any };
};
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='), (ch) => ch.charCodeAt(0));
const vid = new Uint8Array(4096).map((_, i) => i % 251);
let up = await upload('text/html', png);
check('upload rejects non-media types', up.status === 400, up);
up = await upload('image/png', png);
const pngPath = up.data.path;
check('photo upload → u/<uuid>.png', up.status === 200 && /^u\/[a-f0-9-]{36}\.png$/.test(pngPath), up);
up = await upload('video/mp4', vid);
const vidPath = up.data.path;
check('video upload → u/<uuid>.mp4', up.status === 200 && /\.mp4$/.test(vidPath), up);
r = await call(ADMIN, 'POST', '/fitness/exercises', { name: 'Test Landmine Press', body_part: 'Shoulders', target: 'delts', secondary: ['Triceps'], equipment: 'barbell',
  description: 'Shoulder-friendly press.\nKeep ribs down.', instructions: ['Hold the bar end', 'Press up and forward'], images: [pngPath, ex1.images[0]], video: vidPath }, admin);
const gid = r.data.id;
check('create gym exercise', r.status === 200 && /^gym-/.test(gid), r.data);
r = await call(ADMIN, 'GET', `/fitness/exercises/${gid}`, undefined, admin);
check('detail returns all fields (lower-cased taxonomy)', r.data.body_part === 'shoulders' && r.data.secondary[0] === 'triceps' && r.data.images.length === 2
  && r.data.video === vidPath && r.data.source === 'gym' && r.data.edited === 1 && r.data.description.includes('\n'), r.data);
const m1 = await fetch(`${MEMBER}/fit/media/${pngPath}`);
check('member app serves uploaded photo', m1.status === 200 && m1.headers.get('content-type') === 'image/png');
const m2 = await fetch(`${MEMBER}/fit/media/${vidPath}`, { headers: { Range: 'bytes=100-199' } });
const part = new Uint8Array(await m2.arrayBuffer());
check('video served with Range (206)', m2.status === 206 && m2.headers.get('content-range') === 'bytes 100-199/4096' && part.length === 100 && part[0] === 100 % 251,
  { s: m2.status, cr: m2.headers.get('content-range'), n: part.length });
check('bad media path → 404', (await fetch(`${MEMBER}/fit/media/u%2F..%2F..%2Fphotos%2Fx.jpg`)).status === 404);
r = await call(MEMBER, 'GET', `/fit/exercises/${gid}`, undefined, mc);
check('member sees description + video + steps', r.data.description?.startsWith('Shoulder') && r.data.video === vidPath && r.data.instructions.length === 2, r.data);
r = await call(ADMIN, 'PATCH', `/fitness/exercises/${gid}`, { images: ['../../secret/0.jpg'] }, admin);
check('rejects unknown image paths', r.status === 400, r.data);
r = await call(ADMIN, 'PATCH', `/fitness/exercises/${gid}`, { video: 'javascript:alert(1)' }, admin);
check('rejects non-https video links', r.status === 400, r.data);
r = await call(ADMIN, 'PATCH', `/fitness/exercises/${gid}`, { images: [ex1.images[0]], video: 'https://youtu.be/dQw4w9WgXcQ', met: 6.5, tracking: 'sets' }, admin);
check('edit media + fields', r.status === 200 && sql(`SELECT video, met FROM exercises WHERE id='${gid}'`)[0].met === 6.5, r.data);
await new Promise((res) => setTimeout(res, 500));
check('replaced uploads removed from storage', (await fetch(`${MEMBER}/fit/media/${pngPath}`)).status === 404 && (await fetch(`${MEMBER}/fit/media/${vidPath}`)).status === 404);
r = await call(ADMIN, 'DELETE', `/fitness/exercises/${encodeURIComponent(ex1.id)}`, {}, admin);
check('built-in exercises cannot be deleted', r.status === 400, r.data);
r = await call(ADMIN, 'DELETE', `/fitness/exercises/${gid}`, {}, admin);
check('delete gym exercise', r.status === 200 && sql(`SELECT COUNT(*) AS n FROM exercises WHERE id='${gid}'`)[0].n === 0, r.data);
r = await call(ADMIN, 'GET', '/fitness/overview', undefined, admin);
check('overview counts + goals', r.data.counts.onboarded >= 1 && r.data.goals.length >= 1 && r.data.top_foods.length >= 1, r.data.counts);

console.log('\n── cleanup');
sql(`DELETE FROM food_logs WHERE member_id=${m.id}; DELETE FROM workout_logs WHERE member_id=${m.id}; DELETE FROM weight_logs WHERE member_id=${m.id};
     DELETE FROM water_logs WHERE member_id=${m.id}; DELETE FROM fitness_profiles WHERE member_id=${m.id}; DELETE FROM foods WHERE owner_member_id=${m.id};
     DELETE FROM accounts WHERE member_id=${m.id}; DELETE FROM login_attempts; UPDATE members SET gender=NULL WHERE id=${m.id} AND gender='male'`);
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
