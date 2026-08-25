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
  isCurrencyUsable,
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

describe('per-currency staleness', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('keeps each currency at its own real age when merging', () => {
    const now = Date.now();
    const current: RatesData = {
      rates: { USD: 0.00125, JPY: 0.0000085 },
      updatedAt: now - 3 * DAY,
      source: 'coingecko',
    };
    // Kraken only quotes USD and EUR.
    const incoming: RatesData = {
      rates: { USD: 0.00126, EUR: 0.0013 },
      updatedAt: now,
      source: 'kraken',
    };

    const merged = mergeRates(current, incoming);

    expect(merged.rates.JPY).toBe(0.0000085);
    expect(merged.rateUpdatedAt!.USD).toBe(now);
    expect(merged.rateUpdatedAt!.EUR).toBe(now);
    // The JPY rate is three days old and must still say so.
    expect(merged.rateUpdatedAt!.JPY).toBe(now - 3 * DAY);
  });

  it('refuses a currency past the 24h cap while the fresh ones keep working', () => {
    const now = Date.now();
    const data: RatesData = {
      rates: { USD: 0.00125, JPY: 0.0000085 },
      rateUpdatedAt: { USD: now, JPY: now - 3 * DAY },
      updatedAt: now,
      source: 'kraken',
    };

    expect(isCurrencyUsable(data, 'USD')).toBe(true);
    expect(isCurrencyUsable(data, 'JPY')).toBe(false);
    expect(isRatesUsable(data)).toBe(true);
  });

  it('falls back to the map-wide timestamp for caches written before the split', () => {
    const now = Date.now();
    const legacy: RatesData = { rates: { USD: 0.00125 }, updatedAt: now, source: 'coingecko' };
    expect(isCurrencyUsable(legacy, 'USD')).toBe(true);
  });
});
