// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
// Spec: tests/trees/adapters.tree
import {
  adapterFor,
  hostMatches,
  isExcluded,
  isWholeReplacement,
  SITE_ADAPTERS,
} from '../../src/lib/detection/adapters';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('host matching is suffix-safe', () => {
  it('matches the host and its subdomains', () => {
    expect(hostMatches('bol.com', ['bol.com'])).toBe(true);
    expect(hostMatches('www.bol.com', ['bol.com'])).toBe(true);
  });

  it('does not match a host that merely ends in the same letters', () => {
    // Substring matching would have said yes here.
    expect(hostMatches('notbol.com', ['bol.com'])).toBe(false);
    expect(hostMatches('bol.com.evil.test', ['bol.com'])).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(hostMatches('WWW.BOL.COM', ['bol.com'])).toBe(true);
  });
});

describe('the registry', () => {
  it('finds an adapter for each site it claims', () => {
    for (const adapter of SITE_ADAPTERS) {
      for (const host of adapter.hosts) {
        expect(adapterFor(host)?.id).toBe(adapter.id);
        expect(adapterFor(`www.${host}`)?.id).toBe(adapter.id);
      }
    }
  });

  it('returns null for everything else, so the generic path runs', () => {
    expect(adapterFor('example.com')).toBeNull();
    expect(adapterFor('')).toBeNull();
  });

  it('claims no host twice', () => {
    const seen = new Set<string>();
    for (const adapter of SITE_ADAPTERS) {
      for (const host of adapter.hosts) {
        expect(seen.has(host)).toBe(false);
        seen.add(host);
      }
    }
  });

  it('declares a currency wherever it reads bare numbers', () => {
    // A bare "149,00" is only safe to read as a price if the site's currency
    // is known; without that it is a date, a measurement, or a spec number.
    for (const adapter of SITE_ADAPTERS) {
      if (adapter.id === 'bol' || adapter.id.startsWith('coolblue')) {
        expect(adapter.assume?.currency).toBeTruthy();
      }
    }
  });
});

describe('whole-element replacement', () => {
  it('recognises an element the adapter treats as a whole price', () => {
    document.body.innerHTML =
      '<span class="a-price"><span class="a-offscreen">$19.99</span></span>';
    const amazon = adapterFor('www.amazon.com');
    expect(isWholeReplacement(amazon, document.querySelector('.a-price')!)).toBe(true);
  });

  it('leaves ordinary elements alone', () => {
    document.body.innerHTML = '<p>$19.99</p>';
    expect(isWholeReplacement(adapterFor('www.amazon.com'), document.querySelector('p')!))
      .toBe(false);
  });
});

describe('exclusions', () => {
  it('keeps checkout controls fiat', () => {
    document.body.innerHTML =
      '<span id="buy-now-button"><span class="a-price">$19.99</span></span>';
    const amazon = adapterFor('www.amazon.com');
    expect(isExcluded(amazon, document.querySelector('.a-price')!)).toBe(true);
  });

  it('does not exclude a price outside those controls', () => {
    document.body.innerHTML = '<div><span class="a-price">$19.99</span></div>';
    expect(isExcluded(adapterFor('www.amazon.com'), document.querySelector('.a-price')!))
      .toBe(false);
  });
});

describe('extraction', () => {
  it("reads Amazon's canonical price rather than the split rendering", () => {
    document.body.innerHTML = '<span class="a-price">'
      + '<span class="a-offscreen">$1,299.00</span>'
      + '<span aria-hidden="true"><span>$</span><span>1,299</span><span>00</span></span>'
      + '</span>';
    const amazon = adapterFor('www.amazon.com')!;
    expect(amazon.extract!(document.querySelector('.a-price')!, { hostname: 'amazon.com' }))
      .toBe('$1,299.00');
  });

  it("reads bol.com's accessible copy", () => {
    document.body.innerHTML = '<div class="font-produkt">'
      + '<span aria-hidden="true">149</span>'
      + '<span style="position: absolute">149 euro en 00 cent</span></div>';
    const bol = adapterFor('www.bol.com')!;
    expect(bol.extract!(document.querySelector('.font-produkt')!, { hostname: 'bol.com' }))
      .toBe('149 euro en 00 cent');
  });

  describe('given the accessible copy is absent', () => {
    it('returns null so the caller falls back to the visible text', () => {
      document.body.innerHTML = '<span class="a-price">$19.99</span>';
      const amazon = adapterFor('www.amazon.com')!;
      expect(amazon.extract!(document.querySelector('.a-price')!, { hostname: 'amazon.com' }))
        .toBeNull();
    });

    it('returns null for a bol container with no positioned span', () => {
      // Bol renders some tiles without the accessible sentence at all. Falling
      // back to the visible fragments is wrong there, but crashing is worse.
      document.body.innerHTML = '<div class="font-produkt"><span>149</span></div>';
      const bol = adapterFor('www.bol.com')!;
      expect(bol.extract!(document.querySelector('.font-produkt')!, { hostname: 'bol.com' }))
        .toBeNull();
    });
  });
});
