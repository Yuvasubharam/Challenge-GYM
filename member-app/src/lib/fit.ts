export type Goal = 'lose_weight' | 'gain_weight' | 'build_muscle' | 'maintain' | 'get_fit';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snacks';

export interface Targets { kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; water_ml: number | null }

export interface FitProfile {
  age: number | null; sex: string | null; height_cm: number; weight_kg: number; start_weight_kg: number; target_weight_kg: number | null;
  goal: Goal; activity: Activity; workouts_per_week: number | null; diet_pref: string | null; diet_prefs: string[]; custom_targets: boolean;
  bmi: number; bmi_category: { key: 'under' | 'normal' | 'over' | 'obese'; label: string }; healthy_range: [number, number];
  bmr: number | null; tdee: number | null; goal_progress: number | null; targets: Targets;
}

export interface Food { id: number; name: string; kcal: number; protein: number; carbs: number; fat: number; serving_g: number; serving_label: string; veg: 'veg' | 'egg' | 'nonveg' | null; source: string; owner_member_id: number | null }
export interface FoodLog { id: number; meal: Meal; food_id: number | null; name: string; grams: number; kcal: number; protein: number; carbs: number; fat: number }
export interface SetEntry { reps: number; kg: number }
export interface WorkoutLog { id: number; exercise_id: string | null; name: string; sets: SetEntry[]; duration_min: number; kcal: number; volume_kg: number; best_e1rm: number | null; images: string[]; body_part: string | null; tracking: string | null }

export interface Day {
  date: string; targets: Targets | null; eaten: { kcal: number; protein: number; carbs: number; fat: number }; burned: number; net: number; remaining: number | null;
  meals: Record<Meal, { items: FoodLog[]; kcal: number; protein: number; carbs: number; fat: number }>;
  workouts: WorkoutLog[]; minutes: number; water_ml: number; weight: { weight_kg: number; day: string } | null;
}

export interface Exercise { id: string; name: string; body_part: string | null; target: string | null; equipment: string | null; category: string | null; level: string | null; images: string[]; met: number; tracking: 'sets' | 'time'; popular: number }

export const GOAL_LABEL: Record<Goal, string> = {
  lose_weight: 'Lose weight', gain_weight: 'Gain weight', build_muscle: 'Build muscle', maintain: 'Stay fit & maintain', get_fit: 'Improve fitness',
};
export const ACTIVITY_LABEL: Record<Activity, [string, string]> = {
  sedentary: ['Mostly sitting', 'Desk job, little walking'],
  light: ['Lightly active', 'On feet a bit, light exercise 1–3 days'],
  moderate: ['Moderately active', 'Gym 3–5 days a week'],
  active: ['Very active', 'Hard training 6–7 days'],
  very_active: ['Athlete', 'Physical job + daily training'],
};
export const MEALS: { key: Meal; label: string; emoji: string }[] = [
  { key: 'breakfast', label: 'Breakfast', emoji: '🍳' }, { key: 'lunch', label: 'Lunch', emoji: '🍛' },
  { key: 'dinner', label: 'Dinner', emoji: '🍲' }, { key: 'snacks', label: 'Snacks', emoji: '🍎' },
];
export const DIET_LABEL: Record<string, string> = { veg: 'Vegetarian', egg: 'Eggetarian', nonveg: 'Non-veg', vegan: 'Vegan' };

/** Default food filter from a multi-select preference: any non-veg → all foods; egg → veg+egg; veg/vegan → veg. */
export function vegFilterFor(prefs: string[] | undefined): '' | 'veg' | 'egg' {
  if (!prefs?.length || prefs.includes('nonveg')) return '';
  if (prefs.includes('egg')) return 'egg';
  return 'veg';
}

export const media = (path: string) => `/api/fit/media/${path.split('/').map(encodeURIComponent).join('/')}`;
export const cap = (s: string | null | undefined) => (s ? s.replace(/\b\w/g, (m) => m.toUpperCase()) : '');

/** Suggest a meal from the time of day (IST). */
export function mealNow(): Meal {
  const h = Number(new Date(Date.now() + 330 * 60_000).toISOString().slice(11, 13));
  return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 19 ? 'snacks' : 'dinner';
}
