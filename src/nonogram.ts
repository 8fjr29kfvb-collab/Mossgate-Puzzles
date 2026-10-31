import { daysBetween, CATALOG_EPOCH } from './date.ts';
import { PATTERNS, type Pattern } from './patterns.ts';

export type NonogramPuzzle = {
  id: string;
  date: string;
  size: number;
  solution: boolean[][];
  rowClues: number[][];
  colClues: number[][];
};

/** Runs of filled cells. An empty line is clue 0. */
export function lineClues(cells: readonly boolean[]): number[] {
  const clues: number[] = [];
  let run = 0;
  for (const filled of cells) {
    if (filled) {
      run++;
    } else if (run) {
      clues.push(run);
      run = 0;
    }
  }
  if (run) clues.push(run);
  return clues.length === 0 ? [0] : clues;
}

/** Every pattern of `clues` that fits on a line of `length`. */
export function placements(clues: readonly number[], length: number): boolean[][] {
  if (clues.length === 1 && clues[0] === 0) {
    return [Array<boolean>(length).fill(false)];
  }
  const out: boolean[][] = [];
  const row = Array<boolean>(length).fill(false);

  const walk = (clueIndex: number, start: number): void => {
    if (clueIndex === clues.length) {
      for (let i = start; i < length; i++) row[i] = false;
      out.push(row.slice());
      return;
    }
    let need = 0;
    for (let k = clueIndex; k < clues.length; k++) need += clues[k] ?? 0;
    need += clues.length - clueIndex - 1;
    const lastStart = length - need;
    const block = clues[clueIndex] ?? 0;
    for (let s = start; s <= lastStart; s++) {
      for (let i = start; i < s; i++) row[i] = false;
      for (let i = 0; i < block; i++) row[s + i] = true;
      const after = s + block;
      if (clueIndex === clues.length - 1) {
        walk(clues.length, after);
      } else {
        row[after] = false;
        walk(clueIndex + 1, after + 1);
      }
    }
  };

  walk(0, 0);
  return out;
}

const placementCache = new Map<string, boolean[][]>();

function cachedPlacements(clues: readonly number[], length: number): boolean[][] {
  const key = `${length}:${clues.join(',')}`;
  const hit = placementCache.get(key);
  if (hit) return hit;
  const made = placements(clues, length);
  placementCache.set(key, made);
  return made;
}

export type LogicStatus = 'solved' | 'partial' | 'contradiction';

export type LogicResult = {
  status: LogicStatus;
  /** -1 unknown, 0 empty, 1 filled. Row-major. */
  grid: Int8Array;
};

function forceLine(clues: readonly number[], known: readonly number[]): Int8Array | null {
  const options = cachedPlacements(clues, known.length).filter((pattern) => {
    for (let i = 0; i < known.length; i++) {
      const cell = known[i];
      if (cell === 0 && pattern[i]) return false;
      if (cell === 1 && !pattern[i]) return false;
    }
    return true;
  });
  if (options.length === 0) return null;
  const forced = new Int8Array(known.length);
  const first = options[0]!;
  for (let i = 0; i < known.length; i++) {
    const value = first[i];
    let same = true;
    for (let p = 1; p < options.length; p++) {
      if (options[p]![i] !== value) {
        same = false;
        break;
      }
    }
    forced[i] = same ? (value ? 1 : 0) : -1;
  }
  return forced;
}

/**
 * Line intersection, repeated across rows and columns.
 * Every mark is shared by all still-legal placements, so a finished grid
 * is the only solution.
 */
export function solveByLogic(
  rowClues: readonly (readonly number[])[],
  colClues: readonly (readonly number[])[],
): LogicResult {
  const size = rowClues.length;
  const grid = new Int8Array(size * size).fill(-1);
  let progress = true;
  let guard = 0;
  while (progress && guard++ < size * size + 2) {
    progress = false;
    for (let r = 0; r < size; r++) {
      const known = new Array<number>(size);
      for (let c = 0; c < size; c++) known[c] = grid[r * size + c] ?? -1;
      const forced = forceLine(rowClues[r] ?? [], known);
      if (!forced) return { status: 'contradiction', grid };
      for (let c = 0; c < size; c++) {
        if (known[c] === -1 && forced[c] !== -1) {
          grid[r * size + c] = forced[c] ?? -1;
          progress = true;
        }
      }
    }
    for (let c = 0; c < size; c++) {
      const known = new Array<number>(size);
      for (let r = 0; r < size; r++) known[r] = grid[r * size + c] ?? -1;
      const forced = forceLine(colClues[c] ?? [], known);
      if (!forced) return { status: 'contradiction', grid };
      for (let r = 0; r < size; r++) {
        if ((grid[r * size + c] ?? -1) === -1 && forced[r] !== -1) {
          grid[r * size + c] = forced[r] ?? -1;
          progress = true;
        }
      }
    }
  }
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === -1) return { status: 'partial', grid };
  }
  return { status: 'solved', grid };
}

function brutePlacements(clues: readonly number[], length: number): boolean[][] {
  const out: boolean[][] = [];
  const cells = Array<boolean>(length).fill(false);
  const total = 1 << length;
  const target = lineClues(Array<boolean>(length).fill(false));
  const wanted = clues.length === 1 && clues[0] === 0 ? target : clues;
  for (let mask = 0; mask < total; mask++) {
    for (let i = 0; i < length; i++) cells[i] = (mask & (1 << i)) !== 0;
    const got = lineClues(cells);
    if (got.length === wanted.length && got.every((value, index) => value === wanted[index])) {
      out.push(cells.slice());
    }
  }
  return out;
}

/**
 * A column prefix plus one new cell can still grow into `clues`
 * with exactly `rowsAfter` cells still to come.
 */
export function columnCanExtend(
  existing: readonly boolean[],
  next: boolean,
  clues: readonly number[],
  rowsAfter: number,
): boolean {
  const closed: number[] = [];
  let run = 0;
  for (const filled of existing) {
    if (filled) {
      run++;
    } else if (run) {
      closed.push(run);
      run = 0;
    }
  }
  if (next) {
    run++;
  } else if (run) {
    closed.push(run);
    run = 0;
  }
  const open = next;

  if (closed.length > clues.length) return false;
  for (let i = 0; i < closed.length; i++) {
    if (closed[i] !== clues[i]) return false;
  }

  if (open) {
    if (closed.length >= clues.length) return false;
    const allowed = clues[closed.length] ?? 0;
    if (run > allowed) return false;
    const need = allowed - run;
    let restSum = 0;
    const restCount = clues.length - closed.length - 1;
    for (let i = closed.length + 1; i < clues.length; i++) restSum += clues[i] ?? 0;
    if (need === 0) {
      if (restCount === 0) return true;
      return restSum + restCount <= rowsAfter;
    }
    if (restCount === 0) return need <= rowsAfter;
    return need + restSum + restCount <= rowsAfter;
  }

  if (closed.length === clues.length) return true;
  let restSum = 0;
  for (let i = closed.length; i < clues.length; i++) restSum += clues[i] ?? 0;
  const restCount = clues.length - closed.length;
  return restSum + restCount - 1 <= rowsAfter;
}

const SEARCH_NODE_CAP = 2_000_000;

/**
 * Independent counter: try every row pattern from the clues (not from line
 * intersection) and keep a column only when it can still match.
 * Stops at `limit`. Throws if the search is unreasonably large.
 */
export function countNonogramSolutions(
  rowClues: readonly (readonly number[])[],
  colClues: readonly (readonly number[])[],
  limit = 2,
): number {
  const size = rowClues.length;
  const rowOptions = rowClues.map((clue) => brutePlacements(clue, size));
  const columns: boolean[][] = Array.from({ length: size }, () => []);
  let count = 0;
  let nodes = 0;

  const search = (row: number): void => {
    if (count >= limit) return;
    if (++nodes > SEARCH_NODE_CAP) {
      throw new Error('Nonogram search exceeded 2,000,000 nodes');
    }
    if (row === size) {
      count++;
      return;
    }
    const rowsAfter = size - row - 1;
    for (const option of rowOptions[row] ?? []) {
      let ok = true;
      for (let c = 0; c < size; c++) {
        if (!columnCanExtend(columns[c] ?? [], option[c] ?? false, colClues[c] ?? [], rowsAfter)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      for (let c = 0; c < size; c++) columns[c]!.push(option[c] ?? false);
      search(row + 1);
      for (let c = 0; c < size; c++) columns[c]!.pop();
      if (count >= limit) return;
    }
  };

  search(0);
  return count;
}

export function puzzleFromPattern(pattern: Pattern, date: string): NonogramPuzzle {
  const size = pattern.rows.length;
  const solution = pattern.rows.map((row) => {
    if (row.length !== size) {
      throw new Error(`${pattern.id} is not square`);
    }
    return [...row].map((cell) => {
      if (cell === '#') return true;
      if (cell === '.') return false;
      throw new Error(`${pattern.id} has an unexpected cell`);
    });
  });
  const rowClues = solution.map((row) => lineClues(row));
  const colClues = Array.from({ length: size }, (_, col) =>
    lineClues(solution.map((row) => row[col] ?? false)),
  );
  return { id: pattern.id, date, size, solution, rowClues, colClues };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

/** Step that visits every catalog entry before repeating. */
export function catalogStep(length: number): number {
  let step = 17;
  while (gcd(step, length) !== 1) step += 2;
  return step;
}

export function catalogIndex(isoDate: string, length: number): number {
  const day = daysBetween(CATALOG_EPOCH, isoDate);
  const wrapped = ((day % length) + length) % length;
  return (wrapped * catalogStep(length)) % length;
}

/**
 * Daily nonogram. The Tokyo date picks one checked picture from the catalog.
 * The same date always picks the same picture.
 */
export function nonogramForDate(isoDate: string): NonogramPuzzle {
  const index = catalogIndex(isoDate, PATTERNS.length);
  const pattern = PATTERNS[index];
  if (!pattern) throw new Error('Nonogram catalog is empty');
  return puzzleFromPattern(pattern, isoDate);
}
