import { weekdayIndex } from './date.ts';
import { hashSeed, mulberry32, shuffle } from './rng.ts';
import { WORD_THEMES, type WordTheme } from './words.ts';

/**
 * Grid size depends only on the Tokyo date, never on the screen.
 * Weekdays are 20×20 with 22 words. Sundays are a 25×25 challenge with 32 words.
 * The board scales to the width of the screen. Zoom can enlarge it.
 *
 * Words read across (left to right), down, or diagonally down-right.
 * They are never placed backwards.
 *
 * The first attempt is mulberry32(hashSeed('mossgate-words-v1:' + iso)).
 * If random fill would spell a blocklisted word, or a placed word would
 * appear twice, the next attempt uses hashSeed('mossgate-words-v1:' + iso + '#' + n).
 */
export const WEEKDAY_SIZE = 20;
export const SUNDAY_SIZE = 25;
export const WEEKDAY_WORDS = 22;
export const SUNDAY_WORDS = 32;

const DIRECTIONS = [
  { name: 'across', dr: 0, dc: 1 },
  { name: 'down', dr: 1, dc: 0 },
  { name: 'diagonal', dr: 1, dc: 1 },
] as const;

export type WordDirection = (typeof DIRECTIONS)[number]['name'];

const EIGHT: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
];

/** Contiguous letter sequences that must not appear in any of the eight directions. */
export const BLOCKLIST: readonly string[] = [
  'FUCK', 'SHIT', 'CUNT', 'TWAT', 'DICK', 'COCK', 'PORN', 'RAPE', 'NAZI', 'SLUT',
  'PISS', 'ARSE', 'CRAP', 'DAMN', 'HELL', 'JERK', 'KILL', 'HATE', 'DUMB', 'SPIC',
  'KIKE', 'DYKE', 'GOOK', 'COON', 'PAKI', 'SLAG', 'SHAG', 'BOOB', 'TITS', 'ANAL',
  'ORGY', 'SEXY', 'NUDE', 'DRUG', 'METH', 'CRACK', 'WEED',
];

export type Placement = {
  word: string;
  row: number;
  col: number;
  direction: WordDirection;
};

export type WordSearchPuzzle = {
  date: string;
  size: number;
  weekend: boolean;
  theme: string;
  words: string[];
  grid: string[];
  placements: Placement[];
};

export function wordsearchSize(iso: string): { size: number; weekend: boolean; wordCount: number } {
  const weekend = weekdayIndex(iso) === 0;
  return weekend
    ? { size: SUNDAY_SIZE, weekend, wordCount: SUNDAY_WORDS }
    : { size: WEEKDAY_SIZE, weekend, wordCount: WEEKDAY_WORDS };
}

function fits(size: number, row: number, col: number, dr: number, dc: number, length: number): boolean {
  const endRow = row + dr * (length - 1);
  const endCol = col + dc * (length - 1);
  return endRow >= 0 && endCol >= 0 && endRow < size && endCol < size;
}

function canWrite(grid: readonly string[], size: number, word: string, row: number, col: number, dr: number, dc: number): boolean {
  for (let i = 0; i < word.length; i++) {
    const current = grid[(row + dr * i) * size + (col + dc * i)];
    if (current && current !== word[i]) return false;
  }
  return true;
}

function writeWord(grid: string[], size: number, word: string, row: number, col: number, dr: number, dc: number): void {
  for (let i = 0; i < word.length; i++) {
    grid[(row + dr * i) * size + (col + dc * i)] = word[i]!;
  }
}

export function countWord(grid: readonly string[], size: number, word: string): number {
  let count = 0;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      for (const [dr, dc] of EIGHT) {
        if (!fits(size, row, col, dr, dc, word.length)) continue;
        let match = true;
        for (let i = 0; i < word.length; i++) {
          if (grid[(row + dr * i) * size + (col + dc * i)] !== word[i]) {
            match = false;
            break;
          }
        }
        if (match) count++;
      }
    }
  }
  return count;
}

function blocked(grid: readonly string[], size: number): string | null {
  for (const word of BLOCKLIST) {
    if (countWord(grid, size, word) > 0) return word;
  }
  return null;
}

function buildOnce(iso: string, rng: () => number): WordSearchPuzzle | null {
  const { size, weekend, wordCount } = wordsearchSize(iso);
  const theme = WORD_THEMES[Math.floor(rng() * WORD_THEMES.length)];
  if (!theme) return null;
  const pool = theme.words.filter((word) => word.length <= size);
  if (pool.length < wordCount) return null;
  const chosen = shuffle(rng, pool).slice(0, wordCount);
  const grid = Array<string>(size * size).fill('');
  const placements: Placement[] = [];
  for (const word of chosen) {
    const options: Placement[] = [];
    for (const direction of DIRECTIONS) {
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          if (!fits(size, row, col, direction.dr, direction.dc, word.length)) continue;
          options.push({ word, row, col, direction: direction.name });
        }
      }
    }
    let placed = false;
    for (const option of shuffle(rng, options)) {
      const direction = DIRECTIONS.find((item) => item.name === option.direction);
      if (!direction) continue;
      if (!canWrite(grid, size, word, option.row, option.col, direction.dr, direction.dc)) continue;
      writeWord(grid, size, word, option.row, option.col, direction.dr, direction.dc);
      placements.push(option);
      placed = true;
      break;
    }
    if (!placed) return null;
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < grid.length; i++) {
    if (!grid[i]) grid[i] = alphabet[Math.floor(rng() * alphabet.length)]!;
  }
  if (blocked(grid, size)) return null;
  for (const word of chosen) {
    if (countWord(grid, size, word) !== 1) return null;
  }
  return {
    date: iso,
    size,
    weekend,
    theme: theme.title,
    words: chosen,
    grid,
    placements,
  };
}

export function wordsearchForDate(iso: string): WordSearchPuzzle {
  for (let attempt = 0; attempt < 48; attempt++) {
    const seedText = attempt === 0 ? `mossgate-words-v1:${iso}` : `mossgate-words-v1:${iso}#${attempt}`;
    const puzzle = buildOnce(iso, mulberry32(hashSeed(seedText)));
    if (puzzle) return puzzle;
  }
  throw new Error(`No word search for ${iso}`);
}

export function placementIndexes(size: number, placement: Placement): number[] {
  const direction = DIRECTIONS.find((item) => item.name === placement.direction);
  if (!direction) return [];
  const indexes: number[] = [];
  for (let i = 0; i < placement.word.length; i++) {
    indexes.push((placement.row + direction.dr * i) * size + (placement.col + direction.dc * i));
  }
  return indexes;
}

/** Indexes from the first letter to the last, across, down, or diagonal only. */
export function selectionIndexes(size: number, start: number, end: number): number[] | null {
  if (start < 0 || end < 0 || start >= size * size || end >= size * size) return null;
  const startRow = Math.floor(start / size);
  const startCol = start % size;
  const endRow = Math.floor(end / size);
  const endCol = end % size;
  const rowDelta = endRow - startRow;
  const colDelta = endCol - startCol;
  let stepRow = 0;
  let stepCol = 0;
  let length = 0;
  if (rowDelta === 0 && colDelta > 0) {
    stepCol = 1;
    length = colDelta + 1;
  } else if (colDelta === 0 && rowDelta > 0) {
    stepRow = 1;
    length = rowDelta + 1;
  } else if (rowDelta > 0 && rowDelta === colDelta) {
    stepRow = 1;
    stepCol = 1;
    length = rowDelta + 1;
  } else {
    return null;
  }
  const indexes: number[] = [];
  for (let i = 0; i < length; i++) indexes.push((startRow + stepRow * i) * size + (startCol + stepCol * i));
  return indexes;
}

export function lettersOnPlacement(puzzle: WordSearchPuzzle, placement: Placement): string {
  const direction = DIRECTIONS.find((item) => item.name === placement.direction);
  if (!direction) return '';
  let text = '';
  for (let i = 0; i < placement.word.length; i++) {
    text += puzzle.grid[(placement.row + direction.dr * i) * puzzle.size + (placement.col + direction.dc * i)] ?? '';
  }
  return text;
}

export function themeIds(): string[] {
  return WORD_THEMES.map((theme: WordTheme) => theme.id);
}
