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
  it('fits equal tracks and state classes do not resize cells', () => {
    const html = wordsearchBoardHtml(puzzle, [], null, 0);
    expect(html).toContain(`--size: ${puzzle.size}`);
    expect(html).toContain('wordsearch-viewport');
    expect(html).toContain('wordsearch-zoom-in');
    expect(html).toContain('wordsearch-zoom-out');
    expect(html).toContain('wordsearch-fit');
    expect(html).toContain('wordsearch-pan');
    expect(html).toContain('aria-label="Pan. Drag to move the grid"');
    expect(html.match(/data-i="/g)).toHaveLength(puzzle.size * puzzle.size);
    expect(css).toContain('aspect-ratio: 1');
    expect(css).toContain('repeat(var(--size), minmax(0, 1fr))');
    expect(css).not.toContain('--letter: 40px');
    expect(css).not.toMatch(/user-scalable\s*=\s*no/i);
    expect(css).not.toMatch(/maximum-scale\s*=\s*1/i);
    const play = readFileSync(new URL('../play/index.html', import.meta.url), 'utf8');
    expect(play).not.toMatch(/user-scalable\s*=\s*no/i);
    expect(play).not.toMatch(/maximum-scale\s*=\s*1/i);
    const geometric = /(?<![\w-])(width|height|min-width|max-width|min-height|max-height|padding|margin|font-size)\s*:/;
    for (const snippet of ['.wordsearch button.letter.found', '.wordsearch button.letter.anchor', '.wordsearch button.letter.cursor']) {
      const bodies = ruleBodies(css, snippet);
      expect(bodies.length, snippet).toBeGreaterThan(0);
      for (const body of bodies) expect(body, snippet).not.toMatch(geometric);
    }
  });
});

type Box = { x: number; y: number; w: number; h: number };
type Measure = {
  boxes: Box[];
  view: Box;
  pageScrollWidth: number;
  pageClientWidth: number;
};

describe('word search layout in a browser', () => {
  it('fits the whole grid to the width in normal and large print', async () => {
    const pageFor = (boardPuzzle: typeof puzzle, large: boolean) => {
      const found = wordsearchBoardHtml(boardPuzzle, boardPuzzle.words, null, 0);
      const marked = wordsearchBoardHtml(boardPuzzle, boardPuzzle.words.slice(0, 3), 4, 4);
      const plain = wordsearchBoardHtml(boardPuzzle, [], null, 0);
      return `<!doctype html><html><head><style>${css}</style></head><body class="${large ? 'large-print' : ''}"><section id="plain" class="wrap">${plain}</section><section id="found" class="wrap">${found}</section><section id="marked" class="wrap">${marked}</section></body></html>`;
    };
    const script = `(() => {
      const root = document.documentElement;
      const out = {};
      for (const section of document.querySelectorAll('section')) {
        const buttons = [...section.querySelectorAll('button.letter')];
        const viewport = section.querySelector('.wordsearch-viewport');
        const view = viewport.getBoundingClientRect();
        out[section.id] = {
          boxes: buttons.map((button) => {
            const r = button.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          }),
          view: { x: view.x, y: view.y, w: view.width, h: view.height },
          pageScrollWidth: root.scrollWidth,
          pageClientWidth: root.clientWidth,
        };
      }
      return out;
    })()`;
    await withChrome(async (evaluate, setViewport, setHtml) => {
      const check = async (boardPuzzle: typeof puzzle, width: number, height: number, large: boolean) => {
        await setViewport(width, height);
        await setHtml(pageFor(boardPuzzle, large));
        const label = `${boardPuzzle.size} ${width} ${large ? 'large' : 'normal'}`;
        const measured = (await evaluate(script)) as Record<string, Measure>;
        const base = measured.plain;
        if (!base) throw new Error(`missing plain ${label}`);
        const cell = base.boxes[0];
        if (!cell) throw new Error(`missing cell ${label}`);
        expect(base.boxes, label).toHaveLength(boardPuzzle.size * boardPuzzle.size);
        expect(base.pageScrollWidth, label).toBeLessThanOrEqual(base.pageClientWidth + 1);
        expect(base.view.w, label).toBeGreaterThan(width > 700 ? 500 : width - 48);
        expect(Math.abs(base.view.w - base.view.h), label).toBeLessThan(2);
        expect(cell.w, label).toBeGreaterThan(8);
        expect(Math.abs(cell.w * boardPuzzle.size - base.view.w), label).toBeLessThan(4);
        for (const box of base.boxes) {
          expect(box.x, label).toBeGreaterThanOrEqual(base.view.x - 1);
          expect(box.y, label).toBeGreaterThanOrEqual(base.view.y - 1);
          expect(box.x + box.w, label).toBeLessThanOrEqual(base.view.x + base.view.w + 1.5);
          expect(box.y + box.h, label).toBeLessThanOrEqual(base.view.y + base.view.h + 1.5);
        }
        for (const id of ['plain', 'found', 'marked']) {
          const measure = measured[id];
          if (!measure) throw new Error(id);
          for (let index = 0; index < base.boxes.length; index++) {
            const left = base.boxes[index];
            const right = measure.boxes[index];
            if (!left || !right) throw new Error('box');
            expect(Math.abs(right.w - cell.w), `${label} ${id} w`).toBeLessThan(0.75);
            expect(Math.abs(right.h - cell.h), `${label} ${id} h`).toBeLessThan(0.75);
            expect(Math.abs(right.x - left.x), `${label} ${id} x`).toBeLessThan(0.75);
            expect(Math.abs((right.y - measure.boxes[0]!.y) - (left.y - base.boxes[0]!.y)), `${label} ${id} y`).toBeLessThan(0.75);
          }
          for (let index = 1; index < boardPuzzle.size; index++) {
            const prev = measure.boxes[index - 1];
            const next = measure.boxes[index];
            if (!prev || !next) throw new Error('gap');
            expect(Math.abs(next.x - prev.x - cell.w), `${label} gap`).toBeLessThan(0.75);
          }
        }
      };
      const sunday = wordsearchForDate('2026-11-01');
      for (const boardPuzzle of [puzzle, sunday]) {
        await check(boardPuzzle, 1280, 800, false);
        await check(boardPuzzle, 390, 844, false);
        await check(boardPuzzle, 360, 800, false);
        await check(boardPuzzle, 390, 844, true);
        await check(boardPuzzle, 360, 800, true);
      }
    });
  }, 90_000);
});
