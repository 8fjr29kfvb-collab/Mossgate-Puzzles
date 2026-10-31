import { describe, expect, it } from 'vitest';
import { addDays } from '../src/date.ts';
import { clueCount, countSudokuSolutions, sudokuBand, sudokuForDate } from '../src/sudoku.ts';

const WIKI_GIVENS = [
  5, 3, 0, 0, 7, 0, 0, 0, 0,
  6, 0, 0, 1, 9, 5, 0, 0, 0,
  0, 9, 8, 0, 0, 0, 0, 6, 0,
  8, 0, 0, 0, 6, 0, 0, 0, 3,
  4, 0, 0, 8, 0, 3, 0, 0, 1,
  7, 0, 0, 0, 2, 0, 0, 0, 6,
  0, 6, 0, 0, 0, 0, 2, 8, 0,
  0, 0, 0, 4, 1, 9, 0, 0, 5,
  0, 0, 0, 0, 8, 0, 0, 7, 9,
];

const WIKI_SOLUTION = [
  5, 3, 4, 6, 7, 8, 9, 1, 2,
  6, 7, 2, 1, 9, 5, 3, 4, 8,
  1, 9, 8, 3, 4, 2, 5, 6, 7,
  8, 5, 9, 7, 6, 1, 4, 2, 3,
  4, 2, 6, 8, 5, 3, 7, 9, 1,
  7, 1, 3, 9, 2, 4, 8, 5, 6,
  9, 6, 1, 5, 3, 7, 2, 8, 4,
  2, 8, 7, 4, 1, 9, 6, 3, 5,
  3, 4, 5, 2, 8, 6, 1, 7, 9,
];

function validComplete(board: readonly number[]): boolean {
  const seen = (indexes: number[]) => {
    const digits = indexes.map((index) => board[index]);
    return new Set(digits).size === 9 && digits.every((digit) => digit >= 1 && digit <= 9);
  };
  for (let i = 0; i < 9; i++) {
    const row = Array.from({ length: 9 }, (_, col) => i * 9 + col);
    const col = Array.from({ length: 9 }, (_, row) => row * 9 + i);
    const br = Math.floor(i / 3) * 3;
    const bc = (i % 3) * 3;
    const box: number[] = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) box.push((br + r) * 9 + bc + c);
    }
    if (!seen(row) || !seen(col) || !seen(box)) return false;
  }
  return true;
}

describe('sudoku solver', () => {
  it('solves the classic unique puzzle and rejects duplicates', () => {
    const found = Array<number>(81).fill(0);
    expect(countSudokuSolutions(WIKI_GIVENS, 2, found)).toBe(1);
    expect(found).toEqual(WIKI_SOLUTION);
    const duplicate = WIKI_GIVENS.slice();
    duplicate[1] = 5;
    expect(countSudokuSolutions(duplicate, 2)).toBe(0);
    expect(countSudokuSolutions(Array<number>(81).fill(0), 2)).toBe(2);
  });
});

describe('daily sudoku', () => {
  it('is deterministic for a date', () => {
    const a = sudokuForDate('2026-10-31');
    const b = sudokuForDate('2026-10-31');
    expect(b).toEqual(a);
    expect(sudokuForDate('2026-11-01').givens).not.toEqual(a.givens);
  });

  it('builds 60 uniquely solvable easy puzzles', () => {
    const seen = new Set<string>();
    for (let day = 0; day < 60; day++) {
      const date = addDays('2026-01-01', day);
      const puzzle = sudokuForDate(date);
      expect(puzzle.date).toBe(date);
      expect(validComplete(puzzle.solution)).toBe(true);
      for (let i = 0; i < 81; i++) {
        if (puzzle.givens[i]) expect(puzzle.givens[i]).toBe(puzzle.solution[i]);
      }
      const found = Array<number>(81).fill(0);
      expect(countSudokuSolutions(puzzle.givens, 2, found), date).toBe(1);
      expect(found).toEqual(puzzle.solution);
      const clues = clueCount(puzzle.givens);
      expect(clues).toBeGreaterThanOrEqual(38);
      expect(clues).toBeLessThanOrEqual(50);
      expect(sudokuBand(clues)).toBe('Easy');
      seen.add(puzzle.givens.join(','));
    }
    expect(seen.size).toBe(60);
  });
});
