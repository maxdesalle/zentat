import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Spec: tests/trees/background-rates.tree
//
// The refresh cycle is where privacy, freshness and the held rate all meet. A
// mistake here is silent: the extension keeps converting, just at a rate that
// is stale, implausible, or fetched over a transport the user did not choose.

const store = new Map<string, unknown>();

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: (key: string, opts: { fallback: unknown }) => ({
      getValue: async () => (store.has(key) ? store.get(key) : opts.fallback),
      setValue: async (value: unknown) => void store.set(key, value),
      watch: () => () => {},
    }),
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));

// vi.mock factories are hoisted above ordinary consts, so the spies they
// return have to be created in a hoisted block of their own.
const { createFetcher, destroyNymConnection, fetchRatesWithRetry } = vi.hoisted(() => ({
  createFetcher: vi.fn(() => ({ fetch: vi.fn() })),
  destroyNymConnection: vi.fn(async () => {}),
  fetchRatesWithRetry: vi.fn(),
}));

vi.mock('../../src/lib/rates/provider', () => ({ fetchRatesWithRetry }));
vi.mock('../../src/lib/fetch/nym', () => ({ destroyNymConnection }));
vi.mock('../../src/lib/fetch', () => ({ createFetcher }));

import { refreshRates } from '../../src/entrypoints/background/rates';
import { resetRateValidation } from '../../src/lib/rates/validate';
import { getFetchStatus, getHeldRate, getRates } from '../../src/lib/storage/rates';
import { DEFAULT_SETTINGS } from '../../src/lib/storage/settings';

const RATE = 0.00125;
const NOW = 1_700_000_000_000;

function settingsOf(over: Record<string, unknown> = {}) {
  store.set('local:settings', { ...DEFAULT_SETTINGS, ...over });
}

function fetched(rates: Record<string, number>, source = 'coingecko') {
  return { success: true, data: { rates, updatedAt: Date.now(), source }, errors: [] };
}

/**
 * Real timers make the jitter sleep a 90-second test. Fake timers plus an
 * auto-advancing tick let the cycle run at its own shape without waiting.
 */
async function runCycle(force = false) {
  const promise = refreshRates(force);
  await vi.runAllTimersAsync();
  return promise;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(Math, 'random').mockReturnValue(0);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  resetRateValidation();
  settingsOf();
  fetchRatesWithRetry.mockResolvedValue(fetched({ USD: RATE }));
  vi.stubGlobal('browser', { runtime: { getPlatformInfo: async () => ({}) } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('refreshRates', () => {
  describe('given a cycle is already running', () => {
    it('joins that cycle rather than starting a second', async () => {
      // Overlapping triggers — the alarm, a worker cold start, a popup refresh
      // — used to destroy the Nym offscreen document out from under each other.
      const first = refreshRates(true);
      const second = refreshRates(true);
      expect(second).toBe(first);
      await vi.runAllTimersAsync();
      await first;
      expect(fetchRatesWithRetry).toHaveBeenCalledOnce();
    });
  });

  describe('given the cached rates are still fresh', () => {
    beforeEach(() => {
      store.set('local:rates', { rates: { USD: RATE }, updatedAt: NOW, source: 'coingecko' });
    });

    it('does not fetch', async () => {
      expect(await runCycle()).toBe(true);
      expect(fetchRatesWithRetry).not.toHaveBeenCalled();
    });

    describe('when the caller forces a refresh', () => {
      it('fetches anyway', async () => {
        await runCycle(true);
        expect(fetchRatesWithRetry).toHaveBeenCalledOnce();
      });
    });
  });

  describe('given the cached rates are stale', () => {
    it('waits a random moment before fetching', async () => {
      // A machine-precise cadence is a fingerprint on its own.
      const sleeps: number[] = [];
      vi.spyOn(globalThis, 'setTimeout').mockImplementation(
        ((fn: () => void, ms: number) => {
          sleeps.push(ms);
          fn();
          return 0;
        }) as never,
      );
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      await refreshRates();
      expect(sleeps.some((ms) => ms > 0 && ms <= 90_000)).toBe(true);
    });

    it('reports that it is fetching', async () => {
      let seen: string | undefined;
      fetchRatesWithRetry.mockImplementation(async () => {
        seen = (await getFetchStatus()).state;
        return fetched({ USD: RATE });
      });
      await runCycle();
      expect(seen).toBe('fetching');
    });
  });

  describe('given Nym is disabled', () => {
    beforeEach(() => settingsOf({ nymEnabled: false }));

    it('fetches directly', async () => {
      await runCycle(true);
      expect(createFetcher).toHaveBeenCalledWith({ nymEnabled: false });
    });

    describe('given the fetch succeeds', () => {
      it('stores the rates', async () => {
        expect(await runCycle(true)).toBe(true);
        expect((await getRates()).rates.USD).toBe(RATE);
      });
    });

    describe('given the fetch fails', () => {
      it('reports the provider errors', async () => {
        fetchRatesWithRetry.mockResolvedValue({
          success: false,
          errors: ['CoinGecko: 429', 'Kraken: down'],
        });
        expect(await runCycle(true)).toBe(false);
        const status = await getFetchStatus();
        expect(status.state).toBe('error');
        expect(status.error).toBe('CoinGecko: 429; Kraken: down');
      });
    });
  });

  describe('given Nym is enabled', () => {
    beforeEach(() => settingsOf({ nymEnabled: true }));

    it('never falls back to a direct fetch', async () => {
      // Falling back would leak the user's IP to the rate API — the one thing
      // the whole transport exists to prevent.
      fetchRatesWithRetry.mockResolvedValue({ success: false, errors: ['no gateway'] });
      await runCycle(true);
      for (const [options] of createFetcher.mock.calls as unknown as [{ nymEnabled: boolean }][]) {
        expect(options.nymEnabled).toBe(true);
      }
    });

    describe('given the first attempt succeeds', () => {
      it('stores the rates', async () => {
        expect(await runCycle(true)).toBe(true);
        expect((await getRates()).rates.USD).toBe(RATE);
      });

      it('clears any backoff', async () => {
        store.set('local:nymBackoffUntil', NOW + 60_000);
        await runCycle(true);
        expect(store.get('local:nymBackoffUntil')).toBe(0);
      });
    });

    describe('given the first attempt fails', () => {
      beforeEach(() => {
        fetchRatesWithRetry
          .mockResolvedValueOnce({ success: false, errors: ['gateway gone'] })
          .mockResolvedValue(fetched({ USD: RATE }));
      });

      it('tears the connection down for a fresh gateway', async () => {
        // The SDK has no in-place reconnect: the only real one is a new
        // document.
        await runCycle(true);
        expect(destroyNymConnection).toHaveBeenCalledOnce();
      });

      it('tries again', async () => {
        expect(await runCycle(true)).toBe(true);
        expect(fetchRatesWithRetry).toHaveBeenCalledTimes(2);
      });
    });

    describe('given every attempt fails', () => {
      beforeEach(() => {
        fetchRatesWithRetry.mockResolvedValue({ success: false, errors: ['no gateway'] });
      });

      it('backs off before the next cycle', async () => {
        // Churning gateways every alarm cycle burns registrations at a rate
        // the network notices, and is a distinctive signature besides.
        expect(await runCycle(true)).toBe(false);
        expect(store.get('local:nymBackoffUntil')).toBeGreaterThan(NOW);
      });

      it('reports the failure', async () => {
        await runCycle(true);
        expect((await getFetchStatus()).error).toContain('Nym');
      });
    });

    describe('given the backoff window is still open', () => {
      beforeEach(() => store.set('local:nymBackoffUntil', NOW + 60_000));

      it('skips the cycle entirely', async () => {
        expect(await runCycle()).toBe(false);
        expect(fetchRatesWithRetry).not.toHaveBeenCalled();
      });

      describe('when the caller forces a refresh', () => {
        it('fetches anyway', async () => {
          // A user pressing refresh has asked for it explicitly.
          await runCycle(true);
          expect(fetchRatesWithRetry).toHaveBeenCalled();
        });
      });
    });
  });

  describe("given a fetch outlives the worker's idle timer", () => {
    it('keeps the worker alive', async () => {
      // Chrome kills an MV3 service worker after about 30 seconds idle, and a
      // mixnet fetch takes longer than that. Any extension-API call resets it.
      const getPlatformInfo = vi.fn(async () => ({}));
      vi.stubGlobal('browser', { runtime: { getPlatformInfo } });
      let release: (value: unknown) => void = () => {};
      fetchRatesWithRetry.mockImplementation(() =>
        new Promise((resolve) => {
          release = resolve;
        })
      );
      const cycle = refreshRates(true);
      await vi.advanceTimersByTimeAsync(45_000);
      expect(getPlatformInfo).toHaveBeenCalled();
      release(fetched({ USD: RATE }));
      await cycle;
    });
  });

  describe('given the fetch fails with no error to report', () => {
    it('says so generically', async () => {
      // "error: " with nothing after it reads as a bug in the extension.
      fetchRatesWithRetry.mockResolvedValue({ success: false, errors: [] });
      await runCycle(true);
      expect((await getFetchStatus()).error).toBe('Rate fetch failed');
    });
  });

  describe('given the fetch throws', () => {
    it('reports the error rather than rejecting', async () => {
      // An unhandled rejection in a service worker takes the worker with it.
      fetchRatesWithRetry.mockRejectedValue(new Error('worker died'));
      expect(await runCycle(true)).toBe(false);
      expect((await getFetchStatus()).error).toBe('worker died');
    });

    describe('given what was thrown is not an Error', () => {
      it('still reports something readable', async () => {
        // WASM and worker boundaries reject with strings as readily as Errors.
        fetchRatesWithRetry.mockRejectedValue('gateway handshake failed');
        expect(await runCycle(true)).toBe(false);
        expect((await getFetchStatus()).error).toBe('gateway handshake failed');
      });
    });
  });

  describe('storing rates', () => {
    it('merges over the existing cache', async () => {
      // Kraken's fallback serves USD/EUR only; replacing would wipe the rest.
      store.set('local:rates', {
        rates: { USD: RATE, JPY: 0.0000085 },
        rateUpdatedAt: { USD: NOW - 60_000, JPY: NOW - 60_000 },
        updatedAt: NOW - 60_000,
        source: 'coingecko',
      });
      fetchRatesWithRetry.mockResolvedValue(fetched({ USD: RATE * 1.01 }, 'kraken'));
      await runCycle(true);
      const stored = await getRates();
      expect(stored.rates.JPY).toBe(0.0000085);
      expect(stored.rates.USD).toBeCloseTo(RATE * 1.01, 12);
    });

    describe('given some currencies fail the plausibility check', () => {
      it('keeps the ones that passed', async () => {
        fetchRatesWithRetry.mockResolvedValue(fetched({ USD: RATE, EUR: 99_999 }));
        await runCycle(true);
        const stored = await getRates();
        expect(stored.rates.USD).toBe(RATE);
        expect(stored.rates.EUR).toBeUndefined();
      });
    });

    describe('given every currency fails the plausibility check', () => {
      beforeEach(() => {
        fetchRatesWithRetry.mockResolvedValue(fetched({ USD: 99_999 }));
      });

      it('stores nothing', async () => {
        await runCycle(true);
        expect((await getRates()).rates).toEqual({});
      });

      it('reports the failure', async () => {
        await runCycle(true);
        expect((await getFetchStatus()).error).toContain('plausibility');
      });
    });

    describe('given the held rate is unchanged', () => {
      it('is not rewritten', async () => {
        await runCycle(true);
        const first = await getHeldRate();
        fetchRatesWithRetry.mockResolvedValue(fetched({ USD: RATE * 1.01 }));
        await runCycle(true);
        expect(await getHeldRate()).toEqual(first);
      });
    });

    describe('given spot has left the band', () => {
      it('re-pegs', async () => {
        await runCycle(true);
        // Past the 10% band but inside what the plausibility check accepts:
        // a real move, not a broken feed.
        fetchRatesWithRetry.mockResolvedValue(fetched({ USD: RATE * 1.12 }));
        await runCycle(true);
        expect((await getHeldRate())!.peg).toBeCloseTo(RATE * 1.12, 12);
      });
    });

    it('reports success', async () => {
      await runCycle(true);
      expect((await getFetchStatus()).state).toBe('ok');
    });
  });
});
