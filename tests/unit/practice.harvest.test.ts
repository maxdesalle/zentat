// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { harvestSeenPrices, labelFor } from '../../src/entrypoints/content/harvest';
import { rememberSpan, SPAN_CLASS } from '../../src/entrypoints/content/markers';

// Spec: tests/trees/practice.harvest.tree

const CURRENCIES = ['USD', 'EUR'];

function converted(html: string): Element {
  document.body.innerHTML = html;
  for (const span of document.querySelectorAll(`.${SPAN_CLASS}`)) {
    const original = span.getAttribute('data-original');
    if (original !== null) rememberSpan(span, original);
  }
  return document.body;
}

const harvest = (root: Element) => harvestSeenPrices(root, CURRENCIES, 'shop.example', 'en');

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('labelFor', () => {
  describe('given a name beside the price', () => {
    it('reads the nearest one', () => {
      const root = converted(
        `<div><h2>Running shoes</h2><span class="${SPAN_CLASS}" data-original="$130">0.17 ZEC</span></div>`,
      );
      expect(labelFor(root.querySelector(`.${SPAN_CLASS}`)!)).toBe('Running shoes');
    });

    it('reads it from an image when that is where it is written', () => {
      const root = converted(
        `<div><img alt="Blue mug"><span class="${SPAN_CLASS}" data-original="$12">0.01 ZEC</span></div>`,
      );
      expect(labelFor(root.querySelector(`.${SPAN_CLASS}`)!)).toBe('Blue mug');
    });

    it('collapses the whitespace a page wrapped it in', () => {
      const root = converted(
        `<div><h2>\n  Running\n  shoes\n</h2><span class="${SPAN_CLASS}" data-original="$130">x</span></div>`,
      );
      expect(labelFor(root.querySelector(`.${SPAN_CLASS}`)!)).toBe('Running shoes');
    });
  });

  describe('given the only name is far above the price', () => {
    it('gives up rather than reading the page itself', () => {
      // An unbounded climb always finds something, and on a page with no
      // product name what it finds is the page's own heading — a record of
      // what the user was reading, which is the one thing this must not keep.
      const root = converted(
        `<h1>Everything I bought this year</h1>`
          + `<div><div><div><div><div><div>`
          + `<span class="${SPAN_CLASS}" data-original="$130">x</span>`
          + `</div></div></div></div></div></div>`,
      );
      expect(labelFor(root.querySelector(`.${SPAN_CLASS}`)!)).toBe('');
    });
  });

  describe('given no name anywhere', () => {
    it('reports none', () => {
      const root = converted(
        `<div><span class="${SPAN_CLASS}" data-original="$130">x</span></div>`,
      );
      expect(labelFor(root.querySelector(`.${SPAN_CLASS}`)!)).toBe('');
    });
  });
});

describe('harvestSeenPrices', () => {
  describe('given a named price', () => {
    it('keeps the label, the amount and the currency', () => {
      const root = converted(
        `<div><h2>Running shoes</h2><span class="${SPAN_CLASS}" data-original="$130">x</span></div>`,
      );
      expect(harvest(root)).toEqual([{ label: 'Running shoes', amount: 130, currency: 'USD' }]);
    });

    it('keeps nothing else about it', () => {
      // The whole guarantee: no site, no address, no time. Asserted on the
      // shape rather than trusted, because a field added later would otherwise
      // arrive silently.
      const root = converted(
        `<div><h2>Running shoes</h2><span class="${SPAN_CLASS}" data-original="$130">x</span></div>`,
      );
      expect(Object.keys(harvest(root)[0]).sort()).toEqual(['amount', 'currency', 'label']);
    });
  });

  describe('given a price with no name beside it', () => {
    it('drops it', () => {
      // A store of unlabelled amounts teaches nothing and is kept for no
      // benefit at all.
      const root = converted(
        `<div><span class="${SPAN_CLASS}" data-original="$130">x</span></div>`,
      );
      expect(harvest(root)).toEqual([]);
    });
  });

  describe('given a span we never recorded an original for', () => {
    it('drops it rather than reading back our own output', () => {
      document.body.innerHTML =
        `<div><h2>Running shoes</h2><span class="${SPAN_CLASS}">0.17 ZEC</span></div>`;
      expect(harvest(document.body)).toEqual([]);
    });
  });

  describe('given an original that is not a price', () => {
    it('drops it', () => {
      const root = converted(
        `<div><h2>Running shoes</h2><span class="${SPAN_CLASS}" data-original="sold out">x</span></div>`,
      );
      expect(harvest(root)).toEqual([]);
    });
  });

  describe('given a page with nothing converted', () => {
    it('finds nothing', () => {
      const root = converted('<div><h2>Running shoes</h2></div>');
      expect(harvest(root)).toEqual([]);
    });
  });
});
