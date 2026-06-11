import { describe, it, expect } from 'vitest';
import { relAge, durationLabel, fmtWhen, batteryLabel, EMDASH } from './fleetFormat';

describe('relAge', () => {
  it('returns emdash for null', () => expect(relAge(null)).toBe(EMDASH));
  it('just now under 5s', () => expect(relAge(2)).toBe('just now'));
  it('seconds', () => expect(relAge(42)).toBe('42s ago'));
  it('minutes', () => expect(relAge(125)).toBe('2m ago'));
  it('hours+minutes', () => expect(relAge(3 * 3600 + 5 * 60)).toBe('3h 5m ago'));
  it('days', () => expect(relAge(2 * 86400 + 3 * 3600)).toBe('2d 3h ago'));
});

describe('durationLabel', () => {
  it('emdash for null/negative', () => {
    expect(durationLabel(null)).toBe(EMDASH);
    expect(durationLabel(-5)).toBe(EMDASH);
  });
  it('seconds', () => expect(durationLabel(30)).toBe('30s'));
  it('minutes', () => expect(durationLabel(600)).toBe('10 min'));
  it('hours', () => expect(durationLabel(2 * 3600 + 30 * 60)).toBe('2h 30m'));
  it('days', () => expect(durationLabel(86400 + 3600)).toBe('1d 1h'));
});

describe('fmtWhen', () => {
  it('emdash for null/bad', () => {
    expect(fmtWhen(null)).toBe(EMDASH);
    expect(fmtWhen('not-a-date')).toBe(EMDASH);
  });
  it('renders a time for a valid iso', () => {
    expect(fmtWhen('2026-06-11T12:00:00Z')).not.toBe(EMDASH);
  });
});

describe('batteryLabel', () => {
  it('emdash for null', () => expect(batteryLabel(null)).toBe(EMDASH));
  it('percent', () => expect(batteryLabel(87.4)).toBe('87%'));
});
