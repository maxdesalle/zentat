// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  digitProjection,
  documentCurrency,
  locatePrices,
  projectionsFor,
  readStructuredPrices,
  toAmount,
} from '../../src/lib/detection/structured';

// Spec: tests/trees/structured.tree

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

const jsonLd = (data: unknown) => rawJsonLd(JSON.stringify(data));

/** A price buried `depth` levels down, the way a real @graph nests it. */
function nest(depth: number, leaf: unknown): unknown {
  let node = leaf;
  for (let i = 0; i < depth; i++) node = { isPartOf: node };
  return node;
}

function rawJsonLd(text: string) {
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = text;
  document.head.appendChild(script);
}

describe('toAmount', () => {
  describe('given a finite number', () => {
    it('is taken as is', () => {
      expect(toAmount(49.99)).toBe(49.99);
    });
  });

  describe('given a number that is not finite', () => {
    it('is rejected', () => {
      // JSON cannot carry these, but structured data also arrives from
      // microdata attributes and from callers doing their own arithmetic.
      expect(toAmount(Number.POSITIVE_INFINITY)).toBeNull();
      expect(toAmount(Number.NaN)).toBeNull();
    });
  });

  describe('given a machine-normalised string', () => {
    it('parses it', () => {
      expect(toAmount('49.99')).toBe(49.99);
    });

    it('strips grouping separators', () => {
      // Structured price is meant to be dot-decimal and ungrouped, but plenty
      // of themes emit "1,299.00" anyway.
      expect(toAmount('1,299.00')).toBe(1299);
    });
  });

  describe('given a string that is not a number', () => {
    it('is rejected', () => {
      expect(toAmount('call us')).toBeNull();
    });
  });

  describe('given anything else', () => {
    it('is rejected', () => {
      expect(toAmount({ amount: 5 })).toBeNull();
      expect(toAmount(null)).toBeNull();
    });
  });
});

describe('readStructuredPrices', () => {
  describe('given JSON-LD', () => {
    it('reads a Product/Offer block', () => {
      jsonLd({
        '@type': 'Product',
        offers: { '@type': 'Offer', price: '49.99', priceCurrency: 'USD' },
      });
      expect(readStructuredPrices()).toEqual([
        { amount: 49.99, currency: 'USD', source: 'jsonld' },
      ]);
    });

    it('walks @graph and arrays', () => {
      jsonLd({
        '@graph': [
          { '@type': 'WebPage' },
          { '@type': 'Product', offers: [{ price: 10, priceCurrency: 'EUR' }] },
        ],
      });
      expect(readStructuredPrices()[0]).toMatchObject({ amount: 10, currency: 'EUR' });
    });

    it('reads both ends of an AggregateOffer', () => {
      jsonLd({
        offers: { '@type': 'AggregateOffer', lowPrice: 5, highPrice: 20, priceCurrency: 'GBP' },
      });
      expect(readStructuredPrices().map((p) => p.amount).sort((a, b) => a - b)).toEqual([5, 20]);
    });

    describe('given a block is malformed', () => {
      it('survives without losing the good ones', () => {
        // Broken ld+json is common in the wild, and one bad block on the page
        // is not a reason to stop reading the others.
        rawJsonLd('{ not json');
        jsonLd({ offers: { price: '7.50', priceCurrency: 'USD' } });
        expect(readStructuredPrices()).toHaveLength(1);
      });
    });

    describe('given a block is larger than the parse cap', () => {
      it('skips that block', () => {
        // Some CMSes emit a whole catalogue. Parsing half a megabyte of JSON
        // on the main thread is a visible freeze for one price. The prices it
        // holds go unread with it, or the cap buys nothing.
        rawJsonLd(`{"priceCurrency":"USD","price":"1.00","padding":"${'x'.repeat(600 * 1024)}"}`);
        jsonLd({ offers: { price: '7.50', priceCurrency: 'USD' } });
        expect(readStructuredPrices()).toEqual([
          { amount: 7.5, currency: 'USD', source: 'jsonld' },
        ]);
      });
    });

    describe('given a block is exactly the size of the parse cap', () => {
      it('reads that block', () => {
        // The cap is the largest block we will parse, not the first we refuse.
        const head = '{"priceCurrency":"USD","price":"3.25","pad":"';
        const tail = '"}';
        rawJsonLd(head + 'x'.repeat(512 * 1024 - head.length - tail.length) + tail);
        expect(readStructuredPrices()[0]?.amount).toBe(3.25);
      });
    });

    describe('given a block is empty', () => {
      it('skips that block', () => {
        rawJsonLd('');
        expect(readStructuredPrices()).toEqual([]);
      });
    });

    describe('given the price is a number rather than a string', () => {
      it('reads it', () => {
        jsonLd({ offers: { price: 49.99, priceCurrency: 'USD' } });
        expect(readStructuredPrices()[0]?.amount).toBe(49.99);
      });
    });

    describe('given the price is not finite', () => {
      it('ignores the block', () => {
        jsonLd({ offers: { price: 1e400, priceCurrency: 'USD' } });
        expect(readStructuredPrices()).toEqual([]);
      });
    });

    describe('given the price is not a number at all', () => {
      it('ignores the block', () => {
        jsonLd({ offers: { price: { amount: 5 }, priceCurrency: 'USD' } });
        jsonLd({ offers: { price: 'call us', priceCurrency: 'USD' } });
        expect(readStructuredPrices()).toEqual([]);
      });
    });

    describe('given the price is zero', () => {
      it('ignores the block', () => {
        // A zero is "not for sale" far more often than "free", and a 0 ZEC
        // price on screen reads as a bug either way.
        jsonLd({ offers: { price: 0, priceCurrency: 'USD' } });
        expect(readStructuredPrices()).toEqual([]);
      });
    });

    describe('given there is no currency', () => {
      it('ignores the block — an amount alone is not a price', () => {
        jsonLd({ offers: { price: '49.99' } });
        expect(readStructuredPrices()).toEqual([]);
      });
    });

    describe('given one offer states no currency', () => {
      it('still reads the offers that do', () => {
        // A currency-less offer is a gap in one entry, not a reason to drop
        // the priced entries that share the block with it.
        jsonLd({ offers: [{ price: '1.00' }, { price: '2.00', priceCurrency: 'USD' }] });
        expect(readStructuredPrices()).toEqual([
          { amount: 2, currency: 'USD', source: 'jsonld' },
        ]);
      });
    });

    describe('given the currency is not a bare three-letter code', () => {
      it('ignores the block', () => {
        // Anything but an exact ISO code is a guess, and a guessed currency is
        // a wrong price: USDT is not USD, and "$USD" names nothing at all.
        jsonLd({ offers: { price: '49.99', priceCurrency: 'USDT' } });
        jsonLd({ offers: { price: '49.99', priceCurrency: '$USD' } });
        expect(readStructuredPrices()).toEqual([]);
      });
    });

    describe('given a null sits in the tree', () => {
      it('keeps reading past it', () => {
        // Null-valued properties are everywhere in generated JSON-LD, and they
        // sit in front of the price often enough to hide it.
        jsonLd({ brand: null, offers: { price: '7.50', priceCurrency: 'USD' } });
        expect(readStructuredPrices()).toHaveLength(1);
      });
    });

    describe('given the price sits at the deepest level the walker follows', () => {
      it('reads it', () => {
        jsonLd(nest(12, { price: '7.50', priceCurrency: 'USD' }));
        expect(readStructuredPrices()[0]?.amount).toBe(7.5);
      });
    });

    describe('given the price sits deeper than that', () => {
      it('leaves it unread', () => {
        // The walk is bounded because the tree is someone else's: a page can
        // nest as deep as it likes, and this runs on the main thread.
        jsonLd(nest(13, { price: '7.50', priceCurrency: 'USD' }));
        expect(readStructuredPrices()).toEqual([]);
      });
    });
  });

  describe('given microdata', () => {
    it('reads the content attribute', () => {
      // Uniquely valuable: the attribute sits ON the element about to be
      // rewritten, so it answers detection and targeting at once.
      document.body.innerHTML = '<div itemscope>'
        + '<meta itemprop="priceCurrency" content="CAD">'
        + '<span itemprop="price" content="368.00">$368</span></div>';
      expect(readStructuredPrices()).toEqual([
        { amount: 368, currency: 'CAD', source: 'microdata' },
      ]);
    });

    describe('given there is no content attribute', () => {
      it('reads the visible text', () => {
        document.body.innerHTML = '<div itemscope>'
          + '<meta itemprop="priceCurrency" content="CAD">'
          + '<span itemprop="price">368.00</span></div>';
        expect(readStructuredPrices()[0]?.amount).toBe(368);
      });
    });

    describe('given the amount is not readable', () => {
      it('skips the element', () => {
        document.body.innerHTML = '<div itemscope>'
          + '<meta itemprop="priceCurrency" content="CAD">'
          + '<span itemprop="price">Call for pricing</span></div>';
        expect(readStructuredPrices()).toEqual([]);
      });
    });

    describe('given the amount is zero or negative', () => {
      it('skips the element', () => {
        // A zero here means "not for sale" far more often than "free".
        document.body.innerHTML = '<div itemscope>'
          + '<meta itemprop="priceCurrency" content="CAD">'
          + '<span itemprop="price" content="0">Free</span></div>';
        expect(readStructuredPrices()).toEqual([]);
      });
    });

    describe('given the currency is stated as text rather than an attribute', () => {
      it('reads the text', () => {
        document.body.innerHTML = '<div itemscope>'
          + '<span itemprop="priceCurrency">CAD</span>'
          + '<span itemprop="price" content="368.00">$368</span></div>';
        expect(readStructuredPrices()[0]?.currency).toBe('CAD');
      });
    });

    describe('given there is no currency in scope', () => {
      it('skips the element', () => {
        document.body.innerHTML = '<div itemscope>'
          + '<span itemprop="price" content="368.00">$368</span></div>';
        expect(readStructuredPrices()).toEqual([]);
      });
    });

    describe('given the price sits outside any itemscope', () => {
      it('looks for the currency across the whole root', () => {
        document.body.innerHTML = '<meta itemprop="priceCurrency" content="CAD">'
          + '<span itemprop="price" content="368.00">$368</span>';
        expect(readStructuredPrices()[0]).toMatchObject({ amount: 368, currency: 'CAD' });
      });
    });
  });

  describe('given OpenGraph tags', () => {
    it('reads the price', () => {
      document.head.innerHTML = '<meta property="product:price:amount" content="19.99">'
        + '<meta property="product:price:currency" content="JPY">';
      expect(readStructuredPrices()).toEqual([
        { amount: 19.99, currency: 'JPY', source: 'meta' },
      ]);
    });

    describe('given the amount tag is missing', () => {
      it('reads nothing', () => {
        document.head.innerHTML = '<meta property="product:price:currency" content="JPY">';
        expect(readStructuredPrices()).toEqual([]);
      });
    });

    describe('given the currency tag is missing', () => {
      it('reads nothing', () => {
        document.head.innerHTML = '<meta property="product:price:amount" content="19.99">';
        expect(readStructuredPrices()).toEqual([]);
      });
    });
  });
});

describe('documentCurrency', () => {
  describe('given the page agrees on one currency', () => {
    it('reports that currency', () => {
      expect(documentCurrency([
        { amount: 1, currency: 'CAD', source: 'jsonld' },
        { amount: 2, currency: 'CAD', source: 'jsonld' },
      ])).toBe('CAD');
    });
  });

  describe('given the page is multi-currency', () => {
    it('reports nothing', () => {
      expect(documentCurrency([
        { amount: 1, currency: 'CAD', source: 'jsonld' },
        { amount: 2, currency: 'USD', source: 'jsonld' },
      ])).toBeNull();
    });
  });

  describe('given the page states no price at all', () => {
    it('reports nothing', () => {
      expect(documentCurrency([])).toBeNull();
    });
  });
});

describe('digitProjection', () => {
  it('keeps only the digits', () => {
    expect(digitProjection('$49.99')).toBe('4999');
    expect(digitProjection('49,99 $')).toBe('4999');
  });

  describe('given text with no digits', () => {
    it('returns nothing', () => {
      expect(digitProjection('Sold out')).toBe('');
    });
  });
});

describe('projectionsFor', () => {
  it('covers the renderings a price actually takes', () => {
    expect(projectionsFor(49.99)).toContain('4999');
    expect(projectionsFor(49.99)).toContain('50');
    expect(projectionsFor(1000)).toContain('1000');
  });

  describe('given a whole number', () => {
    it('covers the two-decimal rendering as well', () => {
      // "$10" is very often written "$10.00" on the page it came from.
      expect(projectionsFor(10)).toContain('1000');
      expect(projectionsFor(10)).toContain('10');
    });
  });

  describe('given more decimals than a currency shows', () => {
    it('covers the amount exactly as written', () => {
      // Fuel is quoted "$3.499" on the sign and in the markup, so rounding to
      // two places is not enough to find it.
      expect(projectionsFor(3.499)).toContain('3499');
    });
  });

  describe('given an amount that is not a real number', () => {
    it('offers nothing to match', () => {
      // An empty projection is a wildcard: it equals the digits of every
      // element that shows no price, so it must never reach the target set.
      expect(projectionsFor(Number.NaN)).toEqual([]);
    });
  });
});

describe('locatePrices', () => {
  describe('given no structured prices', () => {
    it('returns nothing', () => {
      document.body.innerHTML = '<p>$49.99</p>';
      expect(locatePrices(document.body, [])).toEqual([]);
    });
  });

  describe('given a price split across spans', () => {
    it('finds the element regex reads as 4999', () => {
      document.body.innerHTML =
        '<div class="price"><span>$</span><span>49</span><span>99</span></div>';
      const [located] = locatePrices(document.body, [
        { amount: 49.99, currency: 'USD', source: 'jsonld' },
      ]);
      expect(located.element.className).toBe('price');
      expect(located.price.amount).toBe(49.99);
    });
  });

  describe('given several matching elements', () => {
    it('prefers the smallest', () => {
      document.body.innerHTML = '<section><div id="inner">$49.99</div></section>';
      const [located] = locatePrices(document.body, [
        { amount: 49.99, currency: 'USD', source: 'jsonld' },
      ]);
      expect(located.element.id).toBe('inner');
    });
  });

  describe('given the amount is nowhere on screen', () => {
    it('returns nothing', () => {
      document.body.innerHTML = '<p>nothing here</p>';
      expect(locatePrices(document.body, [
        { amount: 49.99, currency: 'USD', source: 'jsonld' },
      ])).toEqual([]);
    });
  });

  describe('given two prices with the same digits', () => {
    it('does not give them the same element', () => {
      document.body.innerHTML = '<p id="a">$10.00</p>';
      const located = locatePrices(document.body, [
        { amount: 10, currency: 'USD', source: 'jsonld' },
        { amount: 10, currency: 'USD', source: 'jsonld' },
      ]);
      expect(located).toHaveLength(1);
    });
  });

  describe('given an element holds no digits', () => {
    it('is not a candidate', () => {
      document.body.innerHTML = '<p>Sale</p><p id="p">$49.99</p>';
      const [located] = locatePrices(document.body, [
        { amount: 49.99, currency: 'USD', source: 'jsonld' },
      ]);
      expect(located.element.id).toBe('p');
    });
  });

  describe('given an element holds digits that do not match', () => {
    it('is not chosen', () => {
      document.body.innerHTML = '<p>Save 20%</p><p id="p">$49.99</p>';
      const [located] = locatePrices(document.body, [
        { amount: 49.99, currency: 'USD', source: 'jsonld' },
      ]);
      expect(located.element.id).toBe('p');

      // Same, for an amount that also carries a cents reading: the decoy must
      // fail both sets of projections, not just the literal one.
      document.body.innerHTML = '<p>Save 20%</p><p id="q">$159.00</p>';
      const [cents] = locatePrices(document.body, [
        { amount: 15900, currency: 'USD', source: 'jsonld' },
      ]);
      expect(cents.element.id).toBe('q');
    });
  });

  describe('given two elements show the same price', () => {
    it('takes the first', () => {
      // Both are equally good matches; the earlier one is the one the reader
      // meets first, and a stable choice is what keeps a re-run idempotent.
      document.body.innerHTML = '<p id="a">$49.99</p><p id="b">$49.99</p>';
      const [located] = locatePrices(document.body, [
        { amount: 49.99, currency: 'USD', source: 'jsonld' },
      ]);
      expect(located.element.id).toBe('a');
    });
  });

  describe('given a Shopify cents-integer', () => {
    describe('given the screen shows two decimals', () => {
      it('reads the value as cents', () => {
        // "price":"15900" for an item rendered as $159.00. Trusting it blindly
        // is a 100x error in the other direction. The two readings project to
        // the same digits, so the visible decimal point is what settles it.
        document.body.innerHTML = '<p id="p">$159.00</p>';
        const [located] = locatePrices(document.body, [
          { amount: 15900, currency: 'USD', source: 'jsonld' },
        ]);
        expect(located.price.amount).toBe(159);
        expect(located.element.id).toBe('p');
      });
    });

    describe('given the screen shows the integer itself', () => {
      it('keeps the integer', () => {
        // A genuine $15,900 item. Same digits, no decimal point.
        document.body.innerHTML = '<p id="p">$15,900</p>';
        const [located] = locatePrices(document.body, [
          { amount: 15900, currency: 'USD', source: 'jsonld' },
        ]);
        expect(located.price.amount).toBe(15900);
      });
    });

    describe('given the price is rendered in pieces', () => {
      it('reads the whole element rather than a fragment of it', () => {
        // The "159" span alone reads as $159 with no cents in sight, which
        // would hand back the raw 15900. Only the parent shows the decimal
        // point that proves the integer was cents.
        document.body.innerHTML =
          '<div id="p"><span>$</span><span>159</span><span>.00</span></div>';
        const [located] = locatePrices(document.body, [
          { amount: 15900, currency: 'USD', source: 'jsonld' },
        ]);
        expect(located.element.id).toBe('p');
        expect(located.price.amount).toBe(159);
      });
    });

    describe('given the integer is exactly four digits', () => {
      it('reads it as cents', () => {
        // The shortest integer the cents reading applies to at all.
        document.body.innerHTML = '<p id="p">$10.00</p>';
        const [located] = locatePrices(document.body, [
          { amount: 1000, currency: 'USD', source: 'jsonld' },
        ]);
        expect(located.price.amount).toBe(10);
      });
    });

    describe('given the integer is shorter than four digits', () => {
      it('keeps it as written', () => {
        // "$250.00" shows its cents too, but 250 is a plain whole-dollar
        // price. Dividing it would be the same 100x error in reverse.
        document.body.innerHTML = '<p id="p">$250.00</p>';
        const [located] = locatePrices(document.body, [
          { amount: 250, currency: 'USD', source: 'jsonld' },
        ]);
        expect(located.price.amount).toBe(250);
      });
    });

    describe('given the amount is not a whole number', () => {
      it('keeps it as written', () => {
        // A price with cents of its own was never a cents-integer, however
        // large it is and however the page renders it.
        document.body.innerHTML = '<p id="p">$1,234.56</p>';
        const [located] = locatePrices(document.body, [
          { amount: 1234.56, currency: 'USD', source: 'jsonld' },
        ]);
        expect(located.price.amount).toBe(1234.56);
      });
    });
  });
});

describe('the oracle beats regex where regex is weakest', () => {
  it('fixes the currency for the whole page', () => {
    // A geo-priced .com serving CAD: "$" by TLD would read USD, ~37% out.
    jsonLd({ offers: { price: '368.00', priceCurrency: 'CAD' } });
    expect(documentCurrency(readStructuredPrices())).toBe('CAD');
  });

  it('reads a price regex would get 100x wrong', () => {
    jsonLd({ offers: { price: '49.99', priceCurrency: 'USD' } });
    document.body.innerHTML = '<div class="p"><span>$</span><span>49</span><span>99</span></div>';
    const [located] = locatePrices(document.body, readStructuredPrices());
    // Regex sees "$4999"; the oracle says 49.99 and the projection finds where.
    expect(located.price.amount).toBe(49.99);
  });
});
