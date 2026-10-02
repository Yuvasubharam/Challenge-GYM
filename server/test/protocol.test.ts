import { describe, expect, it } from 'vitest';
import { handshake, tzOption } from '../src/device/protocol';

describe('ADMS handshake time zone', () => {
  it('whole-hour zones go as hours, half/quarter-hour zones as minutes (push protocol: |value| > 60 = minutes)', () => {
    expect(tzOption(330)).toBe(330); // India +5:30 — "5.5" was read as 5 → clock 30 min slow
    expect(tzOption(345)).toBe(345); // Nepal +5:45
    expect(tzOption(480)).toBe(8);
    expect(tzOption(0)).toBe(0);
    expect(tzOption(-300)).toBe(-5);
  });
  it('the handshake tells the X990 TimeZone=330 for the gym', () => {
    expect(handshake('CUB7252100258', 330)).toContain('\nTimeZone=330\n');
  });
});
