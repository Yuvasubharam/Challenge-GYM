import { describe, expect, it } from 'vitest';
import { bmi, bmiCategory, bmr, dailyTargets, e1rm, healthyWeightRange, kcalBurned, portion, summarizeSets } from '../src/lib/fitness';

describe('BMI', () => {
  it('computes BMI', () => expect(bmi(70, 175)).toBe(22.9));
  it('uses Asian-Indian cut-offs', () => {
    expect(bmiCategory(18.4).key).toBe('under');
    expect(bmiCategory(22.9).key).toBe('normal');
    expect(bmiCategory(23).key).toBe('over'); // WHO global would still call this normal
    expect(bmiCategory(25).key).toBe('obese');
  });
  it('healthy weight range for 170 cm', () => expect(healthyWeightRange(170)).toEqual([53.5, 66.2]));
});

describe('energy targets', () => {
  it('Mifflin–St Jeor BMR', () => {
    expect(bmr(80, 180, 30, 'male')).toBe(1780);   // 800 + 1125 - 150 + 5
    expect(bmr(60, 160, 25, 'female')).toBe(1314); // 600 + 1000 - 125 - 161
  });
  it('weight loss = TDEE − 500 with sane macros', () => {
    const t = dailyTargets({ weightKg: 80, heightCm: 180, age: 30, sex: 'male', activity: 'moderate', goal: 'lose_weight' });
    expect(t.tdee).toBe(2759);
    expect(t.kcal).toBe(2260);
    expect(t.protein_g).toBe(144);
    expect(t.protein_g * 4 + t.carbs_g * 4 + t.fat_g * 9).toBeGreaterThan(t.kcal - 20);
    expect(t.water_ml).toBe(2750);
  });
  it('never goes below the safe floor', () => {
    const t = dailyTargets({ weightKg: 45, heightCm: 150, age: 60, sex: 'female', activity: 'sedentary', goal: 'lose_weight' });
    expect(t.kcal).toBe(1200);
  });
  it('muscle gain adds a surplus', () => {
    const base = dailyTargets({ weightKg: 70, heightCm: 175, age: 25, sex: 'male', activity: 'active', goal: 'maintain' });
    const bulk = dailyTargets({ weightKg: 70, heightCm: 175, age: 25, sex: 'male', activity: 'active', goal: 'build_muscle' });
    expect(bulk.kcal - base.kcal).toBe(250);
    expect(bulk.protein_g).toBe(140);
  });
});

describe('training', () => {
  it('MET calories', () => expect(kcalBurned(9.8, 70, 30)).toBe(343));
  it('Epley 1RM', () => {
    expect(e1rm(100, 1)).toBe(100);
    expect(e1rm(100, 5)).toBe(116.7);
    expect(e1rm(0, 10)).toBe(0);
  });
  it('set summary', () => expect(summarizeSets([{ reps: 10, kg: 60 }, { reps: 8, kg: 70 }])).toEqual({ volume: 1160, best_e1rm: 88.7 }));
});

describe('food portion', () => {
  it('scales per-100 g values', () => expect(portion({ kcal: 202.3, protein: 5.9, carbs: 35.7, fat: 3.6 }, 80)).toEqual({ kcal: 162, protein: 4.7, carbs: 28.6, fat: 2.9 }));
});
