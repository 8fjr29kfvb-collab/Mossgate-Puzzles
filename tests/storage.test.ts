import { describe, expect, it } from 'vitest';
import { emptySudokuProgress, loadSave, parseSave, writeSave, type KeyValueStore } from '../src/storage.ts';

function memoryStore(): KeyValueStore & { dump: Record<string, string> } {
  const dump: Record<string, string> = {};
  return {
    dump,
    getItem(key) {
      return dump[key] ?? null;
    },
    setItem(key, value) {
      dump[key] = value;
    },
  };
}

describe('local save', () => {
  it('ignores corrupt data and round-trips a valid save', () => {
    expect(parseSave(null).version).toBe(1);
    expect(parseSave('not json').sudoku).toBeNull();
    expect(parseSave('{"version":2}').largePrint).toBe(false);

    const store = memoryStore();
    const save = parseSave(null);
    save.largePrint = true;
    save.checkMistakes = true;
    save.progressDate = '2026-10-31';
    save.sudokuStreak = { count: 3, lastDate: '2026-10-31' };
    save.sudoku = emptySudokuProgress();
    save.sudoku.values[4] = 8;
    save.sudoku.notes[5] = (1 << 2) | (1 << 9);
    writeSave(store, save);
    const loaded = loadSave(store);
    expect(loaded.largePrint).toBe(true);
    expect(loaded.checkMistakes).toBe(true);
    expect(loaded.sudokuStreak.count).toBe(3);
    expect(loaded.sudoku?.values[4]).toBe(8);
    expect(loaded.sudoku?.notes[5]).toBe((1 << 2) | (1 << 9));
  });

  it('drops a progress blob with the wrong shape', () => {
    const raw = JSON.stringify({
      version: 1,
      largePrint: false,
      checkMistakes: false,
      sudokuStreak: { count: 0, lastDate: null },
      nonogramStreak: { count: 1, lastDate: '2026-10-30' },
      progressDate: '2026-10-31',
      sudoku: { values: [1], notes: [], elapsed: 0, userPaused: false, solved: false },
      nonogram: null,
    });
    expect(parseSave(raw).sudoku).toBeNull();
    expect(parseSave(raw).nonogramStreak.count).toBe(1);
  });
});
