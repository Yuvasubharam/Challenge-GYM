import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHT_PUSH, bucketWeights, renderWeightNudge, weekStart, weeklyRate, weighIn, weightTrend } from '../src/lib/weightTrack';

const lose = { start_weight_kg: 84, target_weight_kg: 74, goal: 'lose_weight' as const };
// Weekly weigh-ins, ~0.5 kg/week down
const steady = ['2026-08-02', '2026-08-09', '2026-08-16', '2026-08-23', '2026-08-30', '2026-09-06'].map((day, i) => ({ day, weight_kg: 84 - i * 0.5 }));

describe('weighIn', () => {
  it('due with no entries', () => expect(weighIn(null, '2026-10-02')).toMatchObject({ due: true, days_since: null, next_due: '2026-10-02' }));
  it('not due within a week', () => expect(weighIn({ day: '2026-09-28', weight_kg: 80 }, '2026-10-02')).toMatchObject({ due: false, days_since: 4, next_due: '2026-10-05' }));
  it('due after 7 days', () => expect(weighIn({ day: '2026-09-25', weight_kg: 80 }, '2026-10-02').due).toBe(true));
});

describe('weeklyRate', () => {
  it('fits the slope in kg/week', () => expect(weeklyRate(steady)).toBe(-0.5));
  it('needs a week of data', () => expect(weeklyRate([{ day: '2026-09-01', weight_kg: 80 }, { day: '2026-09-03', weight_kg: 79 }])).toBeNull());
});

describe('weightTrend', () => {
  it('on track with ETA', () => {
    const t = weightTrend(steady, lose, '2026-09-06');
    expect(t).toMatchObject({ status: 'on_track', current: 81.5, change_total: -2.5, to_go: 7.5, change_7d: -0.5, change_30d: -2.5 });
    expect(t.eta).toBe('2026-12-20'); // 7.5 kg / 0.5 per week = 15 weeks
  });
  it('off track when moving away from the goal', () => {
    const up = steady.map((r, i) => ({ ...r, weight_kg: 84 + i * 0.4 }));
    expect(weightTrend(up, lose, '2026-09-06')).toMatchObject({ status: 'off_track', eta: null });
  });
  it('reached', () => expect(weightTrend([...steady, { day: '2026-09-13', weight_kg: 73.9 }], lose, '2026-09-13').status).toBe('reached'));
  it('maintain → steady / drifting', () => {
    const p = { start_weight_kg: 70, target_weight_kg: null, goal: 'maintain' as const };
    expect(weightTrend([{ day: '2026-09-01', weight_kg: 70 }, { day: '2026-09-20', weight_kg: 71 }], p, '2026-09-20').status).toBe('steady');
    expect(weightTrend([{ day: '2026-09-01', weight_kg: 70 }, { day: '2026-09-20', weight_kg: 73 }], p, '2026-09-20').status).toBe('drifting');
  });
});

describe('bucketWeights', () => {
  it('weeks start Monday', () => expect(weekStart('2026-10-04')).toBe('2026-09-28')); // Sunday → Monday before
  it('averages per week and month', () => {
    const rows = [{ day: '2026-09-28', weight_kg: 80 }, { day: '2026-10-01', weight_kg: 79 }, { day: '2026-10-05', weight_kg: 78.5 }];
    expect(bucketWeights(rows, 'week')).toEqual([{ day: '2026-09-28', weight_kg: 79.5, n: 2 }, { day: '2026-10-05', weight_kg: 78.5, n: 1 }]);
    expect(bucketWeights(rows, 'month')).toEqual([{ day: '2026-09-01', weight_kg: 80, n: 1 }, { day: '2026-10-01', weight_kg: 78.8, n: 2 }]);
  });
});

describe('renderWeightNudge', () => {
  it('fills the member progress into the message', () => {
    const t = weightTrend(steady, lose, '2026-09-06');
    const m = renderWeightNudge(DEFAULT_WEIGHT_PUSH, 'Challenge Gym', 'Ravi Kumar', t, '2026-09-13');
    expect(m.title).toBe('Weigh-in day, Ravi ⚖️');
    expect(m.body).toMatch(/Step on the scale/);
    expect(m.body).not.toMatch(/\{\w+\}/);
  });
  it('skips target lines when there is no target', () => {
    const t = { ...weightTrend(steady, { ...lose, target_weight_kg: null }, '2026-09-06'), status: 'on_track' as const };
    const s = { ...DEFAULT_WEIGHT_PUSH, on_track: ['{to_go} kg left'] };
    expect(renderWeightNudge(s, 'G', 'A', t, '2026-09-13').body).not.toMatch(/kg left/);
  });
});
