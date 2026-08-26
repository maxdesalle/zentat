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
const { createFetcher, debug, destroyNymConnection, fetchRatesWithRetry } = vi.hoisted(() => ({
  createFetcher: vi.fn(() => ({ fetch: vi.fn() })),
  debug: vi.fn(),
  destroyNymConnection: vi.fn(async () => {}),
  fetchRatesWithRetry: vi.fn(),
}));

vi.mock('../../src/lib/rates/provider', () => ({ fetchRatesWithRetry }));
vi.mock('../../src/lib/fetch/nym', () => ({ destroyNymConnection }));
vi.mock('../../src/lib/fetch', () => ({ createFetcher }));
// The log is the only place a user can check which transport a cycle actually
// used, and the only account of why a cycle did nothing. What it says is part
// of the behaviour, not decoration.
vi.mock('../../src/lib/log', () => ({ debug }));

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

/** Everything the cycle wrote to the log, as one blob to search. */
function log() {
  return debug.mock.calls.map(([message]) => String(message)).join('\n');
}

/** A cache old enough to need refreshing, and old enough to have a cadence. */
function staleCache() {
  store.set('local:rates', {
    rates: { USD: RATE },
    updatedAt: NOW - 60 * 60_000,
    source: 'coingecko',
  });
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
      // A machine-precise cadence is a fingerprint on its own — but only a
      // RECURRING one is, so the wait applies once there is a cache to
      // refresh, never on the very first fetch.
      store.set('local:rates', {
        rates: { USD: RATE },
        updatedAt: NOW - 60 * 60_000,
        source: 'coingecko',
      });
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

    describe('given nothing is cached at all', () => {
      it('does not wait, because the user is watching', async () => {
        // The welcome page is on screen at this exact moment. It used to sit
        // on "waiting for the rate…" for up to ninety seconds, so the first
        // thing a new user ever saw was the product failing to do its one job.
        const sleeps: number[] = [];
        vi.spyOn(globalThis, 'setTimeout').mockImplementation(
          ((fn: () => void, ms: number) => {
            sleeps.push(ms);
            fn();
            return 0;
          }) as never,
        );
        vi.spyOn(Math, 'random').mockReturnValue(0.9);
        await refreshRates();
        expect(sleeps.filter((ms) => ms > 1_000)).toEqual([]);
      });
    });

    describe('given a forced refresh joins a cycle already waiting', () => {
      it('leaves no timer behind', async () => {
        // A timer outliving its wait holds the service worker awake for the
        // rest of the jitter window, which is the opposite of what the
        // keepalive interval is carefully torn down for.
        staleCache();
        vi.spyOn(Math, 'random').mockReturnValue(1);
        const joined = refreshRates(false);
        await vi.advanceTimersByTimeAsync(1);
        refreshRates(true);
        await vi.advanceTimersByTimeAsync(1);
        await joined;
        expect(vi.getTimerCount()).toBe(0);
      });

      it('cuts the wait short', async () => {
        // The background body starts an unforced cycle during script
        // evaluation, so the install's forced fetch always joined one that
        // was already asleep — and `force` was silently discarded.
        store.set('local:rates', {
          rates: { USD: RATE },
          updatedAt: NOW - 60 * 60_000,
          source: 'coingecko',
        });
        vi.spyOn(Math, 'random').mockReturnValue(1); // the full 90 seconds
        const joined = refreshRates(false);
        // Let the cycle actually reach the wait before forcing.
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchRatesWithRetry).not.toHaveBeenCalled();

        refreshRates(true);
        await vi.advanceTimersByTimeAsync(1);
        await joined;
        expect(fetchRatesWithRetry).toHaveBeenCalled();
      });
    });

    describe('given an unforced refresh joins a cycle already waiting', () => {
      it('leaves the wait in place', async () => {
        // The alarm fires more often than the wait is long, so if any joiner
        // could cut it the jitter would almost never apply and the cadence
        // would be machine-precise again.
        staleCache();
        vi.spyOn(Math, 'random').mockReturnValue(1);
        const joined = refreshRates(false);
        await vi.advanceTimersByTimeAsync(1);

        refreshRates(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchRatesWithRetry).not.toHaveBeenCalled();

        await vi.runAllTimersAsync();
        await joined;
      });
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

    it('reports that it is waiting', async () => {
      // The wait can run to a minute and a half and a Nym fetch longer still.
      // A popup that shows nothing for that long reads as a broken extension,
      // so the state is written before the wait rather than after it.
      staleCache();
      vi.spyOn(Math, 'random').mockReturnValue(1);
      const cycle = refreshRates();
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchRatesWithRetry).not.toHaveBeenCalled();
      expect((await getFetchStatus()).state).toBe('fetching');
      await vi.runAllTimersAsync();
      await cycle;
    });
  });

  describe('given Nym is disabled', () => {
    beforeEach(() => settingsOf({ nymEnabled: false }));

    it('fetches directly', async () => {
      await runCycle(true);
      expect(createFetcher).toHaveBeenCalledWith({ nymEnabled: false });
    });

    it('tells the provider which source the user chose', async () => {
      // Picking a source is how a user opts out of a provider they do not
      // want to talk to at all. Dropping it silently restores the default
      // chain and contacts the very host they excluded.
      settingsOf({ nymEnabled: false, rateSource: 'kraken' });
      await runCycle(true);
      expect(fetchRatesWithRetry).toHaveBeenCalledWith(expect.anything(), { source: 'kraken' });
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

    describe('given the provider reports a failure but returns rates anyway', () => {
      it('stores nothing', async () => {
        // A half-parsed response carries numbers alongside its own verdict of
        // failure. Pricing off them is the wrong-price-worse-than-no-price
        // case in its purest form.
        fetchRatesWithRetry.mockResolvedValue({
          success: false,
          data: { rates: { USD: RATE }, updatedAt: NOW, source: 'coingecko' },
          errors: ['truncated response'],
        });
        expect(await runCycle(true)).toBe(false);
        expect((await getRates()).rates).toEqual({});
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

    it('tells the provider the fetch is going through the mixnet', async () => {
      // The provider gives a mixnet fetch a gentler retry ladder. Without the
      // flag it retries on a direct fetch's schedule, hammering a gateway that
      // is merely slow.
      settingsOf({ nymEnabled: true, rateSource: 'kraken' });
      await runCycle(true);
      expect(fetchRatesWithRetry).toHaveBeenCalledWith(expect.anything(), {
        isNym: true,
        source: 'kraken',
      });
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

      it('notes the success in the log', async () => {
        // PRIVACY.md claims the rate never leaves over the clear net when Nym
        // is on. The log is where a user can hold us to that.
        await runCycle(true);
        expect(log()).toContain('succeeded');
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

      it('waits before churning to a new gateway', async () => {
        // Retrying the instant the old gateway died just meets the same
        // congested state, and does it while holding a fresh registration.
        const cycle = refreshRates(true);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(fetchRatesWithRetry).toHaveBeenCalledOnce();

        await vi.advanceTimersByTimeAsync(15_000);
        await cycle;
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

      it('waits fifteen minutes before trying the mixnet again', async () => {
        // Long enough that a broken mixnet is not one gateway registration per
        // alarm; short enough that a transient outage heals in a cycle or two.
        await runCycle(true);
        // Measured from the moment it gave up, which is already later than NOW
        // because the cycle paused between gateways.
        const gaveUpAt = (await getFetchStatus()).changedAt;
        expect(store.get('local:nymBackoffUntil')).toBe(gaveUpAt + 15 * 60_000);
      });

      it('does not tear down a gateway it will not use', async () => {
        // Every teardown buys a fresh registration for the next attempt. After
        // the last one there is no next attempt, so it buys nothing and still
        // shows up on the network.
        await runCycle(true);
        expect(destroyNymConnection).toHaveBeenCalledOnce();
      });

      it('reports the failure', async () => {
        await runCycle(true);
        expect((await getFetchStatus()).error).toContain('Nym');
        expect((await getFetchStatus()).state).toBe('error');
      });

      it('narrates each attempt in the log', async () => {
        // From outside, a mixnet cycle that is retrying and one that has hung
        // look identical: both are a popup saying nothing for a minute.
        await runCycle(true);
        expect(log()).toContain('attempt 1/2');
        expect(log()).toContain('attempt 2/2');
        expect(log()).toContain('destroying');
        expect(log()).toContain('backing off');
      });
    });

    describe('given the provider reports a failure but returns rates anyway', () => {
      it('stores nothing', async () => {
        fetchRatesWithRetry.mockResolvedValue({
          success: false,
          data: { rates: { USD: RATE }, updatedAt: NOW, source: 'coingecko' },
          errors: ['truncated response'],
        });
        expect(await runCycle(true)).toBe(false);
        expect((await getRates()).rates).toEqual({});
      });
    });

    describe('given the backoff window is still open', () => {
      beforeEach(() => store.set('local:nymBackoffUntil', NOW + 60_000));

      it('skips the cycle entirely', async () => {
        expect(await runCycle()).toBe(false);
        expect(fetchRatesWithRetry).not.toHaveBeenCalled();
      });

      it('explains why the rate is not updating', async () => {
        // Deliberately sitting out a cycle looks exactly like a broken
        // extension unless it says which one it is.
        await runCycle();
        const status = await getFetchStatus();
        expect(status.state).toBe('error');
        expect(status.error).toContain('Nym');
        expect(log()).toContain('backoff');
      });

      describe('when the caller forces a refresh', () => {
        it('fetches anyway', async () => {
          // A user pressing refresh has asked for it explicitly.
          await runCycle(true);
          expect(fetchRatesWithRetry).toHaveBeenCalled();
        });
      });
    });

    describe('given the backoff window has just expired', () => {
      it('fetches again', async () => {
        // Exactly on the boundary. A window that outlasts its own deadline by
        // one cycle silently doubles every backoff.
        store.set('local:nymBackoffUntil', NOW);
        expect(await runCycle()).toBe(true);
        expect(fetchRatesWithRetry).toHaveBeenCalled();
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

    describe('given the browser cannot report platform info', () => {
      it('keeps fetching anyway', async () => {
        // The API is not on every runtime the extension ships to. A throw
        // inside the keepalive tick would abort the refresh it exists to
        // protect, turning a missing convenience into no rate at all.
        vi.stubGlobal('browser', { runtime: {} });
        let release: (value: unknown) => void = () => {};
        fetchRatesWithRetry.mockImplementation(() =>
          new Promise((resolve) => {
            release = resolve;
          })
        );
        const cycle = refreshRates(true);
        await vi.advanceTimersByTimeAsync(45_000);
        release(fetched({ USD: RATE }));
        expect(await cycle).toBe(true);
      });
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
      expect((await getFetchStatus()).state).toBe('error');
      // Named in the console so a user reading their own devtools can tell an
      // extension failure from the host page's noise.
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Zentat: Rate refresh'),
        expect.any(Error),
      );
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

      it('names them in the log', async () => {
        // A currency quietly missing from the popup is indistinguishable from
        // one the provider never quoted, so the only way to tell a dropped
        // rate from an unsupported one is to say which were dropped.
        fetchRatesWithRetry.mockResolvedValue(fetched({ USD: RATE, EUR: 99_999, GBP: 0 }));
        await runCycle(true);
        expect(log()).toContain('EUR, GBP');
      });
    });

    describe('given every currency passes the plausibility check', () => {
      it('says nothing about rejections', async () => {
        await runCycle(true);
        expect(log()).not.toContain('Rejected');
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
        expect((await getFetchStatus()).state).toBe('error');
      });
    });

    describe('given the held rate is unchanged', () => {
      it('is not rewritten', async () => {
        await runCycle(true);
        const first = await getHeldRate();
        fetchRatesWithRetry.mockResolvedValue(fetched({ USD: RATE * 1.01 }));
        // Writing the same peg back still fires every watcher, so the popup
        // and every open tab re-render on a rate that did not move.
        const writes = vi.spyOn(store, 'set');
        await runCycle(true);
        expect(await getHeldRate()).toEqual(first);
        expect(writes.mock.calls.filter(([key]) => key === 'local:heldRate')).toEqual([]);
      });

      it('says nothing about a re-peg', async () => {
        await runCycle(true);
        fetchRatesWithRetry.mockResolvedValue(fetched({ USD: RATE * 1.01 }));
        debug.mockClear();
        await runCycle(true);
        expect(log()).not.toContain('re-pegged');
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

      it('says how wide the band was', async () => {
        // The band is the accuracy bound PRIVACY.md and the options page both
        // quote. A displayed rate that jumps without naming the threshold it
        // crossed is a number the user cannot check.
        await runCycle(true);
        fetchRatesWithRetry.mockResolvedValue(fetched({ USD: RATE * 1.12 }));
        await runCycle(true);
        expect(log()).toContain('re-pegged');
        expect(log()).toContain('10%');
      });
    });

    it('reports success', async () => {
      await runCycle(true);
      expect((await getFetchStatus()).state).toBe('ok');
    });
  });
});
