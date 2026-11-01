import { emptyStreak, type StreakRecord } from './streak.ts';

export type SudokuProgress = {
  values: number[];
  notes: number[];
  elapsed: number;
  userPaused: boolean;
  solved: boolean;
};

export type NonogramProgress = {
  cells: number[];
  elapsed: number;
  userPaused: boolean;
  solved: boolean;
};

export type DayProgress = {
  sudoku: SudokuProgress | null;
  nonogram: NonogramProgress | null;
};

export type SaveData = {
  version: 2;
  largePrint: boolean;
  checkMistakes: boolean;
  sudokuStreak: StreakRecord;
  nonogramStreak: StreakRecord;
  days: Record<string, DayProgress>;
};

/** Newest dates win when the map grows past this. */
export const DAY_CAP = 60;

export const SAVE_KEY = 'mossgate-puzzles-v1';

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function emptySudokuProgress(): SudokuProgress {
  return {
    values: Array<number>(81).fill(0),
    notes: Array<number>(81).fill(0),
    elapsed: 0,
    userPaused: false,
    solved: false,
  };
}

export function emptyNonogramProgress(cellCount = 100): NonogramProgress {
  return {
    cells: Array<number>(cellCount).fill(0),
    elapsed: 0,
    userPaused: false,
    solved: false,
  };
}

export function defaultSave(): SaveData {
  return {
    version: 2,
    largePrint: false,
    checkMistakes: false,
    sudokuStreak: emptyStreak(),
    nonogramStreak: emptyStreak(),
    days: {},
  };
}

export function isDaySolved(day: DayProgress | undefined): boolean {
  return Boolean(day?.sudoku?.solved && day.nonogram?.solved);
}

export function trimDays(
  days: Record<string, DayProgress>,
  cap = DAY_CAP,
  keep?: string,
): Record<string, DayProgress> {
  const keys = Object.keys(days).sort();
  if (keys.length <= cap) return { ...days };
  const newest = keys.slice(-cap);
  const chosen = new Set(newest);
  if (keep && days[keep] && !chosen.has(keep)) {
    chosen.delete(newest[0]!);
    chosen.add(keep);
  }
  const out: Record<string, DayProgress> = {};
  for (const key of chosen) {
    const day = days[key];
    if (day) out[key] = day;
  }
  return out;
}

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function numberList(value: unknown, length: number, max: number): number[] | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  const out: number[] = [];
  for (const item of value) {
    if (!isInt(item, 0, max)) return null;
    out.push(item);
  }
  return out;
}

function streak(value: unknown): StreakRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { count?: unknown; lastDate?: unknown };
  if (!isInt(record.count, 0, 100_000)) return null;
  if (record.lastDate !== null && typeof record.lastDate !== 'string') return null;
  if (typeof record.lastDate === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(record.lastDate)) {
    return null;
  }
  return { count: record.count, lastDate: record.lastDate ?? null };
}

function sudokuProgress(value: unknown): SudokuProgress | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<SudokuProgress>;
  const values = numberList(raw.values, 81, 9);
  const notes = numberList(raw.notes, 81, 0x3fe);
  if (!values || !notes) return null;
  if (typeof raw.userPaused !== 'boolean' || typeof raw.solved !== 'boolean') return null;
  if (!isInt(raw.elapsed, 0, 86_400_000 * 7)) return null;
  return {
    values,
    notes: notes.map((note) => note & 0x3fe),
    elapsed: raw.elapsed,
    userPaused: raw.userPaused,
    solved: raw.solved,
  };
}

function nonogramProgress(value: unknown): NonogramProgress | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<NonogramProgress>;
  const cells = numberList(raw.cells, 100, 2);
  if (!cells) return null;
  if (typeof raw.userPaused !== 'boolean' || typeof raw.solved !== 'boolean') return null;
  if (!isInt(raw.elapsed, 0, 86_400_000 * 7)) return null;
  return {
    cells,
    elapsed: raw.elapsed,
    userPaused: raw.userPaused,
    solved: raw.solved,
  };
}

type LegacySave = {
  version?: unknown;
  largePrint?: unknown;
  checkMistakes?: unknown;
  sudokuStreak?: unknown;
  nonogramStreak?: unknown;
  progressDate?: unknown;
  sudoku?: unknown;
  nonogram?: unknown;
  days?: unknown;
};

function dayFromParts(sudokuRaw: unknown, nonogramRaw: unknown): DayProgress | null {
  const sudoku = sudokuRaw == null ? null : sudokuProgress(sudokuRaw);
  const nonogram = nonogramRaw == null ? null : nonogramProgress(nonogramRaw);
  if (!sudoku && !nonogram) return null;
  return { sudoku, nonogram };
}

function daysMap(value: unknown): Record<string, DayProgress> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, DayProgress> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !raw || typeof raw !== 'object') continue;
    const entry = raw as { sudoku?: unknown; nonogram?: unknown };
    const day = dayFromParts(entry.sudoku, entry.nonogram);
    if (day) out[key] = day;
  }
  return trimDays(out);
}

export function parseSave(raw: string | null): SaveData {
  if (!raw) return defaultSave();
  try {
    const data = JSON.parse(raw) as LegacySave;
    if (data.version !== 1 && data.version !== 2) return defaultSave();
    const sudokuStreak = streak(data.sudokuStreak);
    const nonogramStreak = streak(data.nonogramStreak);
    if (!sudokuStreak || !nonogramStreak) return defaultSave();
    let days: Record<string, DayProgress> = {};
    if (data.version === 1) {
      const progressDate =
        typeof data.progressDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.progressDate)
          ? data.progressDate
          : null;
      const day = dayFromParts(data.sudoku, data.nonogram);
      if (progressDate && day) days[progressDate] = day;
    } else {
      days = daysMap(data.days);
    }
    return {
      version: 2,
      largePrint: data.largePrint === true,
      checkMistakes: data.checkMistakes === true,
      sudokuStreak,
      nonogramStreak,
      days: trimDays(days),
    };
  } catch {
    return defaultSave();
  }
}

export function loadSave(store: KeyValueStore): SaveData {
  try {
    return parseSave(store.getItem(SAVE_KEY));
  } catch {
    return defaultSave();
  }
}

export function writeSave(store: KeyValueStore, data: SaveData): void {
  try {
    store.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Private mode and full storage still leave the session playable.
  }
}
