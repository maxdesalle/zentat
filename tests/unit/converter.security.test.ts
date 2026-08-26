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
import {
  CONVERTED_MARKER,
  rememberContainer,
  SPAN_CLASS,
  takeContainer,
} from '../../src/entrypoints/content/markers';
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

describe('the page cannot pick Zentat out of a crowd', () => {
  it('builds every marker name from the random bytes it was handed', async () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (out: Uint8Array) => {
        out.set([0, 1, 2, 3, 4, 5]);
        return out;
      },
    });
    vi.resetModules();

    const markers = await import('../../src/entrypoints/content/markers');

    // Fixed-width encoding matters as much as the randomness: it keeps every
    // install's markers the same shape, so the only thing that differs between
    // two pages is the random part itself.
    expect(markers.CONVERTED_MARKER).toBe('z00010203p');
    expect(markers.PARTIAL_MARKER).toBe('z00010203q');
    expect(markers.SPAN_CLASS).toBe('z00010203c');

    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('gives two page loads names that do not match', async () => {
    vi.resetModules();
    const first = await import('../../src/entrypoints/content/markers');
    vi.resetModules();
    const second = await import('../../src/entrypoints/content/markers');

    // A name shared across pages is a CSS-only fingerprint: no script needed,
    // so script blocking does not save the user from being identified as
    // running a Zcash extension.
    expect(second.SPAN_CLASS).not.toBe(first.SPAN_CLASS);
  });
});

describe('the snapshot Zentat keeps so it can undo itself', () => {
  it('keeps the state from before the first conversion, not the latest', () => {
    const el = document.createElement('div');

    rememberContainer(el, '<span>$19.99</span>', 'was 24.99');
    // A second pass over an already converted container offers up the ZEC text
    // as if it were the original. Trusting it would leave the user unable to
    // get back to the price the shop actually charges.
    rememberContainer(el, '<span>0.02 ZEC</span>', '0.03 ZEC');

    expect(takeContainer(el)).toEqual({ html: '<span>$19.99</span>', prevTitle: 'was 24.99' });
  });

  it('hands a container its snapshot once and then forgets it', () => {
    const el = document.createElement('div');
    rememberContainer(el, '<span>$19.99</span>', null);
    takeContainer(el);

    // Without the forgetting, a later revert would paste stale markup back over
    // whatever the page has rendered since.
    expect(takeContainer(el)).toBeUndefined();
  });
});
