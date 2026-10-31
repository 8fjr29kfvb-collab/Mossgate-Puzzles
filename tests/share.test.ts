import { describe, expect, it } from 'vitest';
import { nonogramShareText, sudokuShareText } from '../src/share.ts';

describe('share text', () => {
  it('builds a sudoku emoji grid without a link', () => {
    const givens = Array<number>(81).fill(0);
    givens[0] = 5;
    givens[80] = 9;
    const text = sudokuShareText('2026-10-31', 82_000, givens);
    expect(text.startsWith('Mossgate Puzzles · Sudoku\n2026-10-31 · 1:22\n\n')).toBe(true);
    const grid = text.split('\n').filter((line) => line.startsWith('⬛') || line.startsWith('🟩'));
    expect(grid).toHaveLength(9);
    expect(grid[0]).toBe('⬛🟩🟩🟩🟩🟩🟩🟩🟩');
    expect(grid[8]).toBe('🟩🟩🟩🟩🟩🟩🟩🟩⬛');
    expect(text).not.toMatch(/https?:\/\//);
  });

  it('builds a nonogram picture without a link', () => {
    const solution = Array.from({ length: 10 }, () => Array<boolean>(10).fill(false));
    solution[0]![0] = true;
    solution[9]![9] = true;
    const text = nonogramShareText('2026-10-31', 5000, solution);
    const grid = text.split('\n').filter((line) => line.startsWith('⬛') || line.startsWith('⬜'));
    expect(grid).toHaveLength(10);
    expect(grid[0]).toBe('⬛⬜⬜⬜⬜⬜⬜⬜⬜⬜');
    expect(grid[9]).toBe('⬜⬜⬜⬜⬜⬜⬜⬜⬜⬛');
    expect(text).not.toMatch(/https?:\/\//);
  });
});
