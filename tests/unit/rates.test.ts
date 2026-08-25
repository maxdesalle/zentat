import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Spec: tests/trees/rates.tree

const store = new Map<string, unknown>();
const watchers = new Map<string, ((value: unknown) => void)[]>();

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: (key: string, opts: { fallback: unknown }) => ({
      getValue: async () => (store.has(key) ? store.get(key) : opts.fallback),
      setValue: async (value: unknown) => {
        store.set(key, value);
        for (const fn of watchers.get(key) ?? []) fn(value);
      },
      watch: (fn: (value: unknown) => void) => {
        const list = watchers.get(key) ?? [];
        list.push(fn);
        watchers.set(key, list);
        return () => void list.splice(list.indexOf(fn), 1);
      },
    }),
  },
}));

const {
  MAX_RATE_AGE_MS,
  REFRESH_TTL_MS,
  getFetchStatus,
  getHeldRate,
  getRates,
  isCurrencyUsable,
  isRatesStale,
  isRatesUsable,
  mergeRates,
  rateAge,
  setFetchStatus,
  setHeldRate,
  setRates,
  watchFetchStatus,
  watchHeldRate,
  watchRates,
} = await import('../../src/lib/storage/rates');

const NOW = 1_700_000_000_000;

beforeEach(() => {
  store.clear();
  watchers.clear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function data(over: Partial<Parameters<typeof mergeRates>[0]> = {}) {
  return { rates: {}, updatedAt: NOW, source: 'coingecko', ...over };
}

describe('isRatesStale', () => {
  describe('given the cache has never been written', () => {
    it('is stale', () => {
      expect(isRatesStale(data({ updatedAt: 0 }))).toBe(true);
    });
  });

  describe('given the cache was written inside the window', () => {
    it('is fresh', () => {
      expect(isRatesStale(data({ updatedAt: NOW - 1000 }))).toBe(false);
    });
  });

  describe('given the cache was written outside the window', () => {
    it('is stale', () => {
      expect(isRatesStale(data({ updatedAt: NOW - REFRESH_TTL_MS - 1 }))).toBe(true);
    });
  });

  describe('when a custom window is given', () => {
    it('uses that window instead of the default', () => {
      const older = data({ updatedAt: NOW - REFRESH_TTL_MS - 1 });
      expect(isRatesStale(older, REFRESH_TTL_MS * 10)).toBe(false);
    });
  });
});

describe('rateAge', () => {
  describe('given the currency has its own timestamp', () => {
    it('measures from that timestamp', () => {
      const d = data({ updatedAt: NOW, rateUpdatedAt: { USD: NOW - 5000 } });
      expect(rateAge(d, 'USD')).toBe(5000);
    });
  });

  describe('given the currency has no timestamp of its own', () => {
    it('falls back to the map-wide timestamp', () => {
      const d = data({ updatedAt: NOW - 3000, rateUpdatedAt: { EUR: NOW } });
      expect(rateAge(d, 'USD')).toBe(3000);
    });
  });

  describe('given neither timestamp exists', () => {
    it('reports an infinite age', () => {
      expect(rateAge(data({ updatedAt: 0 }), 'USD')).toBe(Infinity);
    });
  });

  describe('when the currency is given in lower case', () => {
    it('matches the stored upper-case code', () => {
      const d = data({ rateUpdatedAt: { USD: NOW - 7000 } });
      expect(rateAge(d, 'usd')).toBe(7000);
    });
  });
});

describe('isCurrencyUsable', () => {
  describe('given the currency is not in the map', () => {
    it('is not usable', () => {
      expect(isCurrencyUsable(data({ rates: { EUR: 0.03 } }), 'USD')).toBe(false);
    });
  });

  describe('given the currency is younger than the hard cap', () => {
    it('is usable', () => {
      const d = data({ rates: { USD: 0.025 }, rateUpdatedAt: { USD: NOW - 1000 } });
      expect(isCurrencyUsable(d, 'USD')).toBe(true);
    });
  });

  describe('given the currency is older than the hard cap', () => {
    it('is not usable', () => {
      // A day-old rate is not a slightly worse rate, it is a wrong price on a
      // checkout page. The cap is the whole point of the per-currency stamp.
      const d = data({ rates: { USD: 0.025 }, rateUpdatedAt: { USD: NOW - MAX_RATE_AGE_MS - 1 } });
      expect(isCurrencyUsable(d, 'USD')).toBe(false);
    });
  });
});

describe('isRatesUsable', () => {
  describe('given every currency is past the hard cap', () => {
    it('is not usable', () => {
      const stale = NOW - MAX_RATE_AGE_MS - 1;
      const d = data({
        rates: { USD: 0.025, EUR: 0.03 },
        rateUpdatedAt: { USD: stale, EUR: stale },
      });
      expect(isRatesUsable(d)).toBe(false);
    });
  });

  describe('given one currency is still inside the cap', () => {
    it('is usable', () => {
      const d = data({
        rates: { USD: 0.025, EUR: 0.03 },
        rateUpdatedAt: { USD: NOW - MAX_RATE_AGE_MS - 1, EUR: NOW },
      });
      expect(isRatesUsable(d)).toBe(true);
    });
  });

  describe('given the map is empty', () => {
    it('is not usable', () => {
      expect(isRatesUsable(data())).toBe(false);
    });
  });
});

describe('mergeRates', () => {
  describe('given the incoming fetch covers only some currencies', () => {
    // Kraken's fallback returns USD/EUR only. Replacing the map would drop the
    // other eleven; stamping them all fresh would let them silently outlive the
    // 24h cap. Both were shipped bugs.
    const current = data({
      rates: { USD: 0.025, EUR: 0.03, JPY: 3.5 },
      rateUpdatedAt: { USD: NOW - 60_000, EUR: NOW - 60_000, JPY: NOW - 60_000 },
      updatedAt: NOW - 60_000,
    });
    const incoming = data({ rates: { USD: 0.026 }, updatedAt: NOW, source: 'kraken' });

    it('keeps the currencies the fetch did not return', () => {
      expect(mergeRates(current, incoming).rates.JPY).toBe(3.5);
    });

    it('overwrites the currencies the fetch did return', () => {
      expect(mergeRates(current, incoming).rates.USD).toBe(0.026);
    });

    it('leaves the untouched currencies at their real age', () => {
      const merged = mergeRates(current, incoming);
      expect(merged.rateUpdatedAt?.JPY).toBe(NOW - 60_000);
      expect(merged.rateUpdatedAt?.USD).toBe(NOW);
    });
  });

  describe('given an existing currency has no per-currency timestamp', () => {
    it('backfills from the map-wide timestamp', () => {
      // Caches written by versions before rateUpdatedAt existed.
      const current = data({ rates: { JPY: 3.5 }, updatedAt: NOW - 90_000 });
      const merged = mergeRates(current, data({ rates: { USD: 0.026 } }));
      expect(merged.rateUpdatedAt?.JPY).toBe(NOW - 90_000);
    });
  });

  it('takes the source and map-wide timestamp from the incoming fetch', () => {
    const merged = mergeRates(
      data({ rates: { USD: 0.025 }, updatedAt: NOW - 60_000 }),
      data({ rates: { EUR: 0.03 }, updatedAt: NOW, source: 'kraken' }),
    );
    expect(merged.source).toBe('kraken');
    expect(merged.updatedAt).toBe(NOW);
  });
});

describe('stored values', () => {
  describe('given nothing has been stored', () => {
    it('reports empty rates', async () => {
      expect((await getRates()).rates).toEqual({});
    });

    it('reports no held rate', async () => {
      expect(await getHeldRate()).toBeNull();
    });

    it('reports an idle fetch status', async () => {
      expect((await getFetchStatus()).state).toBe('idle');
    });
  });

  describe('when rates are written', () => {
    it('reads them back', async () => {
      await setRates(data({ rates: { USD: 0.025 } }));
      expect((await getRates()).rates.USD).toBe(0.025);
    });

    it('notifies watchers', async () => {
      const seen = vi.fn();
      const stop = watchRates(seen);
      await setRates(data({ rates: { USD: 0.025 } }));
      expect(seen).toHaveBeenCalledOnce();
      stop();
      await setRates(data({ rates: { EUR: 0.03 } }));
      expect(seen).toHaveBeenCalledOnce();
    });
  });

  describe('when a held rate is written', () => {
    const held = { rate: 0.025, currency: 'USD', heldSince: NOW, marketRate: 0.025 };

    it('reads it back', async () => {
      await setHeldRate(held);
      expect(await getHeldRate()).toEqual(held);
    });

    it('notifies watchers', async () => {
      const seen = vi.fn();
      const stop = watchHeldRate(seen);
      await setHeldRate(held);
      expect(seen).toHaveBeenCalledWith(held);
      stop();
    });
  });

  describe('when a fetch status is written', () => {
    it('records the state', async () => {
      await setFetchStatus('fetching');
      const status = await getFetchStatus();
      expect(status.state).toBe('fetching');
      expect(status.changedAt).toBe(NOW);
    });

    it('records the error', async () => {
      await setFetchStatus('error', 'gateway down');
      expect((await getFetchStatus()).error).toBe('gateway down');
    });

    it('notifies watchers', async () => {
      const seen = vi.fn();
      const stop = watchFetchStatus(seen);
      await setFetchStatus('ok');
      expect(seen).toHaveBeenCalledOnce();
      stop();
    });
  });
});
