import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('landing page', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  it('links Number Trails to the daily puzzles and drops the draft label', () => {
    expect(html).toContain('a satisfying little break');
    expect(html).not.toMatch(/mental escape|Website draft|In development/i);
    expect(html).toContain('href="play/"');
    expect(html).toContain('© Mossgate Puzzles');
    expect(html).toContain('content="assets/mossgate-fox.webp"');
    expect(html).toContain('TODO: set og:image');
    expect(html).not.toMatch(/teachers pay|amazon|goatcounter|analytics|cookie/i);
  });

  it('keeps the fox artwork under 300 KB', () => {
    const size = statSync(new URL('../public/assets/mossgate-fox.webp', import.meta.url)).size;
    expect(size).toBeGreaterThan(50_000);
    expect(size).toBeLessThan(300 * 1024);
  });
});

describe('Pages workflow', () => {
  it('builds the project site and deploys with GitHub Pages actions', () => {
    const workflow = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('actions/deploy-pages@v4');
    expect(workflow).toContain('actions/upload-pages-artifact@v3');
    const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
    expect(config).toContain("'/mossgate-puzzles/'");
    expect(config).toContain('play/index.html');
  });
});
