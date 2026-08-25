import { describe, expect, it } from 'vitest';
import {
  type Anchor,
  compareToAnchors,
  createAnchor,
  driftedAnchors,
  formatComparisons,
} from '../../src/lib/anchors';
import type { RatesData } from '../../src/lib/storage/rates';

// ZEC ≈ $800.
const rates: RatesData = {
  rates: { USD: 0.00125, EUR: 0.0013 },
  updatedAt: Date.now(),
  source: 'test',
};

const anchor = (label: string, amount: number, currency = 'USD'): Anchor =>
  createAnchor(label, amount, currency, rates)!;

const coffee = anchor('coffees', 5);
const rent = anchor('rent', 1800);

describe('ratios survive what levels do not', () => {
  it('expresses a price in things the user knows', () => {
    // $700 laptop = 0.875 ZEC; a $5 coffee = 0.00625 ZEC; 140 coffees.
    const [best] = compareToAnchors(0.875, [coffee], rates);
    expect(best.anchor.label).toBe('coffees');
    expect(best.count).toBeCloseTo(140, 6);
  });

  it('is invariant to the ZEC price — the whole point', () => {
    const crashed: RatesData = { ...rates, rates: { USD: 0.0025 } }; // ZEC halved
    const before = compareToAnchors(0.875, [coffee], rates)[0].count;
    const after = compareToAnchors(0.875 * 2, [coffee], crashed)[0].count;
    expect(after).toBeCloseTo(before, 6);
  });

  it('prefers the anchor closest to a countable multiple', () => {
    // A $2,000 purchase is ~1.1 rents and ~400 coffees; rent reads better.
    const [best] = compareToAnchors(2.5, [coffee, rent], rates);
    expect(best.anchor.label).toBe('rent');
  });

  it('drops comparisons nobody can picture', () => {
    expect(compareToAnchors(0.000001, [rent], rates)).toEqual([]);
    expect(compareToAnchors(100_000, [coffee], rates)).toEqual([]);
  });

  it('works across currencies, because both legs go through ZEC', () => {
    const euroLunch = anchor('lunches', 12, 'EUR');
    expect(compareToAnchors(0.156, [euroLunch], rates)[0].count).toBeCloseTo(10, 6);
  });

  it('reads as a sentence', () => {
    // Ordered by how countable the multiple is, not by list order.
    expect(formatComparisons(compareToAnchors(0.875, [coffee, rent], rates)))
      .toBe('≈ 0.39 rent · 140 coffees');
  });

  it('ignores an anchor in a currency with no rate', () => {
    const yen = { ...anchor('bentos', 900), currency: 'JPY' };
    expect(compareToAnchors(0.875, [yen], rates)).toEqual([]);
  });
});

describe('drift turns volatility into a scheduled re-look', () => {
  it('flags an anchor once it moves past the threshold', () => {
    const moved: RatesData = { ...rates, rates: { USD: 0.00125 * 1.5 } };
    const [drift] = driftedAnchors([coffee], moved);
    expect(drift.anchor.label).toBe('coffees');
    expect(drift.change).toBeCloseTo(0.5, 6);
  });

  it('stays quiet inside the threshold', () => {
    const nudged: RatesData = { ...rates, rates: { USD: 0.00125 * 1.05 } };
    expect(driftedAnchors([coffee], nudged)).toEqual([]);
  });

  it('reports the biggest mover first', () => {
    const moved: RatesData = { ...rates, rates: { USD: 0.00125 * 1.5, EUR: 0.0013 * 1.9 } };
    const euro = anchor('dinners', 40, 'EUR');
    expect(driftedAnchors([coffee, euro], moved)[0].anchor.label).toBe('dinners');
  });
});

describe('createAnchor', () => {
  it('refuses input it cannot price', () => {
    expect(createAnchor('', 5, 'USD', rates)).toBeNull();
    expect(createAnchor('x', 0, 'USD', rates)).toBeNull();
    expect(createAnchor('x', 5, 'XXX', rates)).toBeNull();
  });

  it('records the ZEC cost at the moment it was set', () => {
    expect(anchor('coffees', 5).zecWhenSet).toBeCloseTo(0.00625, 10);
  });
});
