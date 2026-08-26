import { describe, expect, it, vi } from 'vitest';

// Spec: tests/trees/convert.tree
//
// convert.ts reaches into storage/rates for per-currency staleness, and that
// module defines storage items at import time. Without this, the definitions
// touch chrome.runtime and reject asynchronously — green tests plus unhandled
// rejections, which vitest exits non-zero on.
vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: () => ({
      getValue: async () => null,
      setValue: async () => {},
      watch: () => () => {},
    }),
  },
}));
import { convertPrice } from '../../src/lib/conversion/convert';
import type { ParsedPrice } from '../../src/lib/detection/parser';
import { MAX_RATE_AGE_MS, type RatesData } from '../../src/lib/storage/rates';

// Rates are stored ZEC-per-fiat so conversion is a multiply. Every assertion
// here pins the arithmetic itself: the suite previously asserted only that
// output contained "ZEC", so inverting the rate or moving a decimal passed.
const rates: RatesData = {
  rates: { USD: 0.00125, EUR: 0.0013, JPY: 0.0000085 },
  updatedAt: Date.now(),
  source: 'test',
};

const price = (amount: number, currency: string): ParsedPrice => ({
  original: `${amount}`,
  amount,
  currency,
  startIndex: 0,
  endIndex: 1,
});

describe('convertPrice', () => {
  describe('given a spot rate', () => {
    it('multiplies by the stored rate', () => {
      expect(convertPrice(price(19.99, 'USD'), rates, 'auto', 'auto')!.zecAmount).toBeCloseTo(
        0.0249875,
        12,
      );
      expect(convertPrice(price(800, 'USD'), rates, 'auto', 'auto')!.zecAmount).toBeCloseTo(1, 12);
      expect(convertPrice(price(1000, 'EUR'), rates, 'auto', 'auto')!.zecAmount).toBeCloseTo(
        1.3,
        12,
      );
    });

    it('is not the reciprocal', () => {
      // The failure mode this whole file exists for: 1/0.00125 = 800.
      const result = convertPrice(price(1, 'USD'), rates, 'auto', 'auto')!;
      expect(result.zecAmount).toBeCloseTo(0.00125, 12);
      expect(result.zecAmount).not.toBeCloseTo(800, 6);
    });

    it('scales linearly across magnitudes', () => {
      const one = convertPrice(price(1, 'USD'), rates, 'auto', 'auto')!.zecAmount;
      for (const factor of [10, 1_000, 1_000_000]) {
        expect(convertPrice(price(factor, 'USD'), rates, 'auto', 'auto')!.zecAmount)
          .toBeCloseTo(one * factor, 9);
      }
    });

    it('handles a currency with a very small rate', () => {
      expect(convertPrice(price(100_000, 'JPY'), rates, 'auto', 'auto')!.zecAmount).toBeCloseTo(
        0.85,
        12,
      );
    });

    it('carries the original text through', () => {
      // The tooltip and the revert both need the exact text that was on the
      // page, not a re-rendering of the number.
      const result = convertPrice(
        { ...price(19.99, 'USD'), original: '$19.99' },
        rates,
        'auto',
        'auto',
      )!;
      expect(result.original).toBe('$19.99');
      expect(result.currency).toBe('USD');
      expect(result.formatted).toContain('ZEC');
    });
  });

  describe('given a held rate', () => {
    describe('given the held rate covers this currency', () => {
      it('converts at the held rate rather than spot', () => {
        // The held rate is the whole deadband mechanism: a price the user read
        // an hour ago should still read the same now.
        const held = { peg: 0.00125, pegged: Date.now() };
        const moved: RatesData = { ...rates, rates: { ...rates.rates, USD: 0.002 } };
        expect(convertPrice(price(800, 'USD'), moved, 'auto', 'auto', held)!.zecAmount)
          .toBeCloseTo(1, 12);
      });
    });

    describe('given the held rate cannot cover this currency', () => {
      it('refuses rather than falling back to spot', () => {
        // Falling back would show one price on the page at spot and its
        // neighbour at the held rate, which is worse than showing neither.
        const held = { peg: 0.00125, pegged: Date.now() };
        expect(convertPrice(price(10, 'CHF'), rates, 'auto', 'auto', held)).toBeNull();
      });
    });
  });

  describe('when a precision is given', () => {
    it('is carried into the rendering', () => {
      // A caller passing a precision must have it reach the formatter, or the
      // options page silently does nothing.
      expect(convertPrice(price(19.99, 'USD'), rates, 'coarse', 'auto')!.formatted).toContain('≈');
    });
  });

  describe('when a display unit is given', () => {
    it('is carried into the rendering', () => {
      expect(convertPrice(price(19.99, 'USD'), rates, 'auto', 'zats')!.formatted)
        .toContain('zats');
    });
  });

  describe('given a currency it has no rate for', () => {
    it('refuses', () => {
      expect(convertPrice(price(10, 'CHF'), rates, 'auto', 'auto')).toBeNull();
    });
  });

  describe('given the rate for that currency is past the hard cap', () => {
    it('refuses rather than converting at a stale rate', () => {
      // Checked per currency, not map-wide: a fallback provider that only
      // quotes USD/EUR leaves the others frozen while the map looks fresh.
      const stale: RatesData = {
        ...rates,
        rateUpdatedAt: { USD: Date.now() - MAX_RATE_AGE_MS - 1 },
      };
      expect(convertPrice(price(19.99, 'USD'), stale, 'auto', 'auto')).toBeNull();
    });
  });

  describe('given the arithmetic does not produce a usable amount', () => {
    it('never yields a non-finite amount', () => {
      for (const amount of [0, 0.0001, 1e12]) {
        expect(
          Number.isFinite(convertPrice(price(amount, 'USD'), rates, 'auto', 'auto')!.zecAmount),
        ).toBe(true);
      }
    });

    describe('given the rate overflows', () => {
      it('refuses', () => {
        // Nothing else stands between a garbage quote and every price on the
        // page.
        const broken: RatesData = { ...rates, rates: { USD: 1e308 } };
        expect(convertPrice(price(1e308, 'USD'), broken, 'auto', 'auto')).toBeNull();
      });
    });

    describe('given the rate is negative', () => {
      it('refuses', () => {
        const broken: RatesData = { ...rates, rates: { USD: -0.00125 } };
        expect(convertPrice(price(10, 'USD'), broken, 'auto', 'auto')).toBeNull();
      });
    });
  });
});
