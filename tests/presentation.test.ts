import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function contrast(a: string, b: string): number {
  const lin = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const lum = (hex: string) => {
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const bl = Number.parseInt(hex.slice(5, 7), 16);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
  };
  const left = lum(a);
  const right = lum(b);
  const [hi, lo] = left > right ? [left, right] : [right, left];
  return (hi + 0.05) / (lo + 0.05);
}

function cssVar(css: string, name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match?.[1]) throw new Error(`Missing ${name}`);
  return match[1];
}

describe('presentation', () => {
  it('keeps text contrast high', () => {
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    const paper = cssVar(css, '--paper');
    const ink = cssVar(css, '--ink');
    const moss = cssVar(css, '--moss');
    const muted = cssVar(css, '--muted');
    const mistake = cssVar(css, '--mistake');
    const mistakeBg = cssVar(css, '--mistake-bg');
    const card = cssVar(css, '--card');
    expect(contrast(ink, paper)).toBeGreaterThan(7);
    expect(contrast(moss, paper)).toBeGreaterThan(7);
    expect(contrast(paper, moss)).toBeGreaterThan(7);
    expect(contrast(muted, paper)).toBeGreaterThan(7);
    expect(contrast(mistake, paper)).toBeGreaterThan(4.5);
    expect(contrast(ink, mistakeBg)).toBeGreaterThan(7);
    expect(contrast(mistake, mistakeBg)).toBeGreaterThan(4.5);
    expect(contrast(ink, card)).toBeGreaterThan(7);
    expect(css).toContain('Atkinson Hyperlegible');
    expect(css).toMatch(/body\.large-print\s*\{[^}]*font-size:\s*20px/);
  });

  it('does not make health claims and explains hosting', () => {
    const files = [
      'index.html',
      'play/index.html',
      'landing/styles.css',
      'landing/script.js',
      'README.md',
      'src/main.ts',
      'src/share.ts',
      'src/counter.ts',
      'src/style.css',
    ];
    const banned = /brain|cognitive|dementia|alzheimer|mental fitness|wellness|therapy/i;
    for (const file of files) {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      expect(text, file).not.toMatch(banned);
    }
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    expect(readme).toContain('GitHub Pages');
    expect(readme).toContain('Asia/Tokyo');
    expect(readme).toContain('localStorage');
    expect(readme).toContain('npm test');
    expect(readme).toContain('41773');
    expect(readme).toContain('© Mossgate Puzzles');
    expect(readme).toContain('/Mossgate-Puzzles/');
  });
});
