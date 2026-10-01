import { describe, expect, it } from 'vitest';
import { AI_MODELS, askJson, extractJson } from '../src/lib/ai';
import type { Env } from '../src/env';
import {
  SLOTS, balanceDay, daySlots, dayTotals, dietAllows, mealIssues, mergeDuplicates, partitionDishes, planDays, prescribe, resolvePicks, roundGrams, scaleDay, slotCandidates,
  type ExCandidate, type FoodCandidate,
} from '../src/lib/planner';

const food = (id: number, name: string, kcal: number, protein: number, serving_g = 100, serving_label = '1 bowl (100 g)', source = 'indb', veg: string | null = 'veg'): FoodCandidate =>
  ({ id, name, kcal, protein, carbs: 10, fat: 5, serving_g, serving_label, veg, source, uses: 0 });

describe('workout split', () => {
  it('week keeps rest days spread and trains the requested number of days', () => {
    expect(planDays('week', 'lose_weight', { trainDays: 4 })).toEqual(['upper', 'lower', 'rest', 'upper', 'lower', 'rest', 'rest']);
    expect(planDays('week', 'build_muscle', { trainDays: 6 })).toEqual(['push', 'pull', 'legs', 'rest', 'push', 'pull', 'legs']);
    expect(planDays('week', 'get_fit', { trainDays: 9 }).filter((d) => d !== 'rest')).toHaveLength(6); // clamped
  });
  it('3 days: push/pull/legs for muscle, full body otherwise; 1 day follows the chosen focus', () => {
    expect(planDays('3days', 'gain_weight')).toEqual(['push', 'pull', 'legs']);
    expect(planDays('3days', 'lose_weight')).toEqual(['full', 'full', 'full']);
    expect(planDays('day', 'maintain', { focus: 'legs' })).toEqual(['legs']);
    expect(planDays('day', 'maintain', { focus: 'nonsense' as never })).toEqual(['full']);
  });
  it('every session runs warm-up → compound → isolation → core → cardio → stretch', () => {
    const rank = { warmup: 0, compound: 1, iso: 2, core: 3, cardio: 4, stretch: 5, walk: 0 };
    for (const t of ['full', 'push', 'pull', 'legs', 'upper', 'lower', 'cardio_core'] as const) {
      const roles = daySlots(t, 'lose_weight').map((s) => rank[SLOTS[s].role]);
      expect(roles).toEqual([...roles].sort((a, b) => a - b));
    }
  });
  it('drops the cardio finisher for muscle/weight gain', () => {
    expect(daySlots('push', 'build_muscle')).not.toContain('cardio');
    expect(daySlots('push', 'lose_weight')).toContain('cardio');
  });
  it('prescribes by goal and caps beginners at 3 sets', () => {
    expect(prescribe('squat', 'build_muscle', 'moderate', 'legs', false)).toMatchObject({ sets: 4, reps: '8–10', rest_s: 90 });
    expect(prescribe('squat', 'build_muscle', 'sedentary', 'legs', false).sets).toBe(3);
    expect(prescribe('core', 'get_fit', null, 'full', true).reps).toBe('30–45 s');
    expect(prescribe('cardio', 'lose_weight', null, 'full', true).minutes).toBe(20);
  });
});

describe('exercise picks', () => {
  const ex = (id: string): ExCandidate => ({ id, name: id, body_part: null, target: null, equipment: null, category: null, level: null, images: null, tracking: 'sets', popular: 0 });
  const cands = { chest_press: [ex('bench'), ex('db-bench'), ex('pushup')], triceps: [ex('pushdown'), ex('kickback')] };
  it('uses the AI pick when valid, falls back when it is invented or duplicated', () => {
    expect(resolvePicks(['chest_press', 'triceps'], cands, { chest_press: 'pushup', triceps: 'made-up' }).map((p) => p.ex.id)).toEqual(['pushup', 'pushdown']);
  });
  it('keeps compound lifts on repeated days but rotates accessories', () => {
    const prev = { chest_press: 'bench', triceps: 'pushdown' };
    expect(resolvePicks(['chest_press', 'triceps'], cands, { chest_press: 'bench', triceps: 'pushdown' }, 1, prev).map((p) => p.ex.id)).toEqual(['bench', 'kickback']);
  });
});

describe('beginner-safe options', () => {
  const lat = (id: string, name: string, equipment: string): ExCandidate => ({ id, name, body_part: 'back', target: 'lats', equipment, category: 'strength', level: 'beginner', images: 'x', tracking: 'sets', popular: 1 });
  const lib = [lat('a', 'Chin-Up', 'body weight'), lat('b', 'Pull-Up', 'body weight'), lat('c', 'Cable Pulldown', 'cable'), lat('d', 'Lever Pulldown', 'leverage machine')];
  it('drops chin-ups / pull-ups for beginners when machine versions exist', () => {
    expect(slotCandidates(lib, ['vertical_pull'], 8, true).vertical_pull.map((e) => e.id)).toEqual(['c', 'd']);
    expect(slotCandidates(lib, ['vertical_pull'], 8, false).vertical_pull.map((e) => e.id)).toContain('a');
  });
});

describe('diet maths', () => {
  const rice = food(1, 'Rice, white, cooked', 130, 2.7, 150, '1 bowl (150 g)', 'basic');
  const roti = food(2, 'Chapati/Roti', 200, 6, 40, '1 roti (40 g)');
  const whey = food(3, 'Whey protein powder', 400, 80, 30, '1 scoop (30 g)', 'basic');
  const dal = food(4, 'Dal tadka', 100, 6, 150, '1 bowl (150 g)');
  it('rounds whole pieces to whole units and bowls to 10 g', () => {
    expect(roundGrams(roti, 70)).toBe(80);
    expect(roundGrams(roti, 10)).toBe(40);
    expect(roundGrams(rice, 263)).toBe(260);
  });
  it('scales portions to the calorie target', () => {
    const day = scaleDay([{ food: rice, grams: 600 }, { food: dal, grams: 300 }, { food: roti, grams: 160 }], 1500);
    expect(Math.abs(dayTotals(day).kcal - 1500) / 1500).toBeLessThan(0.06);
    expect(day.find((i) => i.food.id === 2)!.grams % 40).toBe(0); // still whole rotis
  });
  it('tops up protein with an allowed high-protein food and keeps calories', () => {
    const day = balanceDay([{ food: rice, grams: 600, meal: 'lunch' }, { food: dal, grams: 300, meal: 'dinner' }], [rice, dal, whey], { kcal: 1200, protein: 90 });
    expect(day.some((i) => i.food.id === 3 && i.fixed)).toBe(true);
    expect(dayTotals(day).protein).toBeGreaterThan(dayTotals([{ food: rice, grams: 600 }, { food: dal, grams: 300 }]).protein);
    expect(Math.abs(dayTotals(day).kcal - 1200) / 1200).toBeLessThan(0.1);
  });
  it('merges duplicates and flags unrealistic meals', () => {
    expect(mergeDuplicates([{ food: dal, grams: 150, meal: 'lunch' }, { food: dal, grams: 150, meal: 'lunch' }])).toHaveLength(1);
    expect(mealIssues([{ food: rice, grams: 150, meal: 'lunch' }, { food: dal, grams: 150, meal: 'lunch' }, { food: whey, grams: 30, meal: 'dinner' }]))
      .toEqual(['dinner has no grain (rice, roti, millet, dosa…)', 'dinner has no cooked dish (dal, curry, sabzi…)']);
  });
  it('respects diet preferences (incl. mis-tagged meat dishes and vegan dairy)', () => {
    expect(dietAllows('veg', 'Boti kebab', ['veg'])).toBe(false);
    expect(dietAllows('egg', 'Egg curry', ['veg'])).toBe(false);
    expect(dietAllows('egg', 'Egg curry', ['veg', 'egg'])).toBe(true);
    expect(dietAllows('veg', 'Paneer curry', ['vegan'])).toBe(false);
    expect(dietAllows('nonveg', 'Chicken curry', ['veg', 'nonveg'])).toBe(true);
  });
  it('deals cooked dishes out so no two days of a week share one', () => {
    const dishes = Array.from({ length: 30 }, (_, i) => food(100 + i, i % 3 ? `Curry ${i}` : `Dosa ${i}`, 150, 5));
    const pools = partitionDishes([rice, ...dishes], 7);
    const cooked = pools.map((p) => p.filter((f) => f.id >= 100).map((f) => f.id));
    expect(new Set(cooked.flat()).size).toBe(cooked.flat().length);
    expect(pools.every((p) => p.includes(rice))).toBe(true); // staples on every day
    expect(cooked.every((c) => c.some((id) => (id - 100) % 3 === 0))).toBe(true); // a breakfast dish each day
  });
});

describe('AI client', () => {
  it('extracts JSON from fenced / thinking replies', () => {
    expect(extractJson('<think>{no}</think>\n```json\n{"a":{"b":"}"}}\n```')).toEqual({ a: { b: '}' } });
  });
  it('falls through the model chain in order and reports which model answered', async () => {
    const calls: string[] = [];
    const env = { AI: { run: async (model: string) => {
      calls.push(model);
      if (model === AI_MODELS[0]) throw new Error('capacity');
      return { choices: [{ message: { content: '{"ok":true}' } }] };
    } } } as unknown as Env;
    const r = await askJson(env, [{ role: 'user', content: 'x' }], (j) => j as { ok: boolean });
    expect(r).toEqual({ result: { ok: true }, model: AI_MODELS[1] });
    expect(calls).toEqual([AI_MODELS[0], AI_MODELS[1]]);
  });
  it('rejects an answer that fails validation and tries the next model', async () => {
    let n = 0;
    const env = { AI: { run: async () => ({ choices: [{ message: { content: n++ ? '{"days":[1]}' : '{"days":[]}' } }] }) } } as unknown as Env;
    const r = await askJson(env, [{ role: 'user', content: 'x' }], (j) => { if (!(j as { days: unknown[] }).days.length) throw new Error('empty'); return j; });
    expect(r.model).toBe(AI_MODELS[1]);
  });
});
