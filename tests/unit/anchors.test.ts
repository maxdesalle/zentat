import { describe, expect, it } from 'vitest';
import {
  type Anchor,
  anchorZecValue,
  compareToAnchors,
  createAnchor,
  driftedAnchors,
  formatComparisons,
  formatCount,
} from '../../src/lib/anchors';
import type { RatesData } from '../../src/lib/storage/rates';

// Spec: tests/trees/anchors.tree

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

describe('anchorZecValue', () => {
  describe("given the anchor's currency has a rate", () => {
    it('prices the anchor in ZEC', () => {
      expect(anchorZecValue(coffee, rates)).toBeCloseTo(0.00625, 10);
    });
  });

  describe('given the currency has no rate', () => {
    it('cannot price it', () => {
      expect(anchorZecValue({ ...coffee, currency: 'JPY' }, rates)).toBeNull();
    });
  });

  describe('given the amount is not positive', () => {
    it('cannot price it', () => {
      expect(anchorZecValue({ ...coffee, amount: 0 }, rates)).toBeNull();
      expect(anchorZecValue({ ...coffee, amount: Number.NaN }, rates)).toBeNull();
    });
  });

  describe('given a stored amount and rate that are both negative', () => {
    it('cannot price it', () => {
      // Two sign errors multiply into a plausible-looking positive price, which
      // is exactly the shape of wrong price the user cannot spot.
      expect(anchorZecValue({ ...coffee, amount: -5 }, { ...rates, rates: { USD: -0.00125 } }))
        .toBeNull();
    });
  });

  describe('given the rate is zero', () => {
    it('cannot price it', () => {
      // A free anchor divides into every price on the page as "Infinity coffees".
      expect(anchorZecValue(coffee, { ...rates, rates: { USD: 0 } })).toBeNull();
    });
  });

  describe('given the arithmetic does not produce a usable number', () => {
    it('cannot price it', () => {
      // An anchor stored from a corrupted record, or a rate that overflowed.
      // A price of Infinity coffees is worse than no comparison at all.
      expect(anchorZecValue({ ...coffee, amount: 1e308 }, {
        ...rates,
        rates: { USD: 1e308 },
      })).toBeNull();
    });
  });
});

describe('compareToAnchors', () => {
  it('expresses a price in things the user knows', () => {
    // $700 laptop = 0.875 ZEC; a $5 coffee = 0.00625 ZEC; 140 coffees.
    const [best] = compareToAnchors(0.875, [coffee], rates);
    expect(best.anchor.label).toBe('coffees');
    expect(best.count).toBeCloseTo(140, 6);
  });

  it('is invariant to the ZEC price — the whole point', () => {
    // Every price on a page converts at the same rate, so ratios between them
    // survive any move. A memorised level does not.
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

  it('works across currencies, because both legs go through ZEC', () => {
    const euroLunch = anchor('lunches', 12, 'EUR');
    expect(compareToAnchors(0.156, [euroLunch], rates)[0].count).toBeCloseTo(10, 6);
  });

  describe('given a comparison nobody can picture', () => {
    it('drops one that is too small', () => {
      // "0.003 rents" fails at the one job the feature has.
      expect(compareToAnchors(0.000001, [rent], rates)).toEqual([]);
    });

    it('drops one that is too large', () => {
      expect(compareToAnchors(100_000, [coffee], rates)).toEqual([]);
    });
  });

  describe('given a comparison sitting exactly on the edge of the useful range', () => {
    // One anchor priced at exactly 0.5 ZEC, so the counts below are exact.
    const edgeRates: RatesData = { ...rates, rates: { USD: 0.5 } };
    const unit = createAnchor('units', 1, 'USD', edgeRates)!;

    it('keeps the smallest countable multiple', () => {
      expect(compareToAnchors(0.1, [unit], edgeRates)[0].count).toBe(0.2);
    });

    it('keeps the largest countable multiple', () => {
      expect(compareToAnchors(2500, [unit], edgeRates)[0].count).toBe(5000);
    });
  });

  describe('given an anchor in a currency with no rate', () => {
    it('ignores that anchor', () => {
      const yen = { ...anchor('bentos', 900), currency: 'JPY' };
      expect(compareToAnchors(0.875, [yen], rates)).toEqual([]);
    });
  });

  describe('given the amount is not positive', () => {
    it('returns nothing', () => {
      expect(compareToAnchors(0, [coffee], rates)).toEqual([]);
      expect(compareToAnchors(Number.NaN, [coffee], rates)).toEqual([]);
    });
  });

  describe('when a limit is given', () => {
    it('returns no more than that many', () => {
      const lunch = anchor('lunches', 15);
      expect(compareToAnchors(0.875, [coffee, rent, lunch], rates, 1)).toHaveLength(1);
      expect(compareToAnchors(0.875, [coffee, rent, lunch], rates)).toHaveLength(2);
    });
  });
});

describe('formatCount', () => {
  describe('given a count in the hundreds', () => {
    it('rounds to a whole number', () => {
      // "139.87 coffees" is not a number anyone repeats out loud.
      expect(formatCount(139.87, 'en-US')).toBe('140');
    });
  });

  describe('given a count in the tens', () => {
    it('rounds to a whole number', () => {
      expect(formatCount(13.87, 'en-US')).toBe('14');
    });
  });

  describe('given a count around one', () => {
    it('keeps one decimal', () => {
      expect(formatCount(1.37, 'en-US')).toBe('1.4');
    });
  });

  describe('given a count below one', () => {
    it('keeps two decimals', () => {
      expect(formatCount(0.386, 'en-US')).toBe('0.39');
    });
  });

  describe('when a locale is given', () => {
    it('formats in that locale', () => {
      expect(formatCount(0.39, 'de-DE')).toBe('0,39');
    });
  });
});

describe('formatComparisons', () => {
  it('reads as a sentence', () => {
    // Ordered by how countable the multiple is, not by list order.
    expect(formatComparisons(compareToAnchors(0.875, [coffee, rent], rates), 'en-US'))
      .toBe('≈ 0.39 rent · 140 coffees');
  });

  describe('given there is nothing to compare', () => {
    it('says nothing', () => {
      expect(formatComparisons([])).toBe('');
    });
  });
});

describe('driftedAnchors', () => {
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

  describe('given an anchor sitting exactly on the threshold', () => {
    it('flags it', () => {
      // Set at 5 ZEC, now 6: a re-look is due at the threshold, not past it.
      const onTheLine = { ...coffee, amount: 1, zecWhenSet: 5 };
      const moved: RatesData = { ...rates, rates: { USD: 6 } };
      expect(driftedAnchors([onTheLine], moved)[0].change).toBe(0.2);
    });
  });

  describe('given the anchor can no longer be priced', () => {
    it('is skipped', () => {
      expect(driftedAnchors([{ ...coffee, currency: 'JPY' }], rates)).toEqual([]);
    });
  });

  describe('given the anchor was never priced', () => {
    it('is skipped', () => {
      // Dividing by a zero baseline would report an infinite drift on an
      // anchor that has not actually moved at all.
      expect(driftedAnchors([{ ...coffee, zecWhenSet: 0 }], rates)).toEqual([]);
    });
  });
});

describe('createAnchor', () => {
  it('records the ZEC cost at the moment it was set', () => {
    expect(anchor('coffees', 5).zecWhenSet).toBeCloseTo(0.00625, 10);
  });

  it('gives each anchor its own id', () => {
    expect(anchor('coffees', 5).id).not.toBe(anchor('coffees', 5).id);
  });

  it('gives the id a compact, opaque shape', () => {
    // The id is persisted in settings and is the key used to remove an anchor,
    // so it stays a short token rather than the digits of a raw float.
    expect(anchor('coffees', 5).id).toMatch(/^[0-9a-z]+-[0-9a-z]{6}$/);
  });

  it('upper-cases the currency', () => {
    expect(createAnchor('coffees', 5, 'usd', rates)?.currency).toBe('USD');
  });

  describe('given a label longer than the field allows', () => {
    it('truncates the label', () => {
      expect(createAnchor('a'.repeat(50), 5, 'USD', rates)?.label).toHaveLength(24);
    });
  });

  describe('given input it cannot price', () => {
    it('refuses an empty label', () => {
      expect(createAnchor('   ', 5, 'USD', rates)).toBeNull();
    });

    it('refuses a non-positive amount', () => {
      expect(createAnchor('x', 0, 'USD', rates)).toBeNull();
    });

    it('refuses a currency with no rate', () => {
      expect(createAnchor('x', 5, 'XXX', rates)).toBeNull();
    });
  });
});
