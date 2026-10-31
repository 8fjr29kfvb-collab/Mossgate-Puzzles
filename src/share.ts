import { formatDuration } from './date.ts';

/**
 * Black squares are the printed givens. Green squares are the cells
 * filled while playing. Digits are not included.
 */
export function sudokuShareText(
  isoDate: string,
  elapsedMs: number,
  givens: readonly number[],
): string {
  const rows: string[] = [];
  for (let r = 0; r < 9; r++) {
    let line = '';
    for (let c = 0; c < 9; c++) {
      line += givens[r * 9 + c] ? '⬛' : '🟩';
    }
    rows.push(line);
  }
  return `Mossgate Puzzles · Sudoku\n${isoDate} · ${formatDuration(elapsedMs)}\n\n${rows.join('\n')}`;
}

/** Filled cells are black. Empty cells are white. This is the finished picture. */
export function nonogramShareText(
  isoDate: string,
  elapsedMs: number,
  solution: readonly (readonly boolean[])[],
): string {
  const rows = solution.map((row) => row.map((cell) => (cell ? '⬛' : '⬜')).join(''));
  return `Mossgate Puzzles · Nonogram\n${isoDate} · ${formatDuration(elapsedMs)}\n\n${rows.join('\n')}`;
}
