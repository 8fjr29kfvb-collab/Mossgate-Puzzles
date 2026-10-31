import { describe, expect, it } from 'vitest';
import { addDays } from '../src/date.ts';
import { PATTERNS } from '../src/patterns.ts';
import {
  catalogStep,
  columnCanExtend,
  countNonogramSolutions,
  lineClues,
  nonogramForDate,
  placements,
  puzzleFromPattern,
  solveByLogic,
} from '../src/nonogram.ts';

function bruteLine(clues: readonly number[], length: number): string[] {
  const out: string[] = [];
  const cells = Array<boolean>(length).fill(false);
  for (let mask = 0; mask < 1 << length; mask++) {
    for (let i = 0; i < length; i++) cells[i] = (mask & (1 << i)) !== 0;
    const got = lineClues(cells);
    if (got.length === clues.length && got.every((value, index) => value === clues[index])) {
      out.push(cells.map((cell) => (cell ? '#' : '.')).join(''));
    }
  }
  return out.sort();
}

describe('nonogram lines', () => {
  it('reads runs and lists the same placements as a full scan', () => {
    expect(lineClues([true, true, false, true, false, false, true, true, true])).toEqual([2, 1, 3]);
    expect(lineClues(Array<boolean>(10).fill(false))).toEqual([0]);
    const samples: [number[], number][] = [
      [[0], 5],
      [[5], 5],
      [[2, 1], 6],
      [[1, 1, 1], 8],
      [[3, 2], 10],
      [[1, 1, 1, 1], 10],
      [[10], 10],
      [[4], 10],
    ];
    for (const [clues, length] of samples) {
      const fromSolver = placements(clues, length)
        .map((row) => row.map((cell) => (cell ? '#' : '.')).join(''))
        .sort();
      expect(fromSolver, clues.join(',')).toEqual(bruteLine(clues, length));
    }
  });

  it('knows when a column can still be completed', () => {
    expect(columnCanExtend([], true, [2], 3)).toBe(true);
    expect(columnCanExtend([true], true, [2], 0)).toBe(true);
    expect(columnCanExtend([true, true], true, [2], 2)).toBe(false);
    expect(columnCanExtend([true], false, [1, 1], 1)).toBe(true);
    expect(columnCanExtend([true], false, [1, 1], 0)).toBe(false);
  });
});

describe('nonogram solutions', () => {
  it('counts a tiny ambiguous puzzle as two and a diamond as one', () => {
    expect(countNonogramSolutions([[1], [1]], [[1], [1]], 2)).toBe(2);
    const diamond = puzzleFromPattern(
      {
        id: 'tiny-diamond',
        rows: ['..#..', '.###.', '#####', '.###.', '..#..'],
      },
      '2026-01-01',
    );
    expect(solveByLogic(diamond.rowClues, diamond.colClues).status).toBe('solved');
    expect(countNonogramSolutions(diamond.rowClues, diamond.colClues, 2)).toBe(1);
    expect(countNonogramSolutions([[2], [2]], [[1], [1]], 2)).toBe(0);
  });

  it('checks every catalog picture and 60 daily picks', () => {
    expect(PATTERNS.length).toBeGreaterThanOrEqual(60);
    const seen = new Set<string>();
    for (const pattern of PATTERNS) {
      const key = pattern.rows.join('|');
      expect(seen.has(key), pattern.id).toBe(false);
      seen.add(key);
      const puzzle = puzzleFromPattern(pattern, '2026-01-01');
      const logic = solveByLogic(puzzle.rowClues, puzzle.colClues);
      expect(logic.status, pattern.id).toBe('solved');
      for (let r = 0; r < puzzle.size; r++) {
        for (let c = 0; c < puzzle.size; c++) {
          expect(logic.grid[r * puzzle.size + c] === 1, `${pattern.id} r${r}c${c}`).toBe(
            puzzle.solution[r]?.[c],
          );
        }
      }
      let count = 0;
      try {
        count = countNonogramSolutions(puzzle.rowClues, puzzle.colClues, 2);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'search failed';
        throw new Error(`${pattern.id}: ${message}`);
      }
      expect(count, pattern.id).toBe(1);
    }

    const step = catalogStep(PATTERNS.length);
    expect(step % PATTERNS.length).not.toBe(0);
    const dates = Array.from({ length: 60 }, (_, day) => addDays('2026-01-01', day));
    const ids = dates.map((date) => nonogramForDate(date).id);
    expect(new Set(ids).size).toBe(60);
    const again = nonogramForDate('2026-10-31');
    expect(nonogramForDate('2026-10-31')).toEqual(again);
    expect(again.date).toBe('2026-10-31');
  });
});
