// Writing diet/workout log rows — shared by the manual loggers and the AI coach's tick-offs.
import type { Env } from '../env';
import { assert, first, run, str } from './db';
import { estimateMinutes, kcalBurned, portion, round, summarizeSets, type SetEntry } from './fitness';

export const MEAL_KEYS = ['breakfast', 'lunch', 'dinner', 'snacks'] as const;

export async function logFood(env: Env, memberId: number, i: { date: string; meal: string; foodId: number | null; grams: number }) {
  assert((MEAL_KEYS as readonly string[]).includes(i.meal), 400, 'Choose a meal');
  const food = await first<{ id: number; name: string; kcal: number; protein: number; carbs: number; fat: number }>(env.DB,
    `SELECT id, name, kcal, protein, carbs, fat FROM foods WHERE id=? AND active=1 AND (owner_member_id IS NULL OR owner_member_id=?)`, i.foodId, memberId);
  assert(food, 404, 'Food not found');
  assert(i.grams > 0 && i.grams <= 3000, 400, 'Enter a sensible amount');
  const p = portion(food, i.grams);
  const r = await first<{ id: number }>(env.DB,
    `INSERT INTO food_logs (member_id, day, meal, food_id, name, grams, kcal, protein, carbs, fat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    memberId, i.date, i.meal, food.id, food.name, round(i.grams, 1), p.kcal, p.protein, p.carbs, p.fat);
  await run(env.DB, `UPDATE foods SET uses=uses+1 WHERE id=?`, food.id);
  return { id: r!.id, ...p };
}

export async function logWorkout(env: Env, memberId: number, i: { date: string; exerciseId: string | null; sets: SetEntry[]; minutes?: number; notes?: unknown }) {
  const ex = await first<{ id: string; name: string; met: number; tracking: string }>(env.DB, `SELECT id, name, met, tracking FROM exercises WHERE id=?`, i.exerciseId);
  assert(ex, 404, 'Exercise not found');
  const sets = i.sets;
  let minutes = Number(i.minutes);
  if (!(minutes > 0)) minutes = ex.tracking === 'sets' ? estimateMinutes(sets) : 0;
  assert(sets.length || minutes > 0, 400, ex.tracking === 'sets' ? 'Add at least one set' : 'Enter how many minutes');
  assert(minutes <= 600, 400, 'Duration looks too long');
  const weight = await first<{ weight_kg: number }>(env.DB, `SELECT weight_kg FROM weight_logs WHERE member_id=? AND day<=? ORDER BY day DESC LIMIT 1`, memberId, i.date);
  const kcal = kcalBurned(ex.met, weight?.weight_kg ?? 70, minutes);
  const s = summarizeSets(sets);
  const r = await first<{ id: number }>(env.DB,
    `INSERT INTO workout_logs (member_id, day, exercise_id, name, sets, duration_min, kcal, volume_kg, best_e1rm, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    memberId, i.date, ex.id, ex.name, sets.length ? JSON.stringify(sets) : null, round(minutes, 1), kcal, s.volume, s.best_e1rm, str(i.notes, 300));
  return { id: r!.id, kcal, duration_min: round(minutes, 1), volume_kg: s.volume, best_e1rm: s.best_e1rm };
}
