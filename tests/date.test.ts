import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, formatDuration, formatLongDate, tokyoDateString } from '../src/date.ts';
import { hashSeed, mulberry32 } from '../src/rng.ts';

describe('Tokyo puzzle dates', () => {
  it('rolls the day at midnight in Tokyo', () => {
    expect(tokyoDateString(new Date('2026-10-31T14:59:59Z'))).toBe('2026-10-31');
    expect(tokyoDateString(new Date('2026-10-31T15:00:00Z'))).toBe('2026-11-01');
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
    expect(daysBetween('2026-01-01', '2026-03-02')).toBe(60);
  });

  it('formats a calendar date and a duration', () => {
    expect(formatLongDate('2026-10-31')).toContain('2026');
    expect(formatLongDate('2026-10-31')).toContain('October');
    expect(formatLongDate('2026-10-31')).toContain('31');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(1000)).toBe('0:01');
    expect(formatDuration(61_000)).toBe('1:01');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
    expect(formatDuration(-50)).toBe('0:00');
  });
});

describe('seeded rng', () => {
  it('repeats for a seed and changes when the seed changes', () => {
    const a = mulberry32(hashSeed('mossgate-sudoku-v1:2026-10-31'));
    const b = mulberry32(hashSeed('mossgate-sudoku-v1:2026-10-31'));
    const c = mulberry32(hashSeed('mossgate-sudoku-v1:2026-11-01'));
    const first = Array.from({ length: 5 }, () => a());
    const second = Array.from({ length: 5 }, () => b());
    expect(second).toEqual(first);
    expect(c()).not.toBe(first[0]);
  });
});
