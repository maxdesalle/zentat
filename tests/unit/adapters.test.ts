// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
// Spec: tests/trees/adapters.tree
import {
  adapterFor,
  hostMatches,
  isExcluded,
  isWholeReplacement,
  SITE_ADAPTERS,
  type SiteAdapter,
} from '../../src/lib/detection/adapters';

beforeEach(() => {
  document.body.innerHTML = '';
});

/** The elements this adapter's container selectors pick out of the page. */
function containersIn(adapter: SiteAdapter | null): Element[] {
  return (adapter?.containers ?? []).flatMap((selector) =>
    Array.from(document.querySelectorAll(selector))
  );
}

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
    // The wrong currency is worse still: it is a plausible price off by the
    // exchange rate, which nothing downstream can catch.
    for (
      const host of ['bol.com', 'coolblue.nl', 'coolblue.be', 'mediamarkt.nl', 'mediamarkt.be']
    ) {
      expect(adapterFor(host)?.assume?.currency).toBe('EUR');
    }
  });
});

describe('the sites it knows', () => {
  it('routes every Amazon marketplace to the Amazon adapter', () => {
    // Amazon runs one domain per country over shared markup, so a marketplace
    // missing from the list is a whole storefront that silently never
    // converts. Spelled out here rather than read back off the adapter, so
    // that losing one fails a test instead of agreeing with itself.
    const marketplaces = [
      'amazon.com',
      'amazon.co.uk',
      'amazon.de',
      'amazon.fr',
      'amazon.it',
      'amazon.es',
      'amazon.nl',
      'amazon.ca',
      'amazon.co.jp',
      'amazon.com.au',
      'amazon.com.br',
      'amazon.com.mx',
      'amazon.in',
    ];
    for (const host of marketplaces) {
      expect(adapterFor(host)?.id).toBe('amazon');
      expect(adapterFor(`www.${host}`)?.id).toBe('amazon');
    }
  });

  it('routes bol.com to the bol adapter', () => {
    expect(adapterFor('www.bol.com')?.id).toBe('bol');
  });

  it('routes both Coolblue storefronts to the Coolblue adapter', () => {
    expect(adapterFor('www.coolblue.nl')?.id).toBe('coolblue');
    expect(adapterFor('www.coolblue.be')?.id).toBe('coolblue');
  });

  it('routes both MediaMarkt storefronts to the MediaMarkt adapter', () => {
    expect(adapterFor('www.mediamarkt.nl')?.id).toBe('mediamarkt');
    expect(adapterFor('www.mediamarkt.be')?.id).toBe('mediamarkt');
  });

  it('routes digitalocean.com to the DigitalOcean adapter', () => {
    expect(adapterFor('www.digitalocean.com')?.id).toBe('digitalocean');
  });
});

describe('the markup each site is scanned for', () => {
  it("finds Amazon's price blocks and replaces them whole", () => {
    document.body.innerHTML =
      '<span class="a-price"><span class="a-offscreen">$19.99</span></span>';
    const amazon = adapterFor('www.amazon.com');
    const price = document.querySelector('.a-price')!;
    expect(containersIn(amazon)).toEqual([price]);
    expect(isWholeReplacement(amazon, price)).toBe(true);
  });

  it("finds bol.com's price blocks and replaces them whole", () => {
    // The text bol yields is the accessible sentence, not what is on screen,
    // so there is nothing in the visible markup a partial splice could match.
    document.body.innerHTML = '<div class="font-produkt">'
      + '<span style="position: absolute">149 euro en 00 cent</span></div>';
    const bol = adapterFor('www.bol.com');
    const price = document.querySelector('.font-produkt')!;
    expect(containersIn(bol)).toEqual([price]);
    expect(isWholeReplacement(bol, price)).toBe(true);
  });

  it('finds both of the price markups Coolblue uses', () => {
    // Coolblue renders listing prices and product prices differently. Pinning
    // one and not the other leaves half the shop in euros.
    document.body.innerHTML =
      '<div data-testid="price">€ 149,-</div><div class="sales-price">€ 199,-</div>';
    const coolblue = adapterFor('www.coolblue.nl');
    const listed = document.querySelector('[data-testid="price"]')!;
    const sales = document.querySelector('.sales-price')!;
    expect(containersIn(coolblue)).toEqual([listed, sales]);
    expect(isWholeReplacement(coolblue, listed)).toBe(true);
    expect(isWholeReplacement(coolblue, sales)).toBe(true);
  });

  it("finds DigitalOcean's pricing tables and replaces them whole", () => {
    document.body.innerHTML = '<div class="pricing">$6/mo</div>';
    const digitalocean = adapterFor('www.digitalocean.com');
    const table = document.querySelector('.pricing')!;
    expect(containersIn(digitalocean)).toEqual([table]);
    expect(isWholeReplacement(digitalocean, table)).toBe(true);
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

  describe('given a site with no adapter', () => {
    it('excludes nothing rather than failing the page', () => {
      // Every site but a handful takes this path, and the converter asks the
      // question before it knows whether an adapter exists.
      document.body.innerHTML = '<button><span>$19.99</span></button>';
      expect(isExcluded(adapterFor('example.com'), document.querySelector('span')!)).toBe(false);
    });
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

  describe('given the markup is pretty-printed', () => {
    it("strips the whitespace around Amazon's price", () => {
      // Amazon ships the offscreen span across several lines. Handed to the
      // parser with the newlines still on it, the price matches nothing and
      // the page keeps its dollars.
      document.body.innerHTML = '<span class="a-price">\n'
        + '  <span class="a-offscreen">\n    $19.99\n  </span>\n</span>';
      const amazon = adapterFor('www.amazon.com')!;
      expect(amazon.extract!(document.querySelector('.a-price')!, { hostname: 'amazon.com' }))
        .toBe('$19.99');
    });

    it("strips the whitespace around bol.com's sentence", () => {
      document.body.innerHTML = '<div class="font-produkt">'
        + '<span style="position: absolute">\n  149 euro en 00 cent\n</span></div>';
      const bol = adapterFor('www.bol.com')!;
      expect(bol.extract!(document.querySelector('.font-produkt')!, { hostname: 'bol.com' }))
        .toBe('149 euro en 00 cent');
    });
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
