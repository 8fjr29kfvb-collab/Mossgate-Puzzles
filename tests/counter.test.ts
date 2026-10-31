import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { visitCounter, visitCounterScript } from '../src/counter.ts';

describe('visit counter hook', () => {
  it('stays disabled and does not add a script', () => {
    expect(visitCounter.enabled).toBe(false);
    expect(visitCounterScript()).toBeNull();
    const html = readFileSync(new URL('../play/index.html', import.meta.url), 'utf8');
    const scripts = html.match(/<script/g) ?? [];
    expect(scripts).toHaveLength(1);
    expect(html).not.toMatch(/gc\.zgo\.at|googletagmanager|google-analytics|fonts\.googleapis|cdn\.jsdelivr/);
    expect(html.toLowerCase()).toContain('goatcounter');
  });
});
