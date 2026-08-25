// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { walkPriceElements } from '../../src/lib/detection/walker';

describe('a hostile page cannot hang the tab', () => {
  it('bounds total work across a pass, not just per element', () => {
    // The number patterns are quadratic on long digit runs. Each of these is
    // under the per-element cap, so only a pass-level budget stops them.
    const payload = '1' + '.111'.repeat(240);
    document.body.innerHTML = Array.from({ length: 300 }, () => `<p>$${payload}</p>`).join('');

    const started = Date.now();
    walkPriceElements(document.body);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('caps the direct-text branch like every other path', () => {
    const long = 'x'.repeat(4000);
    document.body.innerHTML = `<p>${long} $19.99 <span>$5</span></p>`;
    const texts = walkPriceElements(document.body).map((r) => r.text);
    expect(texts.every((t) => t.length <= 1000)).toBe(true);
  });
});
