import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { wordsearchBoardHtml } from '../src/wordsearch-board.ts';
import { wordsearchForDate } from '../src/wordsearch.ts';
import { withChrome } from './chrome-page.ts';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const puzzle = wordsearchForDate('2026-10-31');

function ruleBodies(source: string, selectorSnippet: string): string[] {
  const bodies: string[] = [];
  for (const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1]?.includes(selectorSnippet)) bodies.push(match[2] ?? '');
  }
  return bodies;
}

describe('word search markup', () => {
  it('uses a fixed letter track and state classes do not resize cells', () => {
    const html = wordsearchBoardHtml(puzzle, [], null, 0);
    expect(html).toContain(`repeat(${puzzle.size}, var(--letter))`);
    expect(html.match(/data-i="/g)).toHaveLength(puzzle.size * puzzle.size);
    const geometric = /(?<![\w-])(width|height|min-width|max-width|min-height|max-height|padding|margin|font-size)\s*:/;
    for (const snippet of ['.wordsearch button.letter.found', '.wordsearch button.letter.anchor', '.wordsearch button.letter.cursor']) {
      const bodies = ruleBodies(css, snippet);
      expect(bodies.length, snippet).toBeGreaterThan(0);
      for (const body of bodies) expect(body, snippet).not.toMatch(geometric);
    }
  });
});

type Box = { x: number; y: number; w: number; h: number };

describe('word search layout in a browser', () => {
  it('keeps letter cells fixed and scrolls on a narrow large-print screen', async () => {
    const found = wordsearchBoardHtml(puzzle, puzzle.words, null, 0);
    const marked = wordsearchBoardHtml(puzzle, puzzle.words.slice(0, 3), 4, 4);
    const plain = wordsearchBoardHtml(puzzle, [], null, 0);
    const page = (large: boolean) => `<!doctype html><html><head><style>${css}</style></head><body class="${large ? 'large-print' : ''}"><section id="plain" class="wrap">${plain}</section><section id="found" class="wrap">${found}</section><section id="marked" class="wrap">${marked}</section></body></html>`;
    const script = `(() => {
      const out = {};
      for (const section of document.querySelectorAll('section')) {
        const buttons = [...section.querySelectorAll('button.letter')];
        const scroller = section.querySelector('.wordsearch-scroll');
        out[section.id] = {
          boxes: buttons.map((button) => {
            const r = button.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          }),
          scrollWidth: scroller.scrollWidth,
          clientWidth: scroller.clientWidth,
          scrollHeight: scroller.scrollHeight,
          clientHeight: scroller.clientHeight,
        };
      }
      return out;
    })()`;
    await withChrome(async (evaluate, setViewport, setHtml) => {
      const check = async (width: number, height: number, large: boolean) => {
        await setViewport(width, height);
        await setHtml(page(large));
        const measured = (await evaluate(script)) as Record<string, { boxes: Box[]; scrollWidth: number; clientWidth: number; scrollHeight: number; clientHeight: number }>;
        const base = measured.plain;
        if (!base) throw new Error('missing plain');
        const cell = base.boxes[0];
        if (!cell) throw new Error('missing cell');
        expect(base.boxes).toHaveLength(puzzle.size * puzzle.size);
        for (const id of ['plain', 'found', 'marked']) {
          const measure = measured[id];
          if (!measure) throw new Error(id);
          for (let index = 0; index < base.boxes.length; index++) {
            const left = base.boxes[index];
            const right = measure.boxes[index];
            if (!left || !right) throw new Error('box');
            expect(Math.abs(right.w - cell.w), `${width} ${id} w`).toBeLessThan(0.75);
            expect(Math.abs(right.h - cell.h), `${width} ${id} h`).toBeLessThan(0.75);
            expect(Math.abs(right.x - left.x), `${width} ${id} x`).toBeLessThan(0.75);
            expect(Math.abs((right.y - measure.boxes[0]!.y) - (left.y - base.boxes[0]!.y)), `${width} ${id} y`).toBeLessThan(0.75);
          }
          for (let index = 1; index < puzzle.size; index++) {
            const prev = measure.boxes[index - 1];
            const next = measure.boxes[index];
            if (!prev || !next) throw new Error('gap');
            expect(Math.abs(next.x - prev.x - cell.w), `${width} gap`).toBeLessThan(0.75);
          }
        }
        if (width === 390 && large) {
          expect(base.scrollWidth).toBeGreaterThan(base.clientWidth);
          expect(base.scrollHeight).toBeGreaterThan(base.clientHeight);
          expect(cell.w).toBeGreaterThanOrEqual(40);
        }
      };
      await check(1280, 800, false);
      await check(390, 844, false);
      await check(1280, 800, true);
      await check(390, 844, true);
    });
  }, 60_000);
});
