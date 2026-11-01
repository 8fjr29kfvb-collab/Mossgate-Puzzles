import { describe, expect, it } from 'vitest';
import { addDays, archiveDates, clampPuzzleDate, LAUNCH_DATE } from '../src/date.ts';
import { nonogramForDate } from '../src/nonogram.ts';
import { sudokuShareText } from '../src/share.ts';
import { sudokuForDate } from '../src/sudoku.ts';
import {
  DAY_CAP,
  emptyNonogramProgress,
  emptySudokuProgress,
  parseSave,
  trimDays,
  type DayProgress,
} from '../src/storage.ts';

describe('archive dates', () => {
  const today = '2026-11-02';

  it('clamps invalid and future dates to today, and early dates to launch', () => {
    expect(LAUNCH_DATE).toBe('2026-10-31');
    expect(clampPuzzleDate(null, today)).toBe(today);
    expect(clampPuzzleDate('', today)).toBe(today);
    expect(clampPuzzleDate('yesterday', today)).toBe(today);
    expect(clampPuzzleDate('2026-02-31', today)).toBe(today);
    expect(clampPuzzleDate('2026-11-03', today)).toBe(today);
    expect(clampPuzzleDate('2026-01-15', today)).toBe(LAUNCH_DATE);
    expect(clampPuzzleDate('2026-10-30', today)).toBe(LAUNCH_DATE);
    expect(clampPuzzleDate('2026-10-31', today)).toBe('2026-10-31');
    expect(clampPuzzleDate('2026-11-02', today)).toBe(today);
  });

  it('lists every day from today back to launch', () => {
    expect(archiveDates('2026-10-31')).toEqual(['2026-10-31']);
    expect(archiveDates('2026-11-02')).toEqual(['2026-11-02', '2026-11-01', '2026-10-31']);
    expect(archiveDates('2026-10-01')).toEqual(['2026-10-31']);
  });
});

describe('save migration', () => {
  it('keeps a version 1 day on its progress date', () => {
    const sudoku = emptySudokuProgress();
    sudoku.values[0] = 4;
    sudoku.elapsed = 1500;
    const nonogram = emptyNonogramProgress();
    nonogram.cells[3] = 1;
    const raw = JSON.stringify({
      version: 1,
      largePrint: true,
      checkMistakes: false,
      sudokuStreak: { count: 2, lastDate: '2026-10-31' },
      nonogramStreak: { count: 0, lastDate: null },
      progressDate: '2026-10-31',
      sudoku,
      nonogram,
    });
    const save = parseSave(raw);
    expect(save.version).toBe(2);
    expect(save.largePrint).toBe(true);
    expect(save.sudokuStreak).toEqual({ count: 2, lastDate: '2026-10-31' });
    expect(save.days['2026-10-31']?.sudoku?.values[0]).toBe(4);
    expect(save.days['2026-10-31']?.sudoku?.elapsed).toBe(1500);
    expect(save.days['2026-10-31']?.nonogram?.cells[3]).toBe(1);
  });

  it('caps stored days and can keep an older one', () => {
    const days: Record<string, DayProgress> = {};
    for (let i = 0; i < DAY_CAP + 10; i++) {
      const iso = addDays('2026-10-01', i);
      const sudoku = emptySudokuProgress();
      sudoku.elapsed = i + 1;
      days[iso] = { sudoku, nonogram: null };
    }
    const trimmed = trimDays(days, DAY_CAP, '2026-10-31');
    expect(Object.keys(trimmed)).toHaveLength(DAY_CAP);
    expect(trimmed['2026-10-31']?.sudoku?.elapsed).toBe(31);
    const newest = Object.keys(trimmed).sort().at(-1);
    expect(newest).toBe(addDays('2026-10-01', DAY_CAP + 9));
    expect(trimmed['2026-10-01']).toBeUndefined();
    const keptOldest = trimDays(days, DAY_CAP, '2026-10-01');
    expect(Object.keys(keptOldest)).toHaveLength(DAY_CAP);
    expect(keptOldest['2026-10-01']?.sudoku?.elapsed).toBe(1);
    expect(keptOldest[addDays('2026-10-01', DAY_CAP + 9)]).toBeTruthy();
  });
});

describe('puzzle determinism', () => {
  it('rebuilds the same grids for a date and labels that date in the share text', () => {
    expect(sudokuForDate('2026-10-31')).toEqual(sudokuForDate('2026-10-31'));
    expect(nonogramForDate('2026-11-01')).toEqual(nonogramForDate('2026-11-01'));
    expect(sudokuForDate('2026-10-31').givens).not.toEqual(sudokuForDate('2026-11-01').givens);
    const text = sudokuShareText('2026-10-31', 1000, sudokuForDate('2026-10-31').givens);
    expect(text).toContain('2026-10-31');
    expect(text).not.toContain('2026-11-01');
  });
});
