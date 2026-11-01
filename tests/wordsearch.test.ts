import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addDays, LAUNCH_DATE } from '../src/date.ts';
import { WORD_THEMES } from '../src/words.ts';
import {
  BLOCKLIST,
  countWord,
  lettersOnPlacement,
  selectionIndexes,
  wordsearchForDate,
  wordsearchSize,
  SUNDAY_WORDS,
  WEEKDAY_WORDS,
} from '../src/wordsearch.ts';

describe('word search puzzles', () => {
  it('uses the date alone for size and places each word once', () => {
    expect(wordsearchSize('2026-10-31')).toEqual({ size: 20, weekend: false, wordCount: WEEKDAY_WORDS });
    expect(wordsearchSize('2026-11-01')).toEqual({ size: 25, weekend: true, wordCount: SUNDAY_WORDS });
    const saturday = wordsearchForDate('2026-10-31');
    const sunday = wordsearchForDate('2026-11-01');
    expect(saturday.size).toBe(20);
    expect(saturday.words).toHaveLength(WEEKDAY_WORDS);
    expect(sunday.size).toBe(25);
    expect(sunday.words).toHaveLength(SUNDAY_WORDS);
    expect(new Set(saturday.words).size).toBe(saturday.words.length);
    for (const puzzle of [saturday, sunday]) {
      expect(puzzle.placements).toHaveLength(puzzle.words.length);
      for (const placement of puzzle.placements) {
        expect(['across', 'down', 'diagonal']).toContain(placement.direction);
        expect(lettersOnPlacement(puzzle, placement)).toBe(placement.word);
        expect(countWord(puzzle.grid, puzzle.size, placement.word)).toBe(1);
      }
      for (const banned of BLOCKLIST) expect(countWord(puzzle.grid, puzzle.size, banned)).toBe(0);
    }
    expect(wordsearchForDate('2026-10-31')).toEqual(saturday);
    expect(wordsearchForDate('2026-11-01')).toEqual(sunday);
    expect(saturday.words).not.toEqual(wordsearchForDate('2026-11-02').words);
  });

  it('selects only forward across, down, and diagonal lines', () => {
    expect(selectionIndexes(5, 0, 2)).toEqual([0, 1, 2]);
    expect(selectionIndexes(5, 0, 10)).toEqual([0, 5, 10]);
    expect(selectionIndexes(5, 0, 12)).toEqual([0, 6, 12]);
    expect(selectionIndexes(5, 2, 0)).toBeNull();
    expect(selectionIndexes(5, 10, 0)).toBeNull();
    expect(selectionIndexes(5, 6, 0)).toBeNull();
    expect(selectionIndexes(5, 1, 8)).toBeNull();
  });

  it('keeps themed lists free of the blocklist and avoids Math.random', () => {
    const source = readFileSync(new URL('../src/wordsearch.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/Math\.random/);
    expect(source).toContain('mossgate-words-v1:${iso}');
    for (const theme of WORD_THEMES) {
      expect(theme.words.length).toBeGreaterThanOrEqual(SUNDAY_WORDS);
      for (const word of theme.words) {
        for (const banned of BLOCKLIST) expect(word.includes(banned), `${word} ${banned}`).toBe(false);
      }
    }
  });

  it('builds a clean grid for every date from launch through 2030', () => {
    let iso = LAUNCH_DATE;
    let count = 0;
    while (iso <= '2030-12-31') {
      const puzzle = wordsearchForDate(iso);
      expect(puzzle.date).toBe(iso);
      expect(puzzle.grid).toHaveLength(puzzle.size * puzzle.size);
      for (const banned of BLOCKLIST) expect(countWord(puzzle.grid, puzzle.size, banned), `${iso} ${banned}`).toBe(0);
      for (const word of puzzle.words) expect(countWord(puzzle.grid, puzzle.size, word), `${iso} ${word}`).toBe(1);
      iso = addDays(iso, 1);
      count++;
    }
    expect(count).toBeGreaterThan(1500);
  }, 60_000);
});
