import { describe, expect, it, vi } from 'vitest';

// The rates module defines storage items at import time; stub the storage
// layer so the pure helpers can be tested in Node.
vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: () => ({
      getValue: async () => null,
      setValue: async () => {},
      watch: () => () => {},
    }),
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
    watch: () => () => {},
  },
}));

import {
  isRatesStale,
  isRatesUsable,
  MAX_RATE_AGE_MS,
  mergeRates,
  type RatesData,
} from '../../src/lib/storage/rates';

function rates(overrides: Partial<RatesData> = {}): RatesData {
  return { rates: { USD: 0.00125 }, updatedAt: Date.now(), source: 'test', ...overrides };
}

describe('isRatesStale', () => {
  it('treats never-fetched rates as stale', () => {
    expect(isRatesStale(rates({ updatedAt: 0 }))).toBe(true);
  });

  it('respects the TTL', () => {
    expect(isRatesStale(rates())).toBe(false);
    expect(isRatesStale(rates({ updatedAt: Date.now() - 11 * 60 * 1000 }))).toBe(true);
  });
});

describe('isRatesUsable', () => {
  it('rejects empty rates', () => {
    expect(isRatesUsable(rates({ rates: {} }))).toBe(false);
  });

  it('accepts fresh rates', () => {
    expect(isRatesUsable(rates())).toBe(true);
  });

  it('rejects rates older than the max display age', () => {
    expect(isRatesUsable(rates({ updatedAt: Date.now() - MAX_RATE_AGE_MS - 1000 }))).toBe(false);
  });
});

describe('mergeRates', () => {
  it('merges partial results over the existing cache', () => {
    const current = rates({
      rates: { USD: 1, EUR: 2, GBP: 3 },
      updatedAt: 1000,
      source: 'coingecko',
    });
    // Kraken fallback only serves USD/EUR — GBP must survive the merge
    const incoming = rates({ rates: { USD: 10, EUR: 20 }, updatedAt: 2000, source: 'kraken' });
    const merged = mergeRates(current, incoming);
    expect(merged.rates).toEqual({ USD: 10, EUR: 20, GBP: 3 });
    expect(merged.updatedAt).toBe(2000);
    expect(merged.source).toBe('kraken');
  });
});
