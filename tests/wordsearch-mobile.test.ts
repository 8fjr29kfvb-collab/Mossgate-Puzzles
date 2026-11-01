import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { withChromeSession, type ChromeSession } from './chrome-page.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const viteBin = fileURLToPath(new URL('../node_modules/.bin/vite', import.meta.url));

function startVite(port: number): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(viteBin, ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: root,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(child);
    };
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const plain = output.replace(/\u001b\[[0-9;]*m/g, '');
      if (plain.includes(`127.0.0.1:${port}`)) finish();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) => {
      if (!settled) finish(new Error(`vite exited ${code}\n${output}`));
    });
    setTimeout(() => finish(new Error(`vite did not start\n${output}`)), 20_000);
  });
}

async function waitFor(session: ChromeSession, expression: string): Promise<void> {
  let last = '';
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const ready = await session.evaluate(`Boolean(${expression})`);
      if (ready) return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${expression}. ${last}`);
}

async function frame(session: ChromeSession): Promise<void> {
  await session.evaluate(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
}

async function clickId(session: ChromeSession, id: string): Promise<void> {
  const point = (await session.evaluate(`(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    if (!(el instanceof HTMLElement) || el.hidden || el.hasAttribute('disabled')) return null;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = el.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`)) as { x: number; y: number } | null;
  if (!point) throw new Error(`Cannot click #${id}`);
  await session.mouse('mouseMoved', point.x, point.y);
  await session.mouse('mousePressed', point.x, point.y);
  await session.mouse('mouseReleased', point.x, point.y);
  await frame(session);
}

async function drag(session: ChromeSession, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await session.mouse('mouseMoved', x1, y1);
  await session.mouse('mousePressed', x1, y1);
  const steps = 8;
  for (let step = 1; step <= steps; step++) {
    await session.mouse('mouseMoved', x1 + ((x2 - x1) * step) / steps, y1 + ((y2 - y1) * step) / steps);
  }
  await session.mouse('mouseReleased', x2, y2);
  await frame(session);
}

type Fit = {
  scrollWidth: number;
  clientWidth: number;
  cell: number;
  count: number;
  size: number;
  inside: boolean;
  onScreen: boolean;
  viewW: number;
  viewH: number;
  overflowX: string;
  overflowY: string;
  meta: string;
  listInsideGrid: boolean;
};

async function readFit(session: ChromeSession): Promise<Fit> {
  return (await session.evaluate(`(() => {
    const viewport = document.querySelector('.wordsearch-viewport');
    const grid = document.querySelector('.wordsearch');
    const list = document.querySelector('.word-list');
    const cell = document.querySelector('.wordsearch button.letter');
    if (!viewport || !grid || !list || !cell) return null;
    viewport.scrollIntoView({ block: 'center', inline: 'nearest' });
    const view = viewport.getBoundingClientRect();
    const boxes = [...document.querySelectorAll('.wordsearch button.letter')].map((button) => button.getBoundingClientRect());
    const style = getComputedStyle(viewport);
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      cell: cell.getBoundingClientRect().width,
      count: boxes.length,
      size: Number(grid.dataset.size),
      inside: boxes.every((rect) => rect.left >= view.left - 1 && rect.top >= view.top - 1 && rect.right <= view.right + 1.5 && rect.bottom <= view.bottom + 1.5),
      onScreen: view.top >= -1 && view.left >= -1 && view.bottom <= window.innerHeight + 1 && view.right <= window.innerWidth + 1 && view.width > 0,
      viewW: view.width,
      viewH: view.height,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      meta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '',
      listInsideGrid: viewport.contains(list),
    };
  })()`)) as Fit;
}

async function wordListReachable(session: ChromeSession): Promise<{ visible: boolean; afterGrid: boolean; scrollWidth: number; clientWidth: number }> {
  return (await session.evaluate(`(() => {
    const list = document.querySelector('.word-list');
    const viewport = document.querySelector('.wordsearch-viewport');
    if (!list || !viewport) return null;
    list.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = list.getBoundingClientRect();
    const listTop = rect.top + window.scrollY;
    const viewBottom = viewport.getBoundingClientRect().bottom + window.scrollY;
    return {
      visible: rect.height > 20 && rect.width > 40 && rect.top < window.innerHeight && rect.bottom > 0 && rect.left >= -1 && rect.right <= window.innerWidth + 1,
      afterGrid: listTop >= viewBottom - 1,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  })()`)) as { visible: boolean; afterGrid: boolean; scrollWidth: number; clientWidth: number };
}

describe('word search on a phone', () => {
  it('fits, zooms, pans without selecting, and keeps drag selection and the word list', async () => {
    const port = 43_000 + Math.floor(Math.random() * 1_000);
    const server = await startVite(port);
    const origin = `http://127.0.0.1:${port}`;
    try {
      await withChromeSession(async (session) => {
        for (const width of [390, 360]) {
          const height = width === 390 ? 844 : 800;
          await session.setViewport(width, height);
          for (const date of ['2026-10-31', '2026-11-01']) {
            for (const large of [false, true]) {
              const label = `${width}x${height} ${date} ${large ? 'large' : 'normal'}`;
              const url = `${origin}/play/?date=${date}&fresh=${width}-${date}-${large}#wordsearch`;
              await session.navigate(url);
              await waitFor(session, `document.querySelectorAll('.wordsearch button.letter').length > 0`);
              await session.evaluate(`(() => { localStorage.clear(); localStorage.setItem = function () {}; return true; })()`);
              await session.navigate(url);
              await waitFor(session, `document.querySelectorAll('.wordsearch button.letter').length > 0`);
              const alreadyFound = await session.evaluate(`document.querySelectorAll('.word-list li.found').length`);
              expect(alreadyFound, `${label} fresh`).toBe(0);
              const largeNow = await session.evaluate(`document.body.classList.contains('large-print')`);
              if (largeNow !== large) await clickId(session, 'large-print');
              const largeOn = await session.evaluate(`document.body.classList.contains('large-print')`);
              expect(largeOn, label).toBe(large);

              const fit = await readFit(session);
              expect(fit, label).toBeTruthy();
              expect(fit.meta, label).not.toMatch(/user-scalable\s*=\s*no/i);
              expect(fit.meta, label).not.toMatch(/maximum-scale\s*=\s*1\b/i);
              expect(fit.count, label).toBe(fit.size * fit.size);
              expect(fit.size, label).toBe(date === '2026-11-01' ? 25 : 20);
              expect(fit.scrollWidth, label).toBeLessThanOrEqual(fit.clientWidth + 1);
              expect(fit.inside, label).toBe(true);
              expect(fit.onScreen, label).toBe(true);
              expect(Math.abs(fit.viewW - fit.viewH), label).toBeLessThan(2);
              expect(fit.viewW, label).toBeLessThanOrEqual(width + 1);
              expect(Math.abs(fit.cell * fit.size - fit.viewW), label).toBeLessThan(4);
              expect(fit.overflowX, label).toBe('hidden');
              expect(fit.overflowY, label).toBe('hidden');
              expect(fit.listInsideGrid, label).toBe(false);
              const listAtFit = await wordListReachable(session);
              expect(listAtFit.visible, `${label} list`).toBe(true);
              expect(listAtFit.afterGrid, `${label} list`).toBe(true);
              expect(listAtFit.scrollWidth, `${label} list`).toBeLessThanOrEqual(listAtFit.clientWidth + 1);

              const fitted = fit.cell;
              await clickId(session, 'wordsearch-zoom-in');
              const zoomed = await readFit(session);
              expect(zoomed.cell, `${label} zoom in`).toBeGreaterThan(fitted * 1.2);
              expect(zoomed.scrollWidth, `${label} zoom in`).toBeLessThanOrEqual(zoomed.clientWidth + 1);
              expect(zoomed.onScreen, `${label} zoom in`).toBe(true);
              const listZoomed = await wordListReachable(session);
              expect(listZoomed.visible, `${label} zoomed list`).toBe(true);
              expect(listZoomed.afterGrid, `${label} zoomed list`).toBe(true);
              expect(listZoomed.scrollWidth, `${label} zoomed list`).toBeLessThanOrEqual(listZoomed.clientWidth + 1);

              const target = (await session.evaluate(`(() => {
                const viewport = document.querySelector('.wordsearch-viewport');
                viewport.scrollIntoView({ block: 'center', inline: 'nearest' });
                const view = viewport.getBoundingClientRect();
                const buttons = [...document.querySelectorAll('.wordsearch button.letter')];
                const size = Math.round(Math.sqrt(buttons.length));
                const letters = buttons.map((button) => (button.textContent || '').trim());
                const words = [...document.querySelectorAll('.word-list li:not(.found)')].map((item) => (item.textContent || '').trim());
                const center = (index) => {
                  const rect = buttons[index].getBoundingClientRect();
                  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                };
                const inside = (index) => {
                  const point = center(index);
                  return point.x > view.left + 1 && point.x < view.right - 1 && point.y > view.top + 1 && point.y < view.bottom - 1;
                };
                const directions = [[0, 1], [1, 0], [1, 1]];
                for (const word of words) {
                  for (let row = 0; row < size; row++) {
                    for (let col = 0; col < size; col++) {
                      for (const [dr, dc] of directions) {
                        let match = true;
                        for (let i = 0; i < word.length; i++) {
                          const r = row + dr * i;
                          const c = col + dc * i;
                          if (r >= size || c >= size || letters[r * size + c] !== word[i]) match = false;
                        }
                        if (!match) continue;
                        const start = row * size + col;
                        const end = (row + dr * (word.length - 1)) * size + (col + dc * (word.length - 1));
                        if (!inside(start) || !inside(end)) continue;
                        const a = center(start);
                        const b = center(end);
                        return { word, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
                      }
                    }
                  }
                }
                return null;
              })()`)) as { word: string; x1: number; y1: number; x2: number; y2: number } | null;
              expect(target, `${label} draggable word`).toBeTruthy();
              if (!target) continue;
              await drag(session, target.x1, target.y1, target.x2, target.y2);
              const selected = await session.evaluate(
                `(() => {
                  const word = ${JSON.stringify(target.word)};
                  const item = [...document.querySelectorAll('.word-list li')].find((entry) => (entry.textContent || '').trim() === word);
                  return Boolean(item && item.classList.contains('found'));
                })()`,
              );
              expect(selected, `${label} selected ${target.word}`).toBe(true);

              const beforePan = (await session.evaluate(`(() => {
                const viewport = document.querySelector('.wordsearch-viewport');
                viewport.scrollIntoView({ block: 'center', inline: 'nearest' });
                const cell = document.querySelector('.wordsearch button.letter');
                const view = viewport.getBoundingClientRect();
                const rect = cell.getBoundingClientRect();
                return { x: rect.left - view.left, y: rect.top - view.top, found: document.querySelectorAll('.word-list li.found').length };
              })()`)) as { x: number; y: number; found: number };
              await clickId(session, 'wordsearch-pan');
              const panLabel = (await session.evaluate(`document.getElementById('wordsearch-pan').textContent`)) as string;
              expect(panLabel, label).toBe('Pan on');
              const panFrom = (await session.evaluate(`(() => {
                const viewport = document.querySelector('.wordsearch-viewport');
                viewport.scrollIntoView({ block: 'center', inline: 'nearest' });
                const rect = viewport.getBoundingClientRect();
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
              })()`)) as { x: number; y: number };
              await drag(session, panFrom.x, panFrom.y, panFrom.x - 36, panFrom.y - 28);
              const afterPan = (await session.evaluate(`(() => {
                const viewport = document.querySelector('.wordsearch-viewport');
                const cell = document.querySelector('.wordsearch button.letter');
                const view = viewport.getBoundingClientRect();
                const rect = cell.getBoundingClientRect();
                return { x: rect.left - view.left, y: rect.top - view.top, found: document.querySelectorAll('.word-list li.found').length, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
              })()`)) as { x: number; y: number; found: number; scrollWidth: number; clientWidth: number };
              expect(afterPan.found, `${label} pan selection`).toBe(beforePan.found);
              expect(afterPan.x, `${label} pan x`).toBeLessThan(beforePan.x - 20);
              expect(afterPan.y, `${label} pan y`).toBeLessThan(beforePan.y - 16);
              expect(afterPan.scrollWidth, `${label} pan overflow`).toBeLessThanOrEqual(afterPan.clientWidth + 1);
              const listPanned = await wordListReachable(session);
              expect(listPanned.visible, `${label} panned list`).toBe(true);

              await clickId(session, 'wordsearch-zoom-out');
              const zoomedOut = await readFit(session);
              expect(zoomedOut.cell, `${label} zoom out`).toBeLessThan(zoomed.cell - 1);
              expect(zoomedOut.scrollWidth, `${label} zoom out`).toBeLessThanOrEqual(zoomedOut.clientWidth + 1);
              await clickId(session, 'wordsearch-fit');
              const fittedAgain = await readFit(session);
              expect(Math.abs(fittedAgain.cell - fitted), `${label} fit`).toBeLessThan(1.5);
              expect(fittedAgain.inside, `${label} fit`).toBe(true);
              expect(fittedAgain.onScreen, `${label} fit`).toBe(true);
              expect(fittedAgain.scrollWidth, `${label} fit`).toBeLessThanOrEqual(fittedAgain.clientWidth + 1);
              const listAgain = await wordListReachable(session);
              expect(listAgain.visible, `${label} fit list`).toBe(true);
              expect(listAgain.afterGrid, `${label} fit list`).toBe(true);
            }
          }
        }
      });
    } finally {
      server.kill('SIGTERM');
    }
  }, 180_000);
});
