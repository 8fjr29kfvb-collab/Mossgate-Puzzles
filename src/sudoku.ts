import { hashSeed, mulberry32, shuffle } from './rng.ts';

const DIGIT_BITS = 0x3fe;

export type SudokuPuzzle = {
  date: string;
  givens: number[];
  solution: number[];
};

function boxOf(index: number): number {
  const row = Math.floor(index / 9);
  const col = index % 9;
  return Math.floor(row / 3) * 3 + Math.floor(col / 3);
}

function bitCount(mask: number): number {
  let count = 0;
  let bits = mask;
  while (bits) {
    bits &= bits - 1;
    count++;
  }
  return count;
}

/**
 * Count solutions, stopping at `limit`. When `found` is passed, it receives
 * the first solution. An invalid puzzle (a repeated digit) counts as zero.
 */
export function countSudokuSolutions(
  givens: readonly number[],
  limit = 2,
  found?: number[],
): number {
  if (givens.length !== 81) return 0;
  const board = new Array<number>(81).fill(0);
  const rows = new Array<number>(9).fill(0);
  const cols = new Array<number>(9).fill(0);
  const boxes = new Array<number>(9).fill(0);

  for (let i = 0; i < 81; i++) {
    const value = givens[i] ?? 0;
    if (!value) continue;
    if (value < 1 || value > 9) return 0;
    const bit = 1 << value;
    const row = Math.floor(i / 9);
    const col = i % 9;
    const box = boxOf(i);
    if (rows[row]! & bit || cols[col]! & bit || boxes[box]! & bit) return 0;
    rows[row] = (rows[row] ?? 0) | bit;
    cols[col] = (cols[col] ?? 0) | bit;
    boxes[box] = (boxes[box] ?? 0) | bit;
    board[i] = value;
  }

  let count = 0;

  const search = (): void => {
    if (count >= limit) return;
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (board[i]) continue;
      const row = Math.floor(i / 9);
      const col = i % 9;
      const box = boxOf(i);
      const mask = (~((rows[row] ?? 0) | (cols[col] ?? 0) | (boxes[box] ?? 0))) & DIGIT_BITS;
      const options = bitCount(mask);
      if (options === 0) return;
      if (options < bestCount) {
        best = i;
        bestMask = mask;
        bestCount = options;
        if (options === 1) break;
      }
    }
    if (best === -1) {
      if (found && count === 0) {
        for (let i = 0; i < 81; i++) found[i] = board[i] ?? 0;
      }
      count++;
      return;
    }
    const row = Math.floor(best / 9);
    const col = best % 9;
    const box = boxOf(best);
    let mask = bestMask;
    while (mask) {
      const bit = mask & -mask;
      mask ^= bit;
      const value = 31 - Math.clz32(bit);
      board[best] = value;
      rows[row] = (rows[row] ?? 0) | bit;
      cols[col] = (cols[col] ?? 0) | bit;
      boxes[box] = (boxes[box] ?? 0) | bit;
      search();
      board[best] = 0;
      rows[row] = (rows[row] ?? 0) ^ bit;
      cols[col] = (cols[col] ?? 0) ^ bit;
      boxes[box] = (boxes[box] ?? 0) ^ bit;
      if (count >= limit) return;
    }
  };

  search();
  return count;
}

function fillSolution(rng: () => number): number[] {
  const board = new Array<number>(81).fill(0);
  const rows = new Array<number>(9).fill(0);
  const cols = new Array<number>(9).fill(0);
  const boxes = new Array<number>(9).fill(0);

  for (const box of [0, 4, 8]) {
    const digits = shuffle(rng, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const row0 = Math.floor(box / 3) * 3;
    const col0 = (box % 3) * 3;
    let k = 0;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const value = digits[k++]!;
        const index = (row0 + r) * 9 + (col0 + c);
        const bit = 1 << value;
        board[index] = value;
        rows[row0 + r] = (rows[row0 + r] ?? 0) | bit;
        cols[col0 + c] = (cols[col0 + c] ?? 0) | bit;
        boxes[box] = (boxes[box] ?? 0) | bit;
      }
    }
  }

  const place = (pos: number): boolean => {
    let index = pos;
    while (index < 81 && board[index]) index++;
    if (index === 81) return true;
    const row = Math.floor(index / 9);
    const col = index % 9;
    const box = boxOf(index);
    let mask = (~((rows[row] ?? 0) | (cols[col] ?? 0) | (boxes[box] ?? 0))) & DIGIT_BITS;
    const options: number[] = [];
    while (mask) {
      const bit = mask & -mask;
      mask ^= bit;
      options.push(bit);
    }
    const order = shuffle(rng, options);
    for (const bit of order) {
      const value = 31 - Math.clz32(bit);
      board[index] = value;
      rows[row] = (rows[row] ?? 0) | bit;
      cols[col] = (cols[col] ?? 0) | bit;
      boxes[box] = (boxes[box] ?? 0) | bit;
      if (place(index + 1)) return true;
      board[index] = 0;
      rows[row] = (rows[row] ?? 0) ^ bit;
      cols[col] = (cols[col] ?? 0) ^ bit;
      boxes[box] = (boxes[box] ?? 0) ^ bit;
    }
    return false;
  };

  if (!place(0)) {
    throw new Error('Could not complete a sudoku grid');
  }
  return board;
}

function carve(solution: readonly number[], rng: () => number, minGivens: number): number[] {
  const puzzle = solution.slice();
  let givens = 81;
  const removed = new Set<number>();
  const order = shuffle(rng, Array.from({ length: 81 }, (_, index) => index));

  const tryRemove = (indexes: readonly number[]): boolean => {
    if (givens - indexes.length < minGivens) return false;
    const saved = indexes.map((index) => puzzle[index] ?? 0);
    for (const index of indexes) puzzle[index] = 0;
    if (countSudokuSolutions(puzzle, 2) === 1) {
      givens -= indexes.length;
      return true;
    }
    indexes.forEach((index, offset) => {
      puzzle[index] = saved[offset] ?? 0;
    });
    return false;
  };

  for (const index of order) {
    if (givens <= minGivens) break;
    if (removed.has(index)) continue;
    const row = Math.floor(index / 9);
    const col = index % 9;
    const mirror = (8 - row) * 9 + (8 - col);
    if (mirror !== index && !removed.has(mirror) && puzzle[mirror]) {
      if (tryRemove([index, mirror])) {
        removed.add(index);
        removed.add(mirror);
        continue;
      }
    }
    if (tryRemove([index])) removed.add(index);
  }
  return puzzle;
}

export function clueCount(givens: readonly number[]): number {
  let count = 0;
  for (const value of givens) if (value) count++;
  return count;
}

export function sudokuBand(count: number): 'Easy' | 'Medium' {
  return count >= 36 ? 'Easy' : 'Medium';
}

/**
 * Daily sudoku. The seed is the Tokyo date, so every player gets the same
 * grid. Clues are removed in pairs (180° symmetry when that stays unique)
 * down to the low 40s, and only while exactly one solution remains.
 */
export function sudokuForDate(isoDate: string): SudokuPuzzle {
  const seed = hashSeed(`mossgate-sudoku-v1:${isoDate}`);
  const rng = mulberry32(seed);
  const solution = fillSolution(rng);
  const minGivens = 40 + (seed % 4);
  const givens = carve(solution, rng, minGivens);
  return { date: isoDate, givens, solution };
}
