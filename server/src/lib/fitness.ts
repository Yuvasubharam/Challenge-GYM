// Fitness maths — pure functions (unit-tested in test/fitness.test.ts).

export type Goal = 'lose_weight' | 'gain_weight' | 'build_muscle' | 'maintain' | 'get_fit';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type Sex = 'male' | 'female' | 'other' | null;

export const GOALS: Goal[] = ['lose_weight', 'gain_weight', 'build_muscle', 'maintain', 'get_fit'];
export const ACTIVITIES: Activity[] = ['sedentary', 'light', 'moderate', 'active', 'very_active'];

const ACTIVITY_FACTOR: Record<Activity, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };

/** Daily calorie change for the goal (kcal). ~0.5 kg/week loss; lean-gain surplus for muscle. */
const GOAL_DELTA: Record<Goal, number> = { lose_weight: -500, gain_weight: 400, build_muscle: 250, maintain: 0, get_fit: 0 };
/** Protein g per kg body weight (ISSN / ICMR-NIN ranges for active adults). */
const PROTEIN_PER_KG: Record<Goal, number> = { lose_weight: 1.8, gain_weight: 1.6, build_muscle: 2.0, maintain: 1.4, get_fit: 1.5 };

export const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d;

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return round(weightKg / (m * m), 1);
}

/**
 * Asian-Indian BMI categories (Misra et al., consensus guidelines for India; also WHO Asia-Pacific):
 * <18.5 underweight · 18.5–22.9 normal · 23–24.9 overweight · ≥25 obese.
 */
export function bmiCategory(b: number): { key: 'under' | 'normal' | 'over' | 'obese'; label: string } {
  if (b < 18.5) return { key: 'under', label: 'Underweight' };
  if (b < 23) return { key: 'normal', label: 'Healthy' };
  if (b < 25) return { key: 'over', label: 'Overweight' };
  return { key: 'obese', label: 'Obese' };
}

/** Healthy weight range for a height (BMI 18.5–22.9). */
export function healthyWeightRange(heightCm: number): [number, number] {
  const m2 = (heightCm / 100) ** 2;
  return [round(18.5 * m2, 1), round(22.9 * m2, 1)];
}

/** Mifflin–St Jeor BMR. 'other'/unknown uses the midpoint of the male/female constants. */
export function bmr(weightKg: number, heightCm: number, age: number, sex: Sex): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const s = sex === 'male' ? 5 : sex === 'female' ? -161 : -78;
  return round(base + s);
}

export interface TargetsInput { weightKg: number; heightCm: number; age: number; sex: Sex; activity: Activity; goal: Goal }
export interface Targets { bmr: number; tdee: number; kcal: number; protein_g: number; carbs_g: number; fat_g: number; water_ml: number }

export function dailyTargets(i: TargetsInput): Targets {
  const b = bmr(i.weightKg, i.heightCm, i.age, i.sex);
  const tdee = round(b * ACTIVITY_FACTOR[i.activity]);
  const floor = i.sex === 'female' ? 1200 : 1500; // never prescribe below a safe minimum
  const kcal = Math.max(floor, Math.round((tdee + GOAL_DELTA[i.goal]) / 10) * 10);
  const protein = Math.round(PROTEIN_PER_KG[i.goal] * i.weightKg);
  const fat = Math.round((kcal * 0.25) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  const water = Math.round((i.weightKg * 35) / 250) * 250; // ~35 ml/kg, rounded to glasses
  return { bmr: b, tdee, kcal, protein_g: protein, carbs_g: carbs, fat_g: fat, water_ml: water };
}

/** Calories burned: MET × kg × hours (Compendium of Physical Activities). */
export function kcalBurned(met: number, weightKg: number, minutes: number): number {
  return round(met * weightKg * (minutes / 60));
}

export interface SetEntry { reps: number; kg: number }

/** Strength session duration when not given: ~2.5 min per set incl. rest. */
export const estimateMinutes = (sets: SetEntry[]) => round(sets.length * 2.5, 1);

/** Epley estimated one-rep max. */
export function e1rm(kg: number, reps: number): number {
  if (!(kg > 0) || !(reps > 0)) return 0;
  return reps === 1 ? kg : round(kg * (1 + reps / 30), 1);
}

export function summarizeSets(sets: SetEntry[]) {
  const volume = round(sets.reduce((s, x) => s + (x.kg > 0 ? x.kg * x.reps : 0), 0), 1);
  const best = sets.reduce((m, x) => Math.max(m, e1rm(x.kg, x.reps)), 0);
  return { volume, best_e1rm: best || null };
}

/** Macros for a logged amount from a per-100 g food. */
export function portion(food: { kcal: number; protein: number; carbs: number; fat: number }, grams: number) {
  const f = grams / 100;
  return { kcal: round(food.kcal * f), protein: round(food.protein * f, 1), carbs: round(food.carbs * f, 1), fat: round(food.fat * f, 1) };
}

export const ageFromBirthYear = (birthYear: number, today: string) => Number(today.slice(0, 4)) - birthYear;
