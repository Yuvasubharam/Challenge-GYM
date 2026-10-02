// AI coach planning rules — pure functions (unit-tested in test/planner.test.ts).
//
// The AI picks *which* foods/exercises fit the member; these rules own everything that must
// be right regardless of what a model says:
//   • workouts: the split for the number of days, one slot per movement pattern so every
//     muscle group is covered, and the session order (warm-up → big compound lifts →
//     isolation → core → cardio → stretch), plus sets/reps/rest for the goal;
//   • diet: which catalog foods are eligible for the diet preference, and scaling portions
//     so each day lands on the member's calorie target with real nutrition values.
import type { Activity, Goal } from './fitness';
import { round } from './fitness';

// ── Workouts ────────────────────────────────────────────────────────────
/** 'custom' = a day built from the muscles the member asked for (see requestedDay). */
export type DayType = 'full' | 'push' | 'pull' | 'legs' | 'upper' | 'lower' | 'cardio_core' | 'custom' | 'rest';
export const FOCUSES: DayType[] = ['full', 'push', 'pull', 'legs', 'upper', 'lower', 'cardio_core'];

export const DAY_TITLE: Record<DayType, string> = {
  full: 'Full body', push: 'Push — chest, shoulders, triceps', pull: 'Pull — back, biceps', legs: 'Legs — quads, hamstrings, glutes, calves',
  upper: 'Upper body', lower: 'Lower body & core', cardio_core: 'Cardio & core', custom: 'Your focus', rest: 'Rest & recovery',
};

type Role = 'warmup' | 'compound' | 'iso' | 'core' | 'cardio' | 'stretch' | 'walk';

export interface SlotDef {
  role: Role;
  label: string;
  body?: string[];     // exercises.body_part
  target?: string[];   // exercises.target
  category?: string;
  time?: boolean;      // time-tracked exercises only
  name?: RegExp;       // must match
  not?: RegExp;        // must not match
}

const CARDIO_MACHINES = /treadmill|walk|cycl|bike|elliptical|rowing|jump rope|stair|skierg/i;
const CORE_MOVES = /crunch|plank|leg raise|sit-?up|twist|dead bug|mountain climber|ab roll|rollout|v-up|bicycle|hollow|knee raise/i;
const CURLS = /curl/i;

export const SLOTS: Record<string, SlotDef> = {
  warmup:         { role: 'warmup', label: 'Warm-up', body: ['cardio'], time: true, name: CARDIO_MACHINES, not: /swim|football|zumba|yoga|brisk/i },
  chest_press:    { role: 'compound', label: 'Chest press', body: ['chest'], name: /bench press|chest press|push-?up|press/i, not: /fly|crossover|pullover|close.?grip|decline|jump|clap/i },
  chest_2:        { role: 'iso', label: 'Chest (angle / fly)', body: ['chest'], name: /incline|fly|crossover|dip|pec deck/i, not: /stretch|decline/i },
  shoulder_press: { role: 'compound', label: 'Shoulder press', body: ['shoulders'], name: /overhead press|shoulder press|military|arnold|seated.*press|standing.*press/i, not: /bench|behind|one arm|single/i },
  shoulder_raise: { role: 'iso', label: 'Shoulder raise', body: ['shoulders'], name: /lateral raise|front raise|rear delt|reverse fly|face pull|upright row/i, not: /stretch|lying|incline/i },
  triceps:        { role: 'iso', label: 'Triceps', target: ['triceps'], name: /pushdown|extension|kickback|skull|dip|close.?grip/i, not: /one arm|single|stretch/i },
  triceps_2:      { role: 'iso', label: 'Triceps (overhead / dip)', target: ['triceps'], name: /overhead|dip|skull|close.?grip|lying.*extension/i, not: /one arm|single|stretch/i },
  vertical_pull:  { role: 'compound', label: 'Vertical pull', target: ['lats'], name: /pull-?up|chin-?up|pulldown|pull-down/i, not: /one arm|single|kneeling|straight arm|behind/i },
  row:            { role: 'compound', label: 'Row', body: ['back'], name: /row/i, not: /upright|one arm|single|inverted/i },
  rear_back:      { role: 'iso', label: 'Upper / lower back', body: ['back', 'shoulders'], name: /face pull|reverse fly|rear delt|shrug|back extension|hyperextension|superman/i, not: /stretch|clean|sled/i },
  lat_2:          { role: 'iso', label: 'Lats (2nd)', target: ['lats'], name: /pulldown|pull-down|pullover|straight.?arm|chin-?up|pull-?up/i, not: /behind|kneeling|one arm|single/i },
  upper_back:     { role: 'iso', label: 'Upper back', body: ['back', 'shoulders'], name: /face pull|reverse fly|rear delt|shrug|seated.*row|cable.*row|t-?bar/i, not: /stretch|clean|sled|one arm|single/i },
  lower_back:     { role: 'iso', label: 'Lower back', body: ['back', 'upper legs', 'waist'], name: /back extension|hyperextension|superman|good morning|bird dog|reverse hyper/i, not: /stretch|pins|hanging|stiff|chain|band/i },
  biceps:         { role: 'iso', label: 'Biceps curl', target: ['biceps'], name: CURLS, not: /hammer|one arm|single|reverse|drag|spider|zottman/i },
  biceps_2:       { role: 'iso', label: 'Biceps (hammer / preacher)', target: ['biceps'], name: /hammer|preacher|concentration|incline/i, not: /one arm|single/i },
  squat:          { role: 'compound', label: 'Squat / leg press', body: ['upper legs'], name: /squat|leg press/i, not: /jump|pistol|sissy|overhead|one leg|single|hack squat machine|split|stretch|sumo/i },
  hinge:          { role: 'compound', label: 'Hip hinge', body: ['upper legs', 'back'], name: /deadlift|hip thrust|glute bridge|good morning/i, not: /one leg|single|sumo|stiff|deficit|snatch|rack|clean/i },
  lunge:          { role: 'compound', label: 'Lunge / split squat', body: ['upper legs'], name: /lunge|split squat|step-?up/i, not: /jump|lateral|curtsy|stretch/i },
  ham_curl:       { role: 'iso', label: 'Hamstring curl', target: ['hamstrings'], name: /leg curl/i, not: /one leg|single|ball/i },
  quad_iso:       { role: 'iso', label: 'Leg extension', body: ['upper legs'], name: /leg extension/i, not: /one leg|single/i },
  calves:         { role: 'iso', label: 'Calves', target: ['calves'], name: /calf raise|calf press/i, not: /one leg|single|donkey/i },
  glute:          { role: 'iso', label: 'Glutes', body: ['upper legs'], name: /hip thrust|glute bridge|kickback|hip abduction|donkey kick|clamshell/i, not: /stretch|one leg|single|ham raise/i },
  core:           { role: 'core', label: 'Core', body: ['waist'], name: CORE_MOVES, not: /stretch|weighted|decline|hanging|dragon/i },
  core_2:         { role: 'core', label: 'Core (2nd)', body: ['waist'], name: CORE_MOVES, not: /stretch|weighted|decline|dragon/i },
  cardio:         { role: 'cardio', label: 'Cardio', body: ['cardio'], time: true, name: CARDIO_MACHINES, not: /swim|football|zumba|yoga/i },
  stretch:        { role: 'stretch', label: 'Cool-down stretch', category: 'stretching', not: /partner|foam|roller|ball/i },
  walk:           { role: 'walk', label: 'Easy walk', body: ['cardio'], time: true, name: /walk/i },
};

/** Session order inside every day: warm-up → compound → isolation → core → cardio → stretch. */
export const TEMPLATES: Record<DayType, string[]> = {
  full:        ['warmup', 'squat', 'chest_press', 'row', 'hinge', 'shoulder_press', 'core', 'cardio', 'stretch'],
  push:        ['warmup', 'chest_press', 'shoulder_press', 'chest_2', 'shoulder_raise', 'triceps', 'core', 'cardio', 'stretch'],
  pull:        ['warmup', 'vertical_pull', 'row', 'rear_back', 'biceps', 'biceps_2', 'core', 'cardio', 'stretch'],
  legs:        ['warmup', 'squat', 'hinge', 'lunge', 'ham_curl', 'quad_iso', 'calves', 'core', 'cardio', 'stretch'],
  upper:       ['warmup', 'chest_press', 'row', 'shoulder_press', 'vertical_pull', 'biceps', 'triceps', 'cardio', 'stretch'],
  lower:       ['warmup', 'squat', 'hinge', 'lunge', 'ham_curl', 'calves', 'core', 'core_2', 'cardio', 'stretch'],
  cardio_core: ['warmup', 'core', 'core_2', 'cardio', 'stretch'],
  custom:      ['warmup', 'stretch'], // filled from the request by requestedDay()
  rest:        ['walk', 'stretch'],
};

// ── The member's request → muscles to train, joints to protect ─────────
export type Muscle = 'chest' | 'lats' | 'upper_back' | 'lower_back' | 'shoulders' | 'biceps' | 'triceps' | 'quads' | 'hamstrings' | 'glutes' | 'calves' | 'abs' | 'cardio';
export type Joint = 'legs' | 'knees' | 'shoulders' | 'lower_back' | 'wrists';

export const MUSCLES: Record<Muscle, { label: string; slots: string[] }> = {
  chest:      { label: 'chest', slots: ['chest_press', 'chest_2'] },
  lats:       { label: 'lats', slots: ['vertical_pull', 'lat_2'] },
  upper_back: { label: 'upper back', slots: ['row', 'upper_back'] },
  lower_back: { label: 'lower back', slots: ['lower_back', 'hinge'] },
  shoulders:  { label: 'shoulders', slots: ['shoulder_press', 'shoulder_raise'] },
  biceps:     { label: 'biceps', slots: ['biceps', 'biceps_2'] },
  triceps:    { label: 'triceps', slots: ['triceps', 'triceps_2'] },
  quads:      { label: 'quads', slots: ['squat', 'quad_iso', 'lunge'] },
  hamstrings: { label: 'hamstrings', slots: ['hinge', 'ham_curl'] },
  glutes:     { label: 'glutes', slots: ['glute', 'lunge'] },
  calves:     { label: 'calves', slots: ['calves'] },
  abs:        { label: 'abs & core', slots: ['core', 'core_2'] },
  cardio:     { label: 'cardio', slots: ['cardio'] },
};
export const JOINT_LABEL: Record<Joint, string> = { legs: 'legs', knees: 'knees', shoulders: 'shoulders', lower_back: 'lower back', wrists: 'wrists' };
/** Muscles that are off-limits when a joint/region hurts (they are removed even if requested). */
export const JOINT_MUSCLES: Record<Joint, Muscle[]> = { legs: ['quads', 'hamstrings', 'glutes', 'calves'], knees: ['quads'], shoulders: ['shoulders'], lower_back: ['lower_back'], wrists: [] };

/** Slots dropped and exercise names excluded when a joint hurts. */
const JOINT_GUARD: Record<Joint, { slots: string[]; names: RegExp }> = {
  legs:       { slots: ['squat', 'lunge', 'quad_iso', 'ham_curl', 'calves', 'glute', 'hinge'], names: /squat|lunge|step-?up|jump|leg (press|extension|curl)|calf|hip thrust|glute|deadlift|good morning|run|sprint|stair|skip|burpee|box|bike|cycl|elliptical|treadmill/i },
  knees:      { slots: ['squat', 'lunge', 'quad_iso'], names: /squat|lunge|step-?up|jump|leg extension|leg press|run|sprint|stair|skip|burpee|box/i },
  shoulders:  { slots: ['shoulder_press', 'triceps_2'], names: /overhead|military|arnold|behind|upright row|dip|snatch|handstand|pull-?up|chin-?up/i },
  lower_back: { slots: ['hinge', 'lower_back'], names: /deadlift|good morning|bent.?over|hyperextension|back extension|superman|t-?bar|clean|swing|sit-?up/i },
  wrists:     { slots: [], names: /push-?up|dip|skull|front squat|clean|barbell curl/i },
};

// Keyword reading of the request (works without AI; Clef answers are merged on top).
const MUSCLE_WORDS: [RegExp, Muscle[]][] = [
  [/\bchest|\bpecs?\b|pectoral/i, ['chest']],
  [/\blats?\b|latissimus|\bwings?\b|v[- ]?taper|back width|wider back/i, ['lats']],
  [/upper[- ]back|\btraps?\b|trapezius|rhomboid|mid(dle)?[- ]back|rear delt/i, ['upper_back']],
  [/lower[- ]back|erector|lumbar/i, ['lower_back']],
  [/shoulders?|\bdelts?\b|deltoid/i, ['shoulders']],
  [/\bbiceps?\b|\bbis\b/i, ['biceps']],
  [/\btriceps?\b|\btris\b/i, ['triceps']],
  [/\barms?\b/i, ['biceps', 'triceps']],
  [/\bquads?\b|quadriceps|thighs?/i, ['quads']],
  [/hamstrings?|\bhams\b/i, ['hamstrings']],
  [/glutes?|\bbutt\b|buttocks|\bhips?\b/i, ['glutes']],
  [/\bcalf\b|calves/i, ['calves']],
  [/\blegs?\b|leg day|lower body/i, ['quads', 'hamstrings', 'glutes', 'calves']],
  [/\babs\b|abdominal|\bcore\b|belly|stomach|six[- ]?pack|\bwaist\b|obliques?/i, ['abs']],
  [/cardio|stamina|endurance|\bhiit\b|running|conditioning/i, ['cardio']],
  [/push day|\bpush\b workout/i, ['chest', 'shoulders', 'triceps']],
  [/pull day|\bpull\b workout/i, ['lats', 'upper_back', 'biceps']],
  [/upper body/i, ['chest', 'lats', 'upper_back', 'shoulders', 'biceps', 'triceps']],
];
const JOINT_WORDS: [RegExp, Joint][] = [
  [/\blegs?|thigh|calf|calves|hamstring|ankle|foot|feet|hip\b/i, 'legs'], [/knees?/i, 'knees'], [/shoulders?|rotator/i, 'shoulders'],
  [/lower[- ]?back|back ?(pain|injur|ache|hurt|sore|problem|issue|strain)|spine|disc|sciatica|lumbar/i, 'lower_back'], [/wrists?/i, 'wrists'],
];
const PAIN = /pain|injur|hurt|sore|ache|strain|sprain|surgery|operat|problem|torn|tear|slip|avoid|can'?t|cannot|\bno\b|\bnot\b|without/i;

/** Muscles the member asks to train and joints they mention as painful, read from free text. */
export function readRequest(text: string | null | undefined): { muscles: Muscle[]; avoid: Joint[] } {
  const muscles = new Set<Muscle>();
  const avoid = new Set<Joint>();
  // Split into clauses so "back and biceps due to leg pain, I can't do legs" keeps the request and the pain apart.
  const clauses = (text ?? '').split(/[.;,!?\n]|\bbut\b|\bexcept\b|\bdue to\b|\bbecause\b|\bsince\b|\bso\b|\bas i\b|\b(?=i (?:have|got|had|can'?t|cannot|am not|dont|don'?t)\b)|\b(?=(?:can'?t|cannot|not able to|unable to)\b)/i);
  for (const clause of clauses) {
    if (!clause.trim()) continue;
    if (PAIN.test(clause)) {
      for (const [re, j] of JOINT_WORDS) if (re.test(clause)) avoid.add(j);
      continue; // "lower back pain" is not a request to train the lower back
    }
    for (const [re, ms] of MUSCLE_WORDS) if (re.test(clause)) ms.forEach((m) => muscles.add(m));
    // A plain "back" means the whole back.
    if (/\bback\b/i.test(clause) && !/upper[- ]back|lower[- ]back|back width|wider back/i.test(clause)) ['lats', 'upper_back', 'lower_back'].forEach((m) => muscles.add(m as Muscle));
  }
  return withoutAvoided([...muscles], [...avoid]);
}

/** Painful regions win over requests: drop muscles that belong to an avoided region. */
export function withoutAvoided(muscles: Muscle[], avoid: Joint[]): { muscles: Muscle[]; avoid: Joint[] } {
  const off = new Set(avoid.flatMap((j) => JOINT_MUSCLES[j]));
  return { muscles: muscles.filter((m) => !off.has(m)), avoid };
}

/**
 * The slots of a day built from requested muscles: every muscle gets its main slot, then second
 * slots in turn, aiming for 5–7 strength exercises (compounds first). Core and cardio are added only
 * when asked for (cardio also when the goal prescribes it); warm-up and stretch always.
 */
export function requestedDay(muscles: Muscle[], goal: Goal, avoid: Joint[] = []): string[] {
  const blocked = new Set(avoid.flatMap((j) => JOINT_GUARD[j].slots));
  const strengthMuscles = muscles.filter((m) => m !== 'abs' && m !== 'cardio');
  const lists = strengthMuscles.map((m) => MUSCLES[m].slots.filter((s) => !blocked.has(s)));
  const max = strengthMuscles.length >= 5 ? 8 : 7;
  const picked: string[] = [];
  for (let round = 0; picked.length < max && lists.some((l) => l.length > round); round++) {
    for (const l of lists) if (l[round] && !picked.includes(l[round]) && picked.length < max) picked.push(l[round]);
  }
  const rank: Record<string, number> = { compound: 0, iso: 1 };
  const strength = picked.sort((a, b) => rank[SLOTS[a].role] - rank[SLOTS[b].role]);
  const core = muscles.includes('abs') ? ['core', 'core_2'] : [];
  const cardio = muscles.includes('cardio') || GOAL_RX[goal].cardio > 0 ? ['cardio'] : [];
  return ['warmup', ...strength, ...core, ...cardio, 'stretch'];
}

/** Title for a requested day, e.g. "Back — lats, upper back, lower back". */
export function requestedTitle(muscles: Muscle[]): string {
  const set = new Set(muscles);
  const back = (['lats', 'upper_back', 'lower_back'] as Muscle[]).every((m) => set.has(m));
  const legs = (['quads', 'hamstrings', 'glutes'] as Muscle[]).every((m) => set.has(m));
  const head = back && muscles.length <= 4 ? 'Back' : legs && muscles.length <= 5 ? 'Legs' : muscles.length === 1 ? MUSCLES[muscles[0]].label[0].toUpperCase() + MUSCLES[muscles[0]].label.slice(1) : 'Your focus';
  return `${head} — ${muscles.map((m) => MUSCLES[m].label).join(', ')}`;
}

/** Exercise names to leave out for painful joints. */
export const avoidPattern = (avoid: Joint[]): RegExp | null =>
  avoid.length ? new RegExp(avoid.map((j) => JOINT_GUARD[j].names.source).join('|'), 'i') : null;

/** Drop slots a painful joint rules out (template days), keeping warm-up/stretch. */
export const guardSlots = (slots: string[], avoid: Joint[]) => {
  const blocked = new Set(avoid.flatMap((j) => JOINT_GUARD[j].slots));
  return slots.filter((s) => !blocked.has(s));
};

/** Which day types to train for N training days (balanced: every muscle group each week). */
export function splitFor(trainingDays: number, goal: Goal): DayType[] {
  const hypertrophy = goal === 'build_muscle' || goal === 'gain_weight';
  switch (Math.max(1, Math.min(6, trainingDays))) {
    case 1: return ['full'];
    case 2: return ['full', 'full'];
    case 3: return hypertrophy ? ['push', 'pull', 'legs'] : ['full', 'full', 'full'];
    case 4: return ['upper', 'lower', 'upper', 'lower'];
    case 5: return ['push', 'pull', 'legs', 'upper', 'lower'];
    default: return ['push', 'pull', 'legs', 'push', 'pull', 'legs'];
  }
}

/** Training (T) / rest (R) pattern over 7 days, rest days spread out. */
const WEEK_PATTERN: Record<number, string> = { 2: 'TRRTRRR', 3: 'TRTRTRR', 4: 'TTRTTRR', 5: 'TTRTTTR', 6: 'TTTRTTT' };

/** Day types for a plan span. `trainDays` is used for the week (clamped 2–6). */
export function planDays(span: 'day' | '3days' | 'week', goal: Goal, opts: { focus?: DayType; trainDays?: number } = {}): DayType[] {
  if (span === 'day') return [opts.focus && FOCUSES.includes(opts.focus) ? opts.focus : 'full'];
  if (span === '3days') return splitFor(3, goal);
  const n = Math.max(2, Math.min(6, opts.trainDays ?? 4));
  const split = splitFor(n, goal);
  let i = 0;
  return [...WEEK_PATTERN[n]].map((c) => (c === 'T' ? split[i++] : 'rest'));
}

export interface Rx { sets: number | null; reps: string | null; rest_s: number | null; minutes: number | null }

const GOAL_RX: Record<Goal, { compound: [number, string, number]; iso: [number, string, number]; cardio: number }> = {
  build_muscle: { compound: [4, '8–10', 90], iso: [3, '10–12', 60], cardio: 0 },
  gain_weight:  { compound: [4, '6–8', 120], iso: [3, '8–12', 75], cardio: 0 },
  lose_weight:  { compound: [3, '12–15', 60], iso: [3, '12–15', 45], cardio: 20 },
  get_fit:      { compound: [3, '10–12', 75], iso: [3, '12', 60], cardio: 15 },
  maintain:     { compound: [3, '8–12', 75], iso: [3, '10–12', 60], cardio: 10 },
};

/** Sets/reps/rest (or minutes) for a slot. Beginners (little activity) cap at 3 working sets. */
export function prescribe(slot: string, goal: Goal, activity: Activity | null, dayType: DayType, timeTracked: boolean): Rx {
  const role = SLOTS[slot].role;
  const g = GOAL_RX[goal];
  const beginner = activity === 'sedentary' || activity === 'light';
  if (role === 'warmup') return { sets: null, reps: null, rest_s: null, minutes: 6 };
  if (role === 'stretch') return { sets: null, reps: null, rest_s: null, minutes: dayType === 'rest' ? 10 : 5 };
  if (role === 'walk') return { sets: null, reps: null, rest_s: null, minutes: 25 };
  if (role === 'cardio') return { sets: null, reps: null, rest_s: null, minutes: dayType === 'cardio_core' ? 30 : g.cardio };
  if (role === 'core') return timeTracked ? { sets: 3, reps: '30–45 s', rest_s: 45, minutes: null } : { sets: 3, reps: '15', rest_s: 45, minutes: null };
  const [sets, reps, rest] = role === 'compound' ? g.compound : g.iso;
  return { sets: beginner ? Math.min(3, sets) : sets, reps: timeTracked ? '30–45 s' : reps, rest_s: rest, minutes: null };
}

/** Slots for a day; the cardio finisher is dropped when the goal prescribes none. */
export function daySlots(dayType: DayType, goal: Goal): string[] {
  return TEMPLATES[dayType].filter((s) => !(s === 'cardio' && dayType !== 'cardio_core' && GOAL_RX[goal].cardio === 0));
}

export interface ExCandidate {
  id: string; name: string; body_part: string | null; target: string | null; equipment: string | null;
  category: string | null; level: string | null; images: string | null; tracking: string | null; popular: number;
}

const COMMON_EQUIPMENT = /^(barbell|dumbbell|cable|leverage machine|machine|body weight|body only|smith machine|ez barbell|e-z curl bar|kettlebell|other)$/;
const ODD_EQUIPMENT = /bosu|tire|sled|hammer|stability ball|exercise ball|medicine ball|band|roller|wheel|assisted|weighted|rope|trap bar|olympic/;

/** How suitable an exercise is as a default pick: well-known, has photos, common gym kit, not expert. */
export function exerciseScore(e: ExCandidate): number {
  let s = e.popular * 100 + (e.images ? 20 : 0);
  s += e.level === 'beginner' ? 10 : e.level === 'intermediate' ? 6 : e.level === 'expert' ? -25 : 3;
  const eq = (e.equipment ?? '').toLowerCase();
  if (COMMON_EQUIPMENT.test(eq)) s += 8; else if (ODD_EQUIPMENT.test(eq)) s -= 15;
  if (/\bv\.\s*\d|variation|version|alternat|with |on |\(|twisted|reverse grip/i.test(e.name)) s -= 8;
  return s - e.name.length / 4;
}

export function matchesSlot(e: ExCandidate, def: SlotDef): boolean {
  if (def.body && !def.body.includes(e.body_part ?? '')) return false;
  if (def.target && !def.target.includes(e.target ?? '')) return false;
  if (def.category && e.category !== def.category) return false;
  if (def.time && e.tracking !== 'time') return false;
  if (def.name && !def.name.test(e.name)) return false;
  if (def.not && def.not.test(e.name)) return false;
  return true;
}

/** Body-weight moves most beginners can't do for reps yet (a machine/assisted version is offered instead). */
const HARD_FOR_BEGINNERS = /pull-?up|chin-?up|chest dip|triceps dip|^dips?\b|hanging|muscle.?up|pistol|handstand|dragon/i;

/** Best `n` candidates per slot, ranked by suitability. */
export function slotCandidates(catalog: ExCandidate[], slots: string[], n = 8, beginner = false, exclude: RegExp | null = null): Record<string, ExCandidate[]> {
  const out: Record<string, ExCandidate[]> = {};
  for (const slot of slots) {
    const all = catalog.filter((e) => matchesSlot(e, SLOTS[slot]) && !(exclude && exclude.test(e.name)));
    const easy = beginner ? all.filter((e) => !HARD_FOR_BEGINNERS.test(e.name)) : all;
    out[slot] = (easy.length >= 2 ? easy : all)
      .sort((a, b) => exerciseScore(b) - exerciseScore(a) || (a.name < b.name ? -1 : 1))
      .slice(0, n);
  }
  return out;
}

/**
 * Final exercise per slot for one day: the AI's pick when it is a valid candidate and not already
 * used that day, otherwise the next unused candidate (rotated by `variant` so repeated day types differ).
 */
export function resolvePicks(slots: string[], cands: Record<string, ExCandidate[]>, aiPicks: Record<string, unknown> | unknown[] | undefined, variant = 0,
  previous: Record<string, string> = {}): { slot: string; ex: ExCandidate }[] {
  const used = new Set<string>();
  const out: { slot: string; ex: ExCandidate }[] = [];
  for (const [pos, slot] of slots.entries()) {
    const list = cands[slot] ?? [];
    if (!list.length) continue;
    // Main compound lifts repeat across same-type days (progressive overload); everything else rotates.
    const avoid = SLOTS[slot].role !== 'compound' && list.length > 1 ? previous[slot] : undefined;
    // Picks come keyed by slot (chat models) or by position in the day (Clef answers).
    const want = Array.isArray(aiPicks) ? aiPicks[pos] : aiPicks?.[slot];
    let ex = typeof want === 'string' && want !== avoid ? list.find((e) => e.id === want && !used.has(e.id)) : undefined;
    if (!ex) {
      const free = list.filter((e) => !used.has(e.id) && e.id !== avoid);
      ex = free.length ? free[variant % Math.min(free.length, 3)] : undefined;
    }
    if (!ex) continue;
    used.add(ex.id);
    out.push({ slot, ex });
  }
  return out;
}

// ── Diet ────────────────────────────────────────────────────────────────
export interface FoodCandidate {
  id: number; name: string; kcal: number; protein: number; carbs: number; fat: number;
  serving_g: number; serving_label: string; veg: string | null; source: string | null; uses: number;
}

/** Everyday, healthy home dishes that make sense in a daily plan. */
const PLAN_DISHES = /roti|chapati|phulka|paratha|thepla|idli|dosa|pesarattu|uttapam|upma|poha|daliya|dalia|oat|porridge|khichdi|pulao|\bdal\b|dal |sambar|rasam|rajma|chole|chana|channa|lobia|sprout|moong|curry|sabzi|bhujia|saag|palak|paneer|tofu|soya|raita|curd|lassi|buttermilk|chaas|salad|soup|dhokla|khaman|handvo|egg|omelette|chicken|fish|mutton|prawn|kebab|tikka|tandoori|appam|avial|poriyal|thoran|kootu|bhindi|aloo|gobi|baingan|vegetable|rice|quinoa|millet|jowar|bajra|ragi|makhana|sattu/i;
/** Desserts, fried snacks, sauces, bakery and other things a coach wouldn't schedule. */
const NOT_PLAN = /cake|pie|pastry|biscuit|cookie|ice cream|souffle|halwa|kheer|burfi|ladoo|pudding|tart|icing|sauce|stock|jam|sweet|gulab|rasgulla|chocolate|cheese|fried|pakora|samosa|kachori|poori|bhatura|pizza|pasta|sandwich|burger|noodle|chowmein|mayonnaise|chutney|masala$|pickle|korma|makhani|lababdar|shahi|malai|cream|butter chicken|manchurian|chilli|lasagne|pie|fool|mousse|squash|cooler|sharbat|nog|toast|finger|puffs|patties|cutlet|chops|roll\b|kofta|dressing|frosting|filling|flan|gateau|delight|aspic|nests|aigrettes|\b65\b|dip\b|murukku|vada|chikki|paras|premix|hawai|waldorf|waldroff|russian|macaroni|scotch|deviled|orly/i;
const FAT_SUGAR = /^(ghee|butter|cooking oil|sugar|honey|black coffee|cornflakes)$/i;
/** Condiments and ingredients, not meal items (curated dishes include these too). */
const CONDIMENT = /pickle|chutney|pachadi|pachchadi|thokku|papad|\braw\b|podi|powder|masala$|tadka only|sugar|jaggery|ghee|\boil\b/i;
/** Meat/fish dishes by name — some INDB rows carry a wrong veg tag (e.g. 'Boti kebab'). */
const MEAT_NAME = /chicken|mutton|fish|prawn|boti|shammi|keema|meat|lamb|salami|ham\b|bacon|beef|pork/i;
const DAIRY = /paneer|curd|milk|yogurt|lassi|raita|ghee|butter|cheese|cream|kheer|whey|buttermilk|chaas|malai|dahi|khoa|chhena|chenna/i;

/** Foods allowed by the member's diet preference (multi-select: 'veg,egg' etc.). */
export function dietAllows(veg: string | null, name: string, prefs: string[]): boolean {
  if (!prefs.length || prefs.includes('nonveg')) return true;
  if (veg === 'nonveg' || MEAT_NAME.test(name)) return false;
  if (veg === 'egg' && !prefs.includes('egg')) return false;
  if (!prefs.includes('egg') && /\beggs?\b|omelet|omelette|\banda\b|bhurji/i.test(name) && !/eggless|without egg|paneer bhurji/i.test(name)) return false; // mis-tagged egg dishes
  if (prefs.length === 1 && prefs[0] === 'vegan') return veg !== 'egg' && !DAIRY.test(name) && !/egg/i.test(name);
  return true;
}

/**
 * A diet preference stated in the member's request ("I am vegan", "only veg", "no egg") — it
 * overrides the profile for this plan. The strictest one mentioned wins. null = nothing stated.
 */
export function dietFromText(text: string | null | undefined): string[] | null {
  const t = (text ?? '').toLowerCase();
  if (!t.trim()) return null;
  if (/\bvegan\b|plant[- ]based|no dairy|dairy[- ]free|without dairy|no milk/.test(t)) return ['vegan'];
  const noEgg = /no eggs?\b|without eggs?|eggless|egg[- ]free|avoid eggs?|don'?t eat eggs?/.test(t);
  if (/only veg|veg only|pure veg|vegetarian|\bveg\b|no (meat|chicken|fish|mutton|non[- ]?veg)|without (meat|chicken|non[- ]?veg)|jain/.test(t)) {
    return !noEgg && /eggetarian|eggs? (are |is )?(ok|fine|allowed)|with eggs?|plus eggs?|and eggs?/.test(t) ? ['veg', 'egg'] : ['veg'];
  }
  if (/eggetarian/.test(t)) return ['veg', 'egg'];
  return null;
}

export function isPlanFood(f: FoodCandidate): boolean {
  if (f.source === 'custom') return true; // the member's own foods are always fair game
  if (FAT_SUGAR.test(f.name) || CONDIMENT.test(f.name)) return false;
  if (f.source === 'basic') return true;
  if (f.source === 'cg') return !NOT_PLAN.test(f.name) && !/bonda|bajji|jamun|jalebi|naan|puri|pakoda|laddu|payasam|mysore pak|bread omelette/i.test(f.name); // curated, photographed dishes
  return PLAN_DISHES.test(f.name) && !NOT_PLAN.test(f.name) && f.kcal > 0 && f.serving_g > 0;
}

/** Shortlist for the model: staples first, then the member's favourites, then popular dishes. */
export function dietCandidates(shared: FoodCandidate[], own: FoodCandidate[], recentIds: number[], prefs: string[], max = 170): FoodCandidate[] {
  const ok = (f: FoodCandidate) => isPlanFood(f) && dietAllows(f.veg, f.name, prefs);
  const recent = new Set(recentIds);
  const pool = [...own.map((f) => ({ ...f, source: 'custom' })), ...shared].filter(ok);
  const rank = (f: FoodCandidate) => (f.source === 'custom' ? 3000 : 0) + (recent.has(f.id) ? 2000 : 0) + (f.source === 'cg' ? 1200 : f.source === 'basic' ? 1000 : 0) + Math.min(f.uses, 500);
  const seen = new Set<number>();
  return pool.sort((a, b) => rank(b) - rank(a) || a.name.length - b.name.length)
    .filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)))
    .slice(0, max);
}

/** Foods counted in whole pieces (1 roti, 2 idli, 3 egg whites); bowls, plates, glasses and grams are portioned freely. */
export const isDiscrete = (f: { serving_label: string }) =>
  /^\d+\s*(roti|chapati|phulka|paratha|egg|idli|dosa|piece|slice|scoop|bar|handful|dates?|omelette|medium|biscuit|egg dish|egg white)\b/i.test(f.serving_label.trim());

export function roundGrams(f: { serving_g: number; serving_label: string }, grams: number): number {
  if (isDiscrete(f)) return round(Math.max(1, Math.round(grams / f.serving_g)) * f.serving_g, 1);
  return Math.max(10, Math.round(grams / 10) * 10);
}

export interface PlannedFood { food: FoodCandidate; grams: number; meal?: string; fixed?: boolean }

export const macrosFor = (f: FoodCandidate, grams: number) => ({
  kcal: round((f.kcal * grams) / 100), protein: round((f.protein * grams) / 100, 1), carbs: round((f.carbs * grams) / 100, 1), fat: round((f.fat * grams) / 100, 1),
});

export const dayTotals = (items: PlannedFood[]) => ({
  kcal: round(items.reduce((s, i) => s + (i.food.kcal * i.grams) / 100, 0)),
  protein: round(items.reduce((s, i) => s + (i.food.protein * i.grams) / 100, 0), 1),
});

/** Share of the day's calories/protein per meal — given to the model as per-meal budgets. */
export const MEAL_SPLIT: Record<string, number> = { breakfast: 0.25, lunch: 0.35, dinner: 0.25, snacks: 0.15 };

/** Protein-dense foods (≥ 8 g protein per 100 kcal): whey, egg whites, soya, chicken, fish, tofu, Greek yogurt, sprouts… */
export const proteinDensity = (f: FoodCandidate) => (f.kcal > 0 ? (f.protein / f.kcal) * 100 : 0);
export const isProteinFood = (f: FoodCandidate) => proteinDensity(f) >= 8 && f.protein >= 3;

/**
 * Scale a day's portions toward the calorie target (models are poor at arithmetic).
 * Items marked `fixed` (protein top-ups) keep their amount; the rest share the remaining calories.
 * Only adjusts when more than 6% off, and never by more than ×0.6–×1.6.
 */
export function scaleDay(items: PlannedFood[], kcalTarget: number): PlannedFood[] {
  const kcalOf = (i: PlannedFood) => (i.food.kcal * i.grams) / 100;
  const pass = (list: PlannedFood[], canScale: (i: PlannedFood) => boolean, lo: number, hi: number) => {
    const fixed = list.filter((i) => !canScale(i)).reduce((s, i) => s + kcalOf(i), 0);
    const free = list.filter(canScale).reduce((s, i) => s + kcalOf(i), 0);
    if (!free || !kcalTarget || Math.abs(fixed + free - kcalTarget) / kcalTarget <= 0.06) return list;
    const f = Math.max(lo, Math.min(hi, (kcalTarget - fixed) / free));
    return list.map((i) => (canScale(i) ? { ...i, grams: roundGrams(i.food, i.grams * f) } : i));
  };
  // Scale everything the model chose, then let freely-portioned items (rice, dal, curd…) absorb
  // what whole-piece rounding (rotis, eggs) left over.
  const first = pass(items, (i) => !i.fixed, 0.6, 1.6);
  return pass(first, (i) => !i.fixed && !isDiscrete(i.food), 0.7, 1.4);
}

const BOOSTER_MEAL = (f: FoodCandidate) =>
  /whey|protein bar|sprout|egg white|yogurt|curd|milk|chana|peanut/i.test(f.name) ? 'snacks' : /egg|omelette|oat/i.test(f.name) ? 'breakfast' : 'dinner';

/**
 * Guarantee protein: when a day is under 85% of the protein target, add up to two protein-dense
 * foods the member's diet allows (rotated by `variant` so the week isn't all whey), then rescale
 * the other portions so calories still land on target.
 */
export function balanceDay(items: PlannedFood[], cands: FoodCandidate[], target: { kcal: number; protein: number }, variant = 0): PlannedFood[] {
  let day = scaleDay(items, target.kcal);
  let deficit = target.protein * 0.9 - dayTotals(day).protein;
  if (deficit <= target.protein * 0.05) return day;
  const inDay = new Set(day.map((i) => i.food.id));
  const boosters = cands.filter((f) => isProteinFood(f) && !inDay.has(f.id)).sort((a, b) => proteinDensity(b) - proteinDensity(a)).slice(0, 6);
  const rotated = [...boosters.slice(variant % Math.max(1, boosters.length)), ...boosters.slice(0, variant % Math.max(1, boosters.length))];
  let added = 0;
  for (const f of rotated) {
    if (deficit <= 0 || added >= 2) break;
    const perServing = (f.protein * f.serving_g) / 100;
    const servings = Math.max(1, Math.min(2, Math.ceil((deficit / perServing) * 2) / 2));
    const grams = roundGrams(f, servings * f.serving_g);
    day = [...day, { food: f, grams, meal: BOOSTER_MEAL(f), fixed: true }];
    deficit -= (f.protein * grams) / 100;
    added++;
  }
  return scaleDay(day, target.kcal);
}


const BREAKFAST_DISH = /idli|dosa|pesarattu|uttapam|poha|upma|paratha|parantha|thepla|dhokla|khaman|handvo|appam|puttu|daliya|dalia|porridge|oat|chilla|cheela|sandwich|egg|omelette/i;

/**
 * Week variety by construction: staples (USDA basics, the member's own and recent foods) go to
 * every day, while cooked dishes are dealt out round-robin — breakfast-type dishes and the rest
 * separately — so each day gets its own menu and no two days can repeat a main dish.
 */
export function partitionDishes(cands: FoodCandidate[], days: number, recentIds: number[] = []): FoodCandidate[][] {
  if (days <= 1) return [cands];
  const recent = new Set(recentIds);
  const staple = (f: FoodCandidate) => f.source === 'basic' || f.source === 'custom' || recent.has(f.id);
  const pools: FoodCandidate[][] = Array.from({ length: days }, () => cands.filter(staple));
  const dishes = cands.filter((f) => !staple(f));
  [dishes.filter((f) => BREAKFAST_DISH.test(f.name)), dishes.filter((f) => !BREAKFAST_DISH.test(f.name))]
    .forEach((group) => group.forEach((f, k) => pools[k % days].push(f)));
  return pools;
}

const GRAIN = /rice|roti|chapati|phulka|paratha|parantha|thepla|quinoa|millet|jowar|bajra|ragi|khichdi|khichri|pulao|biryani|bath|dosa|idli|upma|poha|bread|daliya|dalia|oat|puttu|appam|potato/i;
/** A proper Indian lunch is built on rice, roti or a millet — not tiffin items. */
const LUNCH_GRAIN = /rice|roti|chapati|phulka|paratha|parantha|thepla|quinoa|millet|jowar|bajra|ragi|khichdi|khichri|pulao|biryani|bath|annam|sadam/i;
const COOKED = /dal|curry|sambar|rasam|rajma|chole|chana|channa|sabzi|bhaji|kurma|korma|poriyal|thoran|kootu|avial|saag|palak|paneer|kadhi|masala|fry|roast|stew|gravy|bharta|jalfrezi|khichdi|biryani|pulao|bath/i;

/** A meal-shaped check the model's day must pass: lunch and dinner each have a grain and a cooked dish. */
export function mealIssues(items: PlannedFood[]): string[] {
  const out: string[] = [];
  for (const m of ['lunch', 'dinner']) {
    const names = items.filter((i) => i.meal === m).map((i) => i.food.name);
    if (m === 'lunch' && !names.some((n) => LUNCH_GRAIN.test(n))) out.push('lunch has no rice, roti or millet (idli/dosa are breakfast or dinner food)');
    else if (!names.some((n) => GRAIN.test(n))) out.push(`${m} has no grain (rice, roti, millet, dosa…)`);
    if (!names.some((n) => COOKED.test(n))) out.push(`${m} has no cooked dish (dal, curry, sabzi…)`);
  }
  const perFood = new Map<number, Set<string>>();
  for (const i of items) perFood.set(i.food.id, (perFood.get(i.food.id) ?? new Set()).add(i.meal ?? ''));
  for (const [id, meals] of perFood) if (meals.size > 2) out.push(`${items.find((i) => i.food.id === id)!.food.name} is used in ${meals.size} meals — max 2`);
  return out;
}

// ── Meal roles (what Clef-flash fills: one dish per role) ───────────────
const SNACK = /fruit|banana|apple|orange|papaya|watermelon|grapes|mango|guava|pomegranate|nuts?\b|almond|peanut|cashew|walnut|dates|sprout|chana|makhana|buttermilk|chaas|lassi|milk|whey|protein|curd|yogurt|corn|coconut water|egg|tea|coffee|chaat|dhokla|khaman|oat/i;
const BREAKFAST_SIDE = /curd|yogurt|milk|banana|apple|fruit|papaya|orange|sambar|egg|sprout|peanut|almond/i;
const SIDE_DISH = /sabzi|poriyal|thoran|kootu|avial|salad|vegetable|veg|raita|bhindi|beans|cabbage|aloo|gobi|baingan|palak|saag|curd|buttermilk|chaas|rasam/i;
const PROTEIN_DISH = /paneer|egg|omelette|bhurji|chicken|fish|mutton|prawn|crab|keema|soya|tofu|sprout|chana|rajma|dal|curd|raita|kebab|tikka/i;

export interface MealRole { meal: string; role: string; label: string; options: FoodCandidate[] }

/**
 * The plate for each meal as roles — breakfast: main + side; lunch/dinner: grain + cooked dish +
 * protein + vegetable side; snacks: two picks. Options come from the day's pool (already ranked),
 * at most `max` each, so the decision model only ever chooses between suitable dishes.
 */
export function mealRoles(pool: FoodCandidate[], max = 16): MealRole[] {
  const grain = (f: FoodCandidate) => GRAIN.test(f.name);
  const pick = (test: (f: FoodCandidate) => boolean) => pool.filter(test).slice(0, max);
  const dish = (f: FoodCandidate) => COOKED.test(f.name) && !grain(f);
  const protein = (f: FoodCandidate) => (isProteinFood(f) || PROTEIN_DISH.test(f.name)) && !grain(f);
  const roles: MealRole[] = [
    { meal: 'breakfast', role: 'main', label: 'breakfast main dish (idli, dosa, poha, upma, oats, paratha, eggs…)', options: pick((f) => BREAKFAST_DISH.test(f.name) || /oat|muesli|bread/i.test(f.name)) },
    { meal: 'breakfast', role: 'side', label: 'breakfast side (sambar, curd, milk, fruit, eggs, sprouts…)', options: pick((f) => BREAKFAST_SIDE.test(f.name) && !BREAKFAST_DISH.test(f.name) && !/soup|rasam|curry/i.test(f.name)) },
    { meal: 'lunch', role: 'grain', label: 'lunch grain (rice, roti, millet)', options: pick((f) => LUNCH_GRAIN.test(f.name)) },
    { meal: 'lunch', role: 'dish', label: 'lunch cooked dish (dal, curry, sambar…)', options: pick(dish) },
    { meal: 'lunch', role: 'protein', label: 'lunch protein item', options: pick(protein) },
    { meal: 'lunch', role: 'side', label: 'lunch vegetable side / curd', options: pick((f) => SIDE_DISH.test(f.name) && !grain(f)) },
    { meal: 'dinner', role: 'grain', label: 'dinner grain (roti, rice, millet, dosa) — lighter than lunch', options: pick(grain) },
    { meal: 'dinner', role: 'dish', label: 'dinner cooked dish (dal, curry, sabzi…)', options: pick(dish) },
    { meal: 'dinner', role: 'protein', label: 'dinner protein item', options: pick(protein) },
    { meal: 'snacks', role: 'snack1', label: 'evening snack (fruit, sprouts, nuts, buttermilk, milk, whey…)', options: pick((f) => SNACK.test(f.name) && !COOKED.test(f.name) && !/soup/i.test(f.name)) },
    { meal: 'snacks', role: 'snack2', label: 'second snack, different from the first (protein-rich if possible)', options: pick((f) => SNACK.test(f.name) && !COOKED.test(f.name) && !/soup/i.test(f.name)) },
  ];
  return roles.filter((r) => r.options.length >= 2);
}

/** The same food listed twice in one meal becomes one item with the amounts added. */
export function mergeDuplicates(items: PlannedFood[]): PlannedFood[] {
  const out: PlannedFood[] = [];
  for (const i of items) {
    const same = out.find((o) => o.meal === i.meal && o.food.id === i.food.id);
    if (same) same.grams = roundGrams(i.food, same.grams + i.grams); else out.push({ ...i });
  }
  return out;
}