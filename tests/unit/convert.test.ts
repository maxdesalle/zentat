import { describe, expect, it, vi } from 'vitest';

// convert.ts reaches into storage/rates for per-currency staleness, and that
// module defines storage items at import time. Without this, the definitions
// touch chrome.runtime and reject asynchronously — 299 green tests plus three
// unhandled rejections, which vitest exits non-zero on.
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
import type { RatesData } from '../../src/lib/storage/rates';

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
  it('multiplies by the stored rate', () => {
    expect(convertPrice(price(19.99, 'USD'), rates, 'auto')!.zecAmount).toBeCloseTo(0.0249875, 12);
    expect(convertPrice(price(800, 'USD'), rates, 'auto')!.zecAmount).toBeCloseTo(1, 12);
    expect(convertPrice(price(1000, 'EUR'), rates, 'auto')!.zecAmount).toBeCloseTo(1.3, 12);
  });

  it('is not the reciprocal', () => {
    // The failure mode this whole file exists for: 1/0.00125 = 800.
    const result = convertPrice(price(1, 'USD'), rates, 'auto')!;
    expect(result.zecAmount).toBeCloseTo(0.00125, 12);
    expect(result.zecAmount).not.toBeCloseTo(800, 6);
  });

  it('scales linearly across magnitudes', () => {
    const one = convertPrice(price(1, 'USD'), rates, 'auto')!.zecAmount;
    for (const factor of [10, 1_000, 1_000_000]) {
      expect(convertPrice(price(factor, 'USD'), rates, 'auto')!.zecAmount)
        .toBeCloseTo(one * factor, 9);
    }
  });

  it('handles a currency with a very small rate', () => {
    expect(convertPrice(price(100_000, 'JPY'), rates, 'auto')!.zecAmount).toBeCloseTo(0.85, 12);
  });

  it('refuses a currency it has no rate for', () => {
    expect(convertPrice(price(10, 'CHF'), rates, 'auto')).toBeNull();
  });

  it('never yields a non-finite amount', () => {
    for (const amount of [0, 0.0001, 1e12]) {
      const result = convertPrice(price(amount, 'USD'), rates, 'auto')!;
      expect(Number.isFinite(result.zecAmount)).toBe(true);
    }
  });
});
