// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  documentCurrency,
  locatePrices,
  projectionsFor,
  readStructuredPrices,
} from '../../src/lib/detection/structured';

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

const jsonLd = (data: unknown) => {
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
};

describe('reading what the page already states', () => {
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

  it('survives a malformed block without losing the good ones', () => {
    const bad = document.createElement('script');
    bad.type = 'application/ld+json';
    bad.textContent = '{ not json';
    document.head.appendChild(bad);
    jsonLd({ offers: { price: '7.50', priceCurrency: 'USD' } });
    expect(readStructuredPrices()).toHaveLength(1);
  });

  it('reads microdata, which sits on the element being rewritten', () => {
    document.body.innerHTML = '<div itemscope>'
      + '<meta itemprop="priceCurrency" content="CAD">'
      + '<span itemprop="price" content="368.00">$368</span></div>';
    expect(readStructuredPrices()).toEqual([
      { amount: 368, currency: 'CAD', source: 'microdata' },
    ]);
  });

  it('reads OpenGraph price tags', () => {
    document.head.innerHTML = '<meta property="product:price:amount" content="19.99">'
      + '<meta property="product:price:currency" content="JPY">';
    expect(readStructuredPrices()).toEqual([
      { amount: 19.99, currency: 'JPY', source: 'meta' },
    ]);
  });

  it('ignores a block with no currency — an amount alone is not a price', () => {
    jsonLd({ offers: { price: '49.99' } });
    expect(readStructuredPrices()).toEqual([]);
  });
});

describe('the document currency retires the $-means-USD guess', () => {
  it('reports a currency the page agrees on', () => {
    expect(documentCurrency([
      { amount: 1, currency: 'CAD', source: 'jsonld' },
      { amount: 2, currency: 'CAD', source: 'jsonld' },
    ])).toBe('CAD');
  });

  it('reports nothing when the page is multi-currency', () => {
    expect(documentCurrency([
      { amount: 1, currency: 'CAD', source: 'jsonld' },
      { amount: 2, currency: 'USD', source: 'jsonld' },
    ])).toBeNull();
  });
});

describe('locating the price on screen', () => {
  it('finds a price split across spans that regex reads as 4999', () => {
    document.body.innerHTML =
      '<div class="price"><span>$</span><span>49</span><span>99</span></div>';
    const [located] = locatePrices(document.body, [
      { amount: 49.99, currency: 'USD', source: 'jsonld' },
    ]);
    expect(located.element.className).toBe('price');
    expect(located.price.amount).toBe(49.99);
  });

  it('prefers the smallest matching element', () => {
    document.body.innerHTML = '<section><div id="inner">$49.99</div></section>';
    const [located] = locatePrices(document.body, [
      { amount: 49.99, currency: 'USD', source: 'jsonld' },
    ]);
    expect(located.element.id).toBe('inner');
  });

  it('catches the Shopify cents-integer leak', () => {
    // "price":"15900" for an item rendered as $159.00 — trusting it blindly is
    // a 100x error in the other direction.
    document.body.innerHTML = '<p id="p">$159.00</p>';
    const [located] = locatePrices(document.body, [
      { amount: 15900, currency: 'USD', source: 'jsonld' },
    ]);
    expect(located.price.amount).toBe(159);
    expect(located.element.id).toBe('p');
  });

  it('returns nothing when the amount is nowhere on screen', () => {
    document.body.innerHTML = '<p>nothing here</p>';
    expect(locatePrices(document.body, [
      { amount: 49.99, currency: 'USD', source: 'jsonld' },
    ])).toEqual([]);
  });

  it('does not give two prices the same element', () => {
    document.body.innerHTML = '<p id="a">$10.00</p>';
    const located = locatePrices(document.body, [
      { amount: 10, currency: 'USD', source: 'jsonld' },
      { amount: 10, currency: 'USD', source: 'jsonld' },
    ]);
    expect(located).toHaveLength(1);
  });
});

describe('projections', () => {
  it('covers the renderings a price actually takes', () => {
    expect(projectionsFor(49.99)).toContain('4999');
    expect(projectionsFor(49.99)).toContain('50');
    expect(projectionsFor(1000)).toContain('1000');
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
