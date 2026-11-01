import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function chromeBinary(): string {
  const fromEnv = process.env.CHROME_PATH;
  const candidates = [fromEnv, 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].filter(
    (item): item is string => Boolean(item),
  );
  for (const candidate of candidates) {
    const found = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  throw new Error(`Chrome was not found. Tried ${candidates.join(', ')}`);
}

export async function withChrome(
  run: (
    evaluate: (expression: string) => Promise<unknown>,
    setViewport: (width: number, height: number) => Promise<void>,
    setHtml: (html: string) => Promise<void>,
  ) => Promise<void>,
): Promise<void> {
  const binary = chromeBinary();
  const port = 9700 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'layout-chrome-'));
  const chrome: ChildProcess = spawn(
    binary,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--disable-extensions',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  chrome.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });
  try {
    let pageSocket = '';
    for (let attempt = 0; attempt < 100; attempt++) {
      if (chrome.exitCode != null) {
        throw new Error(`Chrome exited ${chrome.exitCode}. ${stderr}`);
      }
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
    if (!pageSocket) throw new Error(`Chrome did not open a page debugging socket. ${stderr}`);
    const ws = new WebSocket(pageSocket);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error(`Chrome debugger socket failed. ${stderr}`)));
    });
    let nextId = 0;
    const pending = new Map<number, (value: unknown) => void>();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (message.id != null && pending.has(message.id)) {
        const resolve = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) resolve?.(Promise.reject(new Error(message.error.message)));
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
    };
    const evaluate = async (expression: string) => {
      const result = (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })) as {
        result?: { value?: unknown };
        exceptionDetails?: { text?: string };
      };
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? 'Chrome evaluation failed');
      return result.result?.value;
    };
    await run(evaluate, setViewport, setHtml);
    ws.close();
  } finally {
    chrome.kill();
  }
}
