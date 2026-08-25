// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: () => ({
      getValue: async () => null,
      setValue: async () => {},
      watch: () => () => {},
    }),
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
    watch: () => () => {},
  },
}));

import { convertPricesInNode, revertConversions } from '../../src/entrypoints/content/converter';
import { CONVERTED_MARKER, SPAN_CLASS } from '../../src/entrypoints/content/markers';
import type { RatesData } from '../../src/lib/storage/rates';
import { DEFAULT_SETTINGS } from '../../src/lib/storage/settings';

const rates: RatesData = {
  rates: { USD: 0.00125 },
  updatedAt: Date.now(),
  source: 'test',
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the page cannot make Zentat inject markup', () => {
  // A sanitizer that strips script vectors but allows class and data-*
  // (DOMPurify's defaults) would otherwise let an attacker route a payload
  // through our revert path.
  it('ignores a forged container snapshot', () => {
    document.body.innerHTML = `<div class="${CONVERTED_MARKER}" `
      + `data-zentat-original="<img src=x onerror=PAYLOAD>">$19.99</div>`;

    revertConversions();

    // The attribute is still sitting there as inert page markup — what matters
    // is that nothing parsed it into nodes.
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('div')!.children).toHaveLength(0);
    expect(document.querySelector('div')!.textContent).toBe('$19.99');
  });

  it('ignores a forged span original', () => {
    document.body.innerHTML = `<span class="${SPAN_CLASS}" `
      + `data-zentat-original="<img src=x onerror=PAYLOAD>">0.02 ZEC</span>`;

    revertConversions();

    expect(document.querySelector('img')).toBeNull();
    // The page's own markup is left exactly as it was, not rewritten.
    expect(document.querySelector(`.${SPAN_CLASS}`)).not.toBeNull();
  });

  it('keeps marker names off any fixed string a page could select on', () => {
    for (const name of [CONVERTED_MARKER, SPAN_CLASS]) {
      expect(name).not.toContain('zentat');
    }
  });

  it('injects no stylesheet a page could detect', () => {
    document.body.innerHTML = '<p>$19.99</p>';
    convertPricesInNode(document.body, rates, DEFAULT_SETTINGS);

    expect(document.querySelector('style#zentat-style')).toBeNull();
    expect(document.head.querySelectorAll('style')).toHaveLength(0);
  });

  it('still reverts its own conversions exactly', () => {
    document.body.innerHTML = '<p id="p">Price: $19.99 today</p>';
    convertPricesInNode(document.body, rates, DEFAULT_SETTINGS);
    expect(document.getElementById('p')!.textContent).not.toContain('$19.99');

    revertConversions();
    expect(document.getElementById('p')!.textContent).toBe('Price: $19.99 today');
  });
});
