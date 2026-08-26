// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { detectPrices } from '../../src/entrypoints/content/detector';
import { SPAN_CLASS } from '../../src/entrypoints/content/markers';

// Spec: tests/trees/detector.tree

function render(html: string, lang?: string) {
  document.documentElement.lang = lang ?? '';
  document.head.innerHTML = '';
  document.body.innerHTML = html;
  return document.body;
}

function jsonLd(data: unknown) {
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.documentElement.lang = '';
});

describe('detectPrices', () => {
  describe('given the page states a price in structured data', () => {
    it('reports the structured amount', () => {
      // Regex reads the split spans as "$4999". The oracle says 49.99 and the
      // digit projection says where.
      render('<div class="p"><span>$</span><span>49</span><span>99</span></div>');
      jsonLd({ offers: { price: '49.99', priceCurrency: 'USD' } });
      const [found] = detectPrices(document.body, ['USD'], 'shop.example.com');
      expect(found.prices[0].amount).toBe(49.99);
      expect(found.prices[0].currency).toBe('USD');
    });

    it('does not let regex second-guess that element', () => {
      render('<div class="p"><span>$</span><span>49</span><span>99</span></div>');
      jsonLd({ offers: { price: '49.99', priceCurrency: 'USD' } });
      const results = detectPrices(document.body, ['USD'], 'shop.example.com');
      expect(results.filter((r) => r.prices[0].amount === 4999)).toHaveLength(0);
    });

    it('does not let regex second-guess anything inside it', () => {
      // A structured claim describes the whole element. Its children are the
      // split rendering of that one price, not extra prices to add up.
      render('<div class="p"><span>$49</span><span>.99</span></div>');
      jsonLd({ offers: { price: '49.99', priceCurrency: 'USD' } });
      const results = detectPrices(document.body, ['USD'], 'shop.example.com');
      expect(results).toHaveLength(1);
    });
  });

  describe('given the structured currency is not enabled', () => {
    it('ignores that structured price', () => {
      render('<div class="p">¥4999</div>');
      jsonLd({ offers: { price: '4999', priceCurrency: 'JPY' } });
      expect(detectPrices(document.body, ['USD'], 'shop.example.com')).toEqual([]);
    });
  });

  describe('given no structured data', () => {
    it('falls back to reading the rendered text', () => {
      render('<p>$19.99</p>');
      const [found] = detectPrices(document.body, ['USD'], 'shop.example.com');
      expect(found.prices[0].amount).toBe(19.99);
    });
  });

  describe('given the page declares a currency', () => {
    it('uses that rather than guessing from the hostname', () => {
      // A geo-priced .com is CAD about as often as USD. The page's own word
      // beats the TLD every time.
      render('<p>Also available: $19.99</p>');
      jsonLd({ offers: { price: '99.00', priceCurrency: 'CAD' } });
      const found = detectPrices(document.body, ['USD', 'CAD'], 'shop.example.com')
        .find((r) => r.prices[0].amount === 19.99)!;
      expect(found.prices[0].currency).toBe('CAD');
    });
  });

  describe('given the page declares a language', () => {
    it("reads numbers under that language's rules", () => {
      render('<p>$3.499</p>', 'de-DE');
      const [found] = detectPrices(document.body, ['USD'], 'shop.example.com');
      expect(found.prices[0].amount).toBe(3499);
    });
  });

  describe('given a site adapter identified the element as a price container', () => {
    it('lets bare-number patterns run there', () => {
      // "1.349" is only a price because Coolblue's adapter vouched for the
      // element. Anywhere else it is a version number.
      Object.defineProperty(window, 'location', {
        value: { ...window.location, hostname: 'www.coolblue.nl' },
        writable: true,
        configurable: true,
      });
      render('<div data-testid="price">1.349</div>');
      const [found] = detectPrices(document.body, ['EUR'], 'www.coolblue.nl');
      expect(found.prices[0].amount).toBe(1349);
      Object.defineProperty(window, 'location', {
        value: { ...window.location, hostname: 'example.com' },
        writable: true,
        configurable: true,
      });
    });
  });

  describe('given a parent whose direct text holds its own price', () => {
    it('carries that through', () => {
      render('<p>$10 <span>$8</span></p>');
      const parent = detectPrices(document.body, ['USD'], 'shop.example.com')
        .find((r) => r.node.tagName === 'P')!;
      expect(parent.directTextOnly).toBe(true);
      expect(parent.prices[0].amount).toBe(10);
    });
  });

  describe('given a leaf element the structured claim disagrees with', () => {
    it('reads what the element shows instead', () => {
      // "$1.00" and a claim of 100 are the same three digits. An element with
      // no children holds exactly what the site wrote, so there is no split
      // price for the claim to reassemble — and the number on screen is the
      // one the user is about to spend.
      render('<p>$1.00</p>');
      jsonLd({ offers: { price: '100', priceCurrency: 'USD' } });
      const [found] = detectPrices(document.body, ['USD'], 'shop.example.com');
      expect(found.prices[0].amount).toBe(1);
    });
  });

  describe('given a leaf element whose text is not a price at all', () => {
    it('leaves it alone', () => {
      // "1x" carries the digits of a claim of 1. It is not a price, and no
      // claim about the page makes it one.
      render('<p>1x</p>');
      jsonLd({ offers: { price: '1', priceCurrency: 'USD' } });
      expect(detectPrices(document.body, ['USD'], 'shop.example.com')).toEqual([]);
    });
  });

  describe('given the claim lands on our own output', () => {
    it('does not read the span back as a price', () => {
      render(`<p><span class="${SPAN_CLASS}">0.01</span></p>`);
      jsonLd({ offers: { price: '0.01', priceCurrency: 'USD' } });
      expect(detectPrices(document.body, ['USD'], 'shop.example.com')).toEqual([]);
    });

    it('does not read an element holding one back either', () => {
      // The second pass over a page we already converted. Nothing stood
      // between a claim and our own text, and the conversion compounded.
      render(`<p>0.01<span class="${SPAN_CLASS}"> ZEC</span></p>`);
      jsonLd({ offers: { price: '0.01', priceCurrency: 'USD' } });
      expect(detectPrices(document.body, ['USD'], 'shop.example.com')).toEqual([]);
    });
  });

  describe('given a page with no prices', () => {
    it('reports nothing', () => {
      render('<p>Just some words.</p>');
      expect(detectPrices(document.body, ['USD'], 'shop.example.com')).toEqual([]);
    });
  });
});
