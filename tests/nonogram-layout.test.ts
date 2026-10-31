import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nonogramBoardHtml } from '../src/nonogram-board.ts';
import { nonogramForDate } from '../src/nonogram.ts';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

function ruleBodies(source: string, selectorSnippet: string): string[] {
  const bodies: string[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1]?.includes(selectorSnippet)) bodies.push(match[2] ?? '');
  }
  return bodies;
}

describe('nonogram board markup', () => {
  const puzzle = nonogramForDate('2026-10-31');

  it('places clues and cells on repeat(N, var(--cell)) tracks with no separator columns', () => {
    const html = nonogramBoardHtml({
      size: puzzle.size,
      rowClues: puzzle.rowClues,
      colClues: puzzle.colClues,
      cells: Array(puzzle.size * puzzle.size).fill(0),
      selected: 0,
      mistakeAt: () => false,
    });
    const clueCols = Math.max(...puzzle.rowClues.map((clues) => clues.length));
    const clueRows = Math.max(...puzzle.colClues.map((clues) => clues.length));
    const colTracks = clueCols + puzzle.size;
    const rowTracks = clueRows + puzzle.size;
    expect(html).toContain(`grid-template-columns: repeat(${colTracks}, var(--cell))`);
    expect(html).toContain(`grid-template-rows: repeat(${rowTracks}, var(--cell))`);
    expect(html.match(/data-i="/g)).toHaveLength(puzzle.size * puzzle.size);
    expect(html).not.toMatch(/<td|<th|<table|separator|corner/);
  });
});

describe('nonogram sizing css', () => {
  it('keeps state classes from changing the box', () => {
    expect(css).toMatch(/--cell:\s*clamp\(/);
    expect(css).toMatch(/\.nonogram\s*\{[^}]*box-sizing:\s*border-box/);
    const geometric = /(?<![\w-])(width|height|min-width|max-width|min-height|max-height|padding|margin|border-width|flex-basis|font-size)\s*:/;
    for (const snippet of [
      '.nonogram button.filled',
      '.nonogram button.cross',
      '.clue.done',
      '.nonogram button.peer',
      '.nonogram button.mistake',
      '.nonogram button.selected',
    ]) {
      const bodies = ruleBodies(css, snippet);
      expect(bodies.length, snippet).toBeGreaterThan(0);
      for (const body of bodies) {
        expect(body, snippet).not.toMatch(geometric);
      }
    }
  });
});

type Box = { x: number; y: number; w: number; h: number };
type Measure = {
  tracks: string;
  cells: Box[];
  colClues: { x: number; y: number; w: number; h: number; spans: Box[] }[];
  rowClues: { x: number; y: number; w: number; h: number; spans: Box[] }[];
};

function board(cells: number[], selected = -1): string {
  const puzzle = nonogramForDate('2026-10-31');
  return nonogramBoardHtml({
    size: puzzle.size,
    rowClues: puzzle.rowClues,
    colClues: puzzle.colClues,
    cells,
    selected,
    mistakeAt: (index) => {
      const row = Math.floor(index / puzzle.size);
      const col = index % puzzle.size;
      const value = cells[index] ?? 0;
      const should = puzzle.solution[row]?.[col] ?? false;
      return (value === 1 && !should) || (value === 2 && should);
    },
  });
}

function page(states: Record<string, string>): string {
  const sections = Object.entries(states)
    .map(([id, html]) => `<section id="${id}" class="wrap">${html}</section>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${sections}</body></html>`;
}

const measureScript = `(() => {
  function box(el) {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  const out = {};
  for (const section of document.querySelectorAll('section')) {
    const grid = section.querySelector('.nonogram');
    out[section.id] = {
      tracks: getComputedStyle(grid).gridTemplateColumns,
      cells: [...section.querySelectorAll('button.cell')].map(box),
      colClues: [...section.querySelectorAll('.col-clue')].map((el) => ({
        ...box(el),
        spans: [...el.querySelectorAll('span')].map(box),
      })),
      rowClues: [...section.querySelectorAll('.row-clue')].map((el) => ({
        ...box(el),
        spans: [...el.querySelectorAll('span')].map(box),
      })),
    };
  }
  return out;
})()`;

async function withChrome(run: (evaluate: (expression: string) => Promise<unknown>, setViewport: (width: number, height: number) => Promise<void>, setHtml: (html: string) => Promise<void>) => Promise<void>): Promise<void> {
  const port = 9400 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(join(tmpdir(), 'nonogram-chrome-'));
  const chrome: ChildProcess = spawn(
    'google-chrome',
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  try {
    let pageSocket = '';
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        if (response.ok) {
          const pages = (await response.json()) as { type: string; webSocketDebuggerUrl: string }[];
          pageSocket = pages.find((page) => page.type === 'page')?.webSocketDebuggerUrl ?? '';
          if (pageSocket) break;
        }
      } catch {
        // Chrome is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!pageSocket) throw new Error('Chrome did not open a page debugging socket');
    const ws = new WebSocket(pageSocket);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error('Chrome debugger socket failed')));
    });
    let nextId = 0;
    const pending = new Map<number, (value: unknown) => void>();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (message.id != null && pending.has(message.id)) {
        const resolve = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) resolve?.(Promise.reject(new Error(`${message.error.message}`)));
        else resolve?.(message.result);
      }
    });
    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<unknown>((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, (value: unknown) => {
          if (value instanceof Promise) value.then(resolve, reject);
          else resolve(value);
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    await send('Page.enable');
    await send('Runtime.enable');
    const tree = (await send('Page.getFrameTree')) as { frameTree: { frame: { id: string } } };
    const frameId = tree.frameTree.frame.id;
    const setViewport = async (width: number, height: number) => {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    };
    const setHtml = async (html: string) => {
      await send('Page.setDocumentContent', { frameId, html });
      await send('Runtime.evaluate', { expression: 'document.fonts ? document.fonts.ready : null', awaitPromise: true });
    };
    const evaluate = async (expression: string) => {
      const result = (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })) as {
        result?: { value?: unknown };
      };
      return result.result?.value;
    };
    await run(evaluate, setViewport, setHtml);
    ws.close();
  } finally {
    chrome.kill();
  }
}

function normalize(measure: Measure): Measure {
  const origin = measure.cells[0];
  if (!origin) throw new Error('missing origin');
  const shift = (box: Box): Box => ({ x: box.x - origin.x, y: box.y - origin.y, w: box.w, h: box.h });
  return {
    tracks: measure.tracks,
    cells: measure.cells.map(shift),
    colClues: measure.colClues.map((clue) => ({ ...shift(clue), spans: clue.spans.map(shift) })),
    rowClues: measure.rowClues.map((clue) => ({ ...shift(clue), spans: clue.spans.map(shift) })),
  };
}

function expectStable(rawMeasures: Measure[], label: string): void {
  const measures = rawMeasures.map(normalize);
  const base = measures[0];
  if (!base) throw new Error('missing measure');
  const tracks = base.tracks.split(' ').filter(Boolean);
  expect(tracks.length, label).toBeGreaterThan(10);
  const width = Number.parseFloat(tracks[0] ?? '0');
  for (const track of tracks) {
    expect(Math.abs(Number.parseFloat(track) - width), `${label} track ${track}`).toBeLessThan(0.05);
  }
  expect(base.cells).toHaveLength(100);
  const cell = base.cells[0];
  if (!cell) throw new Error('missing cell');
  expect(Math.abs(cell.w - width), label).toBeLessThan(0.75);
  expect(Math.abs(cell.h - cell.w), label).toBeLessThan(0.75);

  for (const measure of measures) {
    expect(measure.cells).toHaveLength(base.cells.length);
    for (let index = 0; index < base.cells.length; index++) {
      const left = base.cells[index];
      const right = measure.cells[index];
      if (!left || !right) throw new Error('missing cell box');
      expect(Math.abs(left.x - right.x), `${label} cell ${index} x`).toBeLessThan(0.75);
      expect(Math.abs(left.y - right.y), `${label} cell ${index} y`).toBeLessThan(0.75);
      expect(Math.abs(left.w - right.w), `${label} cell ${index} w`).toBeLessThan(0.75);
      expect(Math.abs(left.h - right.h), `${label} cell ${index} h`).toBeLessThan(0.75);
      expect(Math.abs(right.w - cell.w), `${label} cell ${index} size`).toBeLessThan(0.75);
      expect(Math.abs(right.h - cell.h), `${label} cell ${index} size`).toBeLessThan(0.75);
    }
    for (let index = 1; index < 10; index++) {
      const prev = measure.cells[index - 1];
      const next = measure.cells[index];
      if (!prev || !next) throw new Error('missing row cell');
      expect(Math.abs(next.x - prev.x - cell.w), `${label} gap ${index}`).toBeLessThan(0.75);
    }
    expect(measure.colClues).toHaveLength(10);
    for (let column = 0; column < 10; column++) {
      const clue = measure.colClues[column];
      const play = measure.cells[column];
      if (!clue || !play) throw new Error('missing column');
      expect(Math.abs(clue.x - play.x), `${label} col clue ${column}`).toBeLessThan(0.75);
      expect(Math.abs(clue.w - play.w), `${label} col clue width ${column}`).toBeLessThan(0.75);
      for (const span of clue.spans) {
        expect(Math.abs(span.w - cell.w), `${label} col number`).toBeLessThan(0.75);
        expect(Math.abs(span.h - cell.h), `${label} col number`).toBeLessThan(0.75);
      }
    }
    expect(measure.rowClues).toHaveLength(10);
    for (let row = 0; row < 10; row++) {
      const clue = measure.rowClues[row];
      const play = measure.cells[row * 10];
      if (!clue || !play) throw new Error('missing row');
      expect(Math.abs(clue.y - play.y), `${label} row clue ${row}`).toBeLessThan(0.75);
      expect(Math.abs(clue.h - play.h), `${label} row clue height ${row}`).toBeLessThan(0.75);
      expect(Math.abs(clue.x + clue.w - play.x), `${label} row clue edge ${row}`).toBeLessThan(0.75);
      for (const span of clue.spans) {
        expect(Math.abs(span.w - cell.w), `${label} row number`).toBeLessThan(0.75);
        expect(Math.abs(span.h - cell.h), `${label} row number`).toBeLessThan(0.75);
      }
    }
  }
}

describe('nonogram layout in a browser', () => {
  it('keeps cell and clue boxes fixed across fill, cross, and done states', async () => {
    const puzzle = nonogramForDate('2026-10-31');
    const empty = Array<number>(100).fill(0);
    const filled = Array<number>(100).fill(1);
    const crossed = Array<number>(100).fill(2);
    const solved: number[] = puzzle.solution.flatMap((row) => row.map((cell) => (cell ? 1 : 0)));
    solved[0] = solved[0] === 1 ? 2 : 1;
    const html = page({
      empty: board(empty, 0),
      filled: board(filled, 3),
      crossed: board(crossed, 8),
      solved: board(solved, 0),
    });
    await withChrome(async (evaluate, setViewport, setHtml) => {
      const check = async (width: number, height: number, largePrint: boolean) => {
        await setViewport(width, height);
        const styled = largePrint ? html.replace('<body>', '<body class="large-print">') : html;
        await setHtml(styled);
        const measured = (await evaluate(measureScript)) as Record<string, Measure>;
        expectStable([measured.empty, measured.filled, measured.crossed, measured.solved].filter(Boolean), `${width} ${largePrint ? 'large-print' : 'regular'}`);
      };
      await check(1280, 800, false);
      await check(390, 844, false);
      await check(1280, 800, true);
      await check(390, 844, true);
    });
  }, 60_000);
});
