// Builds seed/fitness.sql (foods + exercise library) for D1.
//   node scripts/build-fitness-seed.mjs
//   npm run db:fitness:local   (or :remote)
//
// Sources
//   • Foods: seed/data/indian_foods.json — 1,016 Indian dishes per 100 g (Indian Nutrient Databank,
//     exported from the previous app's database) + BASIC foods below (USDA FoodData Central, public domain).
//   • Exercises: hasaneyldrm/exercises-dataset (MIT; data + instruction text only — its images/GIFs are
//     © Gym visual and are NOT used) and yuhonas/free-exercise-db (Unlicense) for photos.
// Idempotent: fixed ids + INSERT OR REPLACE, so member logs stay linked when re-seeded.
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, 'seed', 'data', 'cache');
mkdirSync(cacheDir, { recursive: true });

async function cached(name, url) {
  const p = join(cacheDir, name);
  if (!existsSync(p)) {
    console.log(`downloading ${url}`);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    writeFileSync(p, await r.text());
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

const q = (v) => (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const r1 = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 10) / 10);
const title = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bV\. /g, 'v. ');

// ── Foods ───────────────────────────────────────────────────────────────
// [name, kcal, protein, carbs, fat, serving_g, serving_label, veg]  per 100 g — USDA FDC (public domain)
const BASIC = [
  ['Rice, white, cooked', 130, 2.7, 28.2, 0.3, 150, '1 bowl (150 g)', 'veg'],
  ['Rice, brown, cooked', 123, 2.7, 25.6, 1.0, 150, '1 bowl (150 g)', 'veg'],
  ['Quinoa, cooked', 120, 4.4, 21.3, 1.9, 150, '1 bowl (150 g)', 'veg'],
  ['Oats, rolled (dry)', 389, 16.9, 66.3, 6.9, 40, '1 serving (40 g)', 'veg'],
  ['Muesli', 367, 10, 66, 6, 45, '1 bowl (45 g)', 'veg'],
  ['Cornflakes', 357, 7.5, 84, 0.4, 30, '1 bowl (30 g)', 'veg'],
  ['Bread, white', 265, 9, 49, 3.2, 25, '1 slice (25 g)', 'veg'],
  ['Bread, brown / whole wheat', 247, 13, 41, 3.4, 28, '1 slice (28 g)', 'veg'],
  ['Egg, whole, boiled', 155, 12.6, 1.1, 10.6, 50, '1 egg (50 g)', 'egg'],
  ['Egg white, boiled', 52, 10.9, 0.7, 0.2, 33, '1 egg white (33 g)', 'egg'],
  ['Omelette (1 egg, little oil)', 154, 10.6, 0.6, 11.7, 60, '1 omelette (60 g)', 'egg'],
  ['Chicken breast, grilled', 165, 31, 0, 3.6, 120, '1 piece (120 g)', 'nonveg'],
  ['Chicken thigh, cooked', 209, 26, 0, 10.9, 100, '1 piece (100 g)', 'nonveg'],
  ['Fish, grilled (white fish)', 128, 26, 0, 2.7, 120, '1 piece (120 g)', 'nonveg'],
  ['Mutton / lamb, cooked', 294, 25, 0, 21, 100, '1 serving (100 g)', 'nonveg'],
  ['Prawns, cooked', 99, 24, 0.2, 0.3, 100, '1 serving (100 g)', 'nonveg'],
  ['Paneer', 265, 18.3, 1.2, 20.8, 50, '50 g', 'veg'],
  ['Tofu', 76, 8, 1.9, 4.8, 100, '100 g', 'veg'],
  ['Soya chunks (dry)', 345, 52, 33, 0.5, 30, '1 serving (30 g)', 'veg'],
  ['Milk, toned', 58, 3.2, 4.7, 3.0, 200, '1 glass (200 ml)', 'veg'],
  ['Milk, full cream', 61, 3.2, 4.8, 3.3, 200, '1 glass (200 ml)', 'veg'],
  ['Curd / plain yogurt', 61, 3.5, 4.7, 3.3, 150, '1 bowl (150 g)', 'veg'],
  ['Greek yogurt, plain', 59, 10, 3.6, 0.4, 150, '1 bowl (150 g)', 'veg'],
  ['Whey protein powder', 400, 80, 8, 6, 30, '1 scoop (30 g)', 'veg'],
  ['Protein bar', 350, 30, 40, 9, 60, '1 bar (60 g)', 'veg'],
  ['Peanut butter', 588, 25, 20, 50, 32, '2 tbsp (32 g)', 'veg'],
  ['Peanuts, roasted', 567, 25.8, 16.1, 49.2, 30, '1 handful (30 g)', 'veg'],
  ['Almonds', 579, 21.2, 21.6, 49.9, 28, '1 handful (28 g)', 'veg'],
  ['Cashews', 553, 18.2, 30.2, 43.9, 28, '1 handful (28 g)', 'veg'],
  ['Walnuts', 654, 15.2, 13.7, 65.2, 28, '1 handful (28 g)', 'veg'],
  ['Dates', 277, 1.8, 75, 0.2, 24, '3 dates (24 g)', 'veg'],
  ['Banana', 89, 1.1, 22.8, 0.3, 118, '1 medium (118 g)', 'veg'],
  ['Apple', 52, 0.3, 13.8, 0.2, 182, '1 medium (182 g)', 'veg'],
  ['Orange', 47, 0.9, 11.8, 0.1, 130, '1 medium (130 g)', 'veg'],
  ['Mango', 60, 0.8, 15, 0.4, 165, '1 cup (165 g)', 'veg'],
  ['Papaya', 43, 0.5, 10.8, 0.3, 140, '1 cup (140 g)', 'veg'],
  ['Watermelon', 30, 0.6, 7.6, 0.2, 280, '1 bowl (280 g)', 'veg'],
  ['Grapes', 69, 0.7, 18, 0.2, 90, '1 cup (90 g)', 'veg'],
  ['Potato, boiled', 87, 1.9, 20.1, 0.1, 150, '1 medium (150 g)', 'veg'],
  ['Sweet potato, boiled', 76, 1.4, 17.7, 0.1, 150, '1 medium (150 g)', 'veg'],
  ['Chickpeas (chana), boiled', 164, 8.9, 27.4, 2.6, 150, '1 bowl (150 g)', 'veg'],
  ['Kidney beans (rajma), boiled', 127, 8.7, 22.8, 0.5, 150, '1 bowl (150 g)', 'veg'],
  ['Moong sprouts', 30, 3, 5.9, 0.2, 100, '1 bowl (100 g)', 'veg'],
  ['Cucumber', 15, 0.7, 3.6, 0.1, 100, '1 cup (100 g)', 'veg'],
  ['Tomato', 18, 0.9, 3.9, 0.2, 120, '1 medium (120 g)', 'veg'],
  ['Ghee', 900, 0, 0, 100, 5, '1 tsp (5 g)', 'veg'],
  ['Butter', 717, 0.9, 0.1, 81, 10, '1 tbsp (10 g)', 'veg'],
  ['Cooking oil', 884, 0, 0, 100, 5, '1 tsp (5 g)', 'veg'],
  ['Sugar', 387, 0, 100, 0, 5, '1 tsp (5 g)', 'veg'],
  ['Honey', 304, 0.3, 82, 0, 21, '1 tbsp (21 g)', 'veg'],
  ['Coconut water', 19, 0.7, 3.7, 0.2, 240, '1 glass (240 ml)', 'veg'],
  ['Black coffee', 2, 0.3, 0, 0, 240, '1 cup (240 ml)', 'veg'],
];

// Serving presets for Indian dishes by keyword (first match wins)
const SERVINGS = [
  [/\b(roti|chapati|phulka|rumali)\b/i, 40, '1 roti (40 g)'],
  [/\b(parantha|paratha|thepla|kulcha|naan|bhatura)\b/i, 80, '1 piece (80 g)'],
  [/\b(poori|puri)\b/i, 30, '1 poori (30 g)'],
  [/\bidli\b/i, 45, '1 idli (45 g)'],
  [/\b(dosa|dosai|uttapam|chilla|cheela|pesarattu)\b/i, 110, '1 piece (110 g)'],
  [/\b(vada|vadai|bonda|kachori|samosa|cutlet|tikki|kebab|kabab)\b/i, 60, '1 piece (60 g)'],
  [/\b(pakora|pakoda|bhajji|bhaji)\b/i, 20, '1 piece (20 g)'],
  [/\b(ladoo|laddoo|laddu|barfi|burfi|peda|jalebi|gulab jamun|rasgulla|sandesh|halwa|mysore pak)\b/i, 40, '1 piece (40 g)'],
  [/\b(sandwich|burger|roll|wrap|frankie)\b/i, 150, '1 piece (150 g)'],
  [/\b(tea|chai|coffee)\b/i, 150, '1 cup (150 ml)'],
  [/\b(lassi|shake|smoothie|juice|milk|nog|sherbet|sharbat|chaas|buttermilk|lemonade|nimbu)\b/i, 200, '1 glass (200 ml)'],
  [/\b(soup|rasam|shorba)\b/i, 200, '1 bowl (200 ml)'],
  [/\b(rice|pulao|pulav|biryani|khichdi|khichri|poha|upma|pongal|bisibele|fried rice|noodles|pasta|maggi)\b/i, 200, '1 plate (200 g)'],
  [/\b(dal|daal|sambar|sambhar|curry|sabzi|subzi|kadhi|korma|masala|makhani|bharta|kofta|raita|kheer|payasam|chole|rajma|keema|stew|palak|paneer|aloo)\b/i, 150, '1 bowl (150 g)'],
  [/\b(salad|chaat)\b/i, 100, '1 bowl (100 g)'],
  [/\b(egg|anda|omelette)\b/i, 60, '1 egg dish (60 g)'],
  [/\b(cake|pastry|muffin|brownie)\b/i, 60, '1 slice (60 g)'],
  [/\b(biscuit|cookie)\b/i, 12, '1 biscuit (12 g)'],
];
const NONVEG = /\b(chicken|murg|murgh|mutton|gosht|lamb|goat|fish|machli|machhi|prawn|shrimp|crab|keema|kheema|beef|pork|meat|ham|bacon|sausage|salami|liver|tuna|sardine)\b/i;
const EGG = /\b(egg|eggs|anda|ande|omelette|omelet)\b/i;

function foodRows() {
  const rows = [];
  BASIC.forEach(([name, kcal, p, c, f, sg, sl, veg], i) =>
    rows.push({ id: 1 + i, name, kcal, protein: p, carbs: c, fat: f, fiber: null, sugar: null, sodium_mg: null, serving_g: sg, serving_label: sl, veg, source: 'basic' }));
  const indb = JSON.parse(readFileSync(join(root, 'seed', 'data', 'indian_foods.json'), 'utf8'));
  let skipped = 0;
  for (const d of indb) {
    const kcal = Number(d.calories_kcal);
    if (!d.dish_name || !(kcal >= 0) || kcal > 950) { skipped++; continue; }
    const name = d.dish_name.trim();
    const sv = SERVINGS.find(([re]) => re.test(name));
    rows.push({
      id: 1000 + Number(d.id), name, kcal: r1(kcal), protein: r1(d.protein_g) ?? 0, carbs: r1(d.carbohydrates_g) ?? 0, fat: r1(d.fats_g) ?? 0,
      fiber: r1(d.fibre_g), sugar: r1(d.free_sugar_g), sodium_mg: r1(d.sodium_mg),
      serving_g: sv ? sv[1] : 100, serving_label: sv ? sv[2] : '100 g',
      veg: NONVEG.test(name) ? 'nonveg' : EGG.test(name) ? 'egg' : 'veg', source: 'indb',
    });
  }
  return { rows, skipped };
}

// ── Exercises ───────────────────────────────────────────────────────────
const STOP = new Set(['the', 'a', 'with', 'on', 'of', 'to', 'and', 'medium', 'grip', 'version', 'v', 'exercise', 'style', 'alternate', 'alternating']);
const EQ = { 'body weight': 'body only', 'body only': 'body only', dumbbell: 'dumbbell', barbell: 'barbell', 'ez barbell': 'e-z curl bar', 'e-z curl bar': 'e-z curl bar',
  cable: 'cable', kettlebell: 'kettlebells', kettlebells: 'kettlebells', band: 'bands', bands: 'bands', 'leverage machine': 'machine', 'smith machine': 'machine',
  machine: 'machine', 'stability ball': 'exercise ball', 'exercise ball': 'exercise ball' };
const tokens = (s) => [...new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)).map((w) => w.replace(/s$/, '')))].sort().join(' ');

const FE_BODY = { chest: 'chest', lats: 'back', 'middle back': 'back', 'lower back': 'back', traps: 'back', shoulders: 'shoulders', neck: 'neck',
  biceps: 'upper arms', triceps: 'upper arms', forearms: 'lower arms', quadriceps: 'upper legs', hamstrings: 'upper legs', glutes: 'upper legs',
  adductors: 'upper legs', abductors: 'upper legs', calves: 'lower legs', abdominals: 'waist' };
const FE_MET = { strength: 5.0, powerlifting: 6.0, 'olympic weightlifting': 6.0, strongman: 7.0, plyometrics: 8.0, cardio: 7.0, stretching: 2.3 };
const NAME_MET = [[/\b(run|running|sprint)\b/i, 9.8], [/\bjog/i, 7.0], [/\bwalk/i, 3.5], [/\b(cycl|bike|bicycl)/i, 7.5], [/\b(jump rope|rope jump|skip)/i, 11.0],
  [/\browing\b|\brower\b/i, 7.0], [/elliptical/i, 5.0], [/burpee/i, 8.0], [/\bswim/i, 8.0], [/stair|step mill|stepmill/i, 9.0]];

const POPULAR = [
  'barbell bench press', 'barbell full squat', 'barbell deadlift', 'dumbbell bench press', 'dumbbell incline bench press', 'push-up', 'pull-up',
  'cable pulldown', 'lat pulldown', 'barbell bent over row', 'dumbbell bent over row', 'seated cable row', 'cable seated row',
  'dumbbell shoulder press', 'barbell seated overhead press', 'dumbbell lateral raise', 'barbell curl', 'dumbbell biceps curl', 'dumbbell hammer curl',
  'cable pushdown', 'triceps pushdown', 'dumbbell kickback', 'lever leg extension', 'lever lying leg curl', 'sled 45° leg press', 'leg press',
  'barbell hip thrust', 'dumbbell lunge', 'lever standing calf raise', 'plank', 'front plank', 'crunch floor', 'crunches', 'hanging leg raise',
  'cable fly', 'dumbbell fly', 'chin-up', 'dips', 'chest dip', 'romanian deadlift', 'dumbbell goblet squat',
  'treadmill running', 'walking', 'stationary cycling', 'elliptical trainer', 'rowing machine', 'jump rope',
].map((s) => s.toLowerCase());

// A few everyday cardio entries the datasets lack or name oddly (MET: Compendium of Physical Activities)
const CARDIO = [
  ['cg-treadmill-running', 'Treadmill running', 9.8], ['cg-walking', 'Walking', 3.5], ['cg-brisk-walking', 'Brisk walking', 4.3],
  ['cg-stationary-cycling', 'Stationary cycling', 7.0], ['cg-elliptical', 'Elliptical trainer', 5.0], ['cg-rowing', 'Rowing machine', 7.0],
  ['cg-jump-rope', 'Jump rope', 11.0], ['cg-stair-climber', 'Stair climber', 9.0], ['cg-zumba', 'Zumba / aerobics', 7.3], ['cg-yoga', 'Yoga', 2.5],
  ['cg-swimming', 'Swimming', 8.0], ['cg-football', 'Football / cricket', 7.0],
];

async function exerciseRows() {
  const og = await cached('opengym-exercises.json', 'https://raw.githubusercontent.com/hasaneyldrm/exercises-dataset/main/data/exercises.json');
  const fe = await cached('free-exercise-db.json', 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json');
  const feByKey = new Map();
  for (const e of fe) {
    const key = `${tokens(e.name)}|${EQ[e.equipment] ?? e.equipment ?? ''}`;
    if (!feByKey.has(key)) feByKey.set(key, e);
  }
  const used = new Set();
  const rows = [];
  for (const o of og) {
    const key = `${tokens(o.name)}|${EQ[o.equipment] ?? o.equipment ?? ''}`;
    const match = feByKey.get(key);
    if (match) used.add(match.id);
    const steps = o.instruction_steps ?? {};
    const cardio = o.category === 'cardio' || o.body_part === 'cardio';
    const met = NAME_MET.find(([re]) => re.test(o.name))?.[1] ?? (cardio ? 7.5 : 5.0);
    rows.push({
      id: `og-${o.id}`, name: title(o.name), body_part: o.body_part, target: o.target, secondary: JSON.stringify(o.secondary_muscles ?? []),
      equipment: o.equipment, category: cardio ? 'cardio' : 'strength', level: match?.level ?? null,
      instructions: JSON.stringify(steps.en ?? []), instructions_hi: steps.hi?.length ? JSON.stringify(steps.hi) : null,
      images: match?.images?.length ? JSON.stringify(match.images) : null, met, tracking: cardio ? 'time' : 'sets', source: 'opengym',
    });
  }
  for (const e of fe) {
    if (used.has(e.id)) continue;
    const primary = e.primaryMuscles?.[0] ?? '';
    const timeBased = e.category === 'cardio' || e.category === 'stretching';
    rows.push({
      id: `fe-${e.id}`, name: e.name, body_part: e.category === 'cardio' ? 'cardio' : FE_BODY[primary] ?? 'other', target: primary,
      secondary: JSON.stringify(e.secondaryMuscles ?? []), equipment: e.equipment ?? 'body only', category: e.category, level: e.level ?? null,
      instructions: JSON.stringify(e.instructions ?? []), instructions_hi: null, images: e.images?.length ? JSON.stringify(e.images) : null,
      met: NAME_MET.find(([re]) => re.test(e.name))?.[1] ?? FE_MET[e.category] ?? 5.0, tracking: timeBased ? 'time' : 'sets', source: 'fedb',
    });
  }
  const names = new Set(rows.map((r) => r.name.toLowerCase()));
  for (const [id, name, met] of CARDIO) {
    if (names.has(name.toLowerCase())) continue; // dataset already has it (e.g. "Jump Rope")
    rows.push({ id, name, body_part: 'cardio', target: 'cardiovascular system', secondary: '[]', equipment: 'other', category: 'cardio', level: 'beginner',
      instructions: '[]', instructions_hi: null, images: null, met, tracking: 'time', source: 'challenge-gym' });
  }
  // Popular: exact name hits, preferring entries with photos; plus all built-in cardio
  const hits = new Set();
  for (const p of POPULAR) {
    const cands = rows.filter((r) => r.name.toLowerCase() === p);
    const best = cands.find((r) => r.images) ?? cands[0];
    if (best) hits.add(best.id);
  }
  for (const [id, name] of CARDIO) hits.add(rows.find((r) => r.id === id)?.id ?? rows.find((r) => r.name.toLowerCase() === name.toLowerCase())?.id);
  hits.delete(undefined);
  rows.forEach((r) => { r.popular = hits.has(r.id) ? 1 : 0; r.active = 1; });
  return { rows, ogCount: og.length, feCount: fe.length, withPhotos: rows.filter((r) => r.images).length, popular: hits.size };
}

function insertSql(table, cols, rows, per = 40, verb = 'INSERT OR REPLACE', suffix = '') {
  const out = [];
  for (let i = 0; i < rows.length; i += per) {
    out.push(`${verb} INTO ${table} (${cols.join(', ')}) VALUES\n` +
      rows.slice(i, i + per).map((r) => `(${cols.map((c) => q(r[c])).join(', ')})`).join(',\n') + (suffix ? `\n${suffix}` : '') + ';');
  }
  return out.join('\n');
}

const EX_COLS = ['id', 'name', 'body_part', 'target', 'secondary', 'equipment', 'category', 'level', 'instructions', 'instructions_hi', 'images', 'met', 'tracking', 'popular', 'source', 'active'];
const foods = foodRows();
const ex = await exerciseRows();
const sql = [
  '-- Generated by scripts/build-fitness-seed.mjs — do not edit by hand.',
  '-- Exercise data: hasaneyldrm/exercises-dataset (MIT, text only) + yuhonas/free-exercise-db photos (Unlicense).',
  '-- Foods: Indian Nutrient Databank dishes + USDA FoodData Central basics (public domain). Values per 100 g.',
  // Foods: insert-if-missing so admin corrections survive a re-seed.
  insertSql('foods', ['id', 'name', 'kcal', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium_mg', 'serving_g', 'serving_label', 'veg', 'source'], foods.rows, 40, 'INSERT OR IGNORE'),
  // Exercises: seeded rows not in this build become inactive (kept for workout history).
  // Rows an admin has edited (edited=1) are left exactly as they are. Upsert, not REPLACE:
  // REPLACE deletes the row first, which would null out workout_logs.exercise_id.
  "UPDATE exercises SET active=0 WHERE source IN ('opengym','fedb','challenge-gym') AND edited=0;",
  insertSql('exercises', EX_COLS, ex.rows, 25, 'INSERT',
    `ON CONFLICT(id) DO UPDATE SET ${EX_COLS.filter((c) => c !== 'id').map((c) => `${c}=excluded.${c}`).join(', ')} WHERE exercises.edited=0`),
].join('\n\n');
// Local D1 chokes on multi-MB files, so write ~300 KB parts (seed/fitness/NN.sql) loaded in order.
const partsDir = join(root, 'seed', 'fitness');
mkdirSync(partsDir, { recursive: true });
for (const f of readdirSync(partsDir)) if (f.endsWith('.sql')) unlinkSync(join(partsDir, f));
const statements = sql.split(/;\n+(?=INSERT|UPDATE|--)/).map((s) => s.trim()).filter(Boolean).map((s) => (s.endsWith(';') ? s : `${s};`));
let part = [];
let size = 0;
let n = 0;
const flush = () => {
  if (!part.length) return;
  writeFileSync(join(partsDir, `${String(++n).padStart(2, '0')}.sql`), part.join('\n'));
  part = [];
  size = 0;
};
for (const st of statements) {
  if (size + st.length > 300_000) flush();
  part.push(st);
  size += st.length;
}
flush();
console.log(`foods: ${foods.rows.length} (${BASIC.length} basic + ${foods.rows.length - BASIC.length} Indian, skipped ${foods.skipped})`);
console.log(`exercises: ${ex.rows.length} (openGym ${ex.ogCount}, free-exercise-db extra ${ex.rows.filter((r) => r.source === 'fedb').length}, built-in cardio ${CARDIO.length}) · with photos ${ex.withPhotos} · popular ${ex.popular}`);
console.log(`wrote seed/fitness/01..${String(n).padStart(2, '0')}.sql (${Math.round(sql.length / 1024)} KB total)`);
