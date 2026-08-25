import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Spec: tests/trees/provider.tree

const fetchFromCoinGecko = vi.fn();
const fetchFromKraken = vi.fn();
vi.mock('../../src/lib/rates/coingecko', () => ({ fetchFromCoinGecko }));
vi.mock('../../src/lib/rates/kraken', () => ({ fetchFromKraken }));

const { fetchRates, fetchRatesWithRetry, rotate } = await import('../../src/lib/rates/provider');

const fetcher = { fetch: vi.fn() } as never;

function rates(source: string, map: Record<string, number> = { USD: 0.025 }) {
  return { rates: map, updatedAt: 1, source };
}

/** Force the rotation to start at a known provider. */
function startWith(index: number) {
  vi.spyOn(Math, 'random').mockReturnValue(index / 2);
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchFromCoinGecko.mockResolvedValue(rates('coingecko'));
  fetchFromKraken.mockResolvedValue(rates('kraken'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rotate', () => {
  describe('given a single item', () => {
    it('returns it unchanged', () => {
      expect(rotate(['only'])).toEqual(['only']);
    });
  });

  describe('given no items', () => {
    it('returns nothing', () => {
      expect(rotate([])).toEqual([]);
    });
  });

  describe('given several items', () => {
    it('keeps every item', () => {
      startWith(1);
      expect(rotate(['a', 'b', 'c']).sort()).toEqual(['a', 'b', 'c']);
    });

    it('starts somewhere else', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      expect(rotate(['a', 'b'])).toEqual(['b', 'a']);
    });
  });
});

describe('fetchRates', () => {
  describe('given the source is a specific provider', () => {
    it('uses only that provider', async () => {
      const result = await fetchRates(fetcher, 'kraken');
      expect(result.data?.source).toBe('kraken');
      expect(fetchFromCoinGecko).not.toHaveBeenCalled();
    });

    describe('given that provider fails', () => {
      it('does not fall back to the other one', async () => {
        // Pinning a source is a privacy choice: the user has decided which
        // operator sees their traffic. Silently using the other one overrides
        // that without telling them.
        fetchFromKraken.mockRejectedValue(new Error('down'));
        const result = await fetchRates(fetcher, 'kraken');
        expect(result.success).toBe(false);
        expect(fetchFromCoinGecko).not.toHaveBeenCalled();
      });
    });
  });

  describe('given the source is auto', () => {
    it('does not always start with the same provider', async () => {
      // A fixed order gives the first operator a per-IP record of the user's
      // complete refresh cadence.
      const firstCalls = new Set<string>();
      vi.spyOn(Math, 'random').mockRestore();
      for (let i = 0; i < 50; i++) {
        vi.clearAllMocks();
        await fetchRates(fetcher);
        firstCalls.add(fetchFromCoinGecko.mock.calls.length > 0 ? 'coingecko' : 'kraken');
      }
      expect(firstCalls.size).toBe(2);
    });

    describe('given the first provider it tries succeeds', () => {
      it('does not call the other one', async () => {
        startWith(0);
        await fetchRates(fetcher);
        expect(fetchFromKraken).not.toHaveBeenCalled();
      });
    });

    describe('given the first provider it tries fails', () => {
      it('falls back to the other one', async () => {
        startWith(0);
        fetchFromCoinGecko.mockRejectedValue(new Error('429'));
        const result = await fetchRates(fetcher);
        expect(result.success).toBe(true);
        expect(result.data?.source).toBe('kraken');
      });

      it('reports the first failure alongside the success', async () => {
        startWith(0);
        fetchFromCoinGecko.mockRejectedValue(new Error('429'));
        const result = await fetchRates(fetcher);
        expect(result.errors).toEqual(['CoinGecko: 429']);
      });
    });

    describe('given a provider returns an empty map', () => {
      it('treats that as a failure', async () => {
        startWith(0);
        fetchFromCoinGecko.mockResolvedValue(rates('coingecko', {}));
        const result = await fetchRates(fetcher);
        expect(result.errors).toContain('CoinGecko: No rates returned');
      });

      it('falls back to the other one', async () => {
        startWith(0);
        fetchFromCoinGecko.mockResolvedValue(rates('coingecko', {}));
        expect((await fetchRates(fetcher)).data?.source).toBe('kraken');
      });
    });

    describe('given a provider rejects with something that is not an Error', () => {
      it('still records a readable message', async () => {
        startWith(1);
        fetchFromKraken.mockRejectedValue('socket hang up');
        fetchFromCoinGecko.mockRejectedValue('socket hang up');
        const result = await fetchRates(fetcher);
        expect(result.errors).toContain('Kraken: socket hang up');
      });
    });

    describe('given every provider fails', () => {
      it('reports failure', async () => {
        fetchFromCoinGecko.mockRejectedValue(new Error('a'));
        fetchFromKraken.mockRejectedValue(new Error('b'));
        const result = await fetchRates(fetcher);
        expect(result.success).toBe(false);
        expect(result.data).toBeUndefined();
      });

      it('reports every error', async () => {
        fetchFromCoinGecko.mockRejectedValue(new Error('a'));
        fetchFromKraken.mockRejectedValue(new Error('b'));
        const result = await fetchRates(fetcher);
        expect(result.errors).toHaveLength(2);
      });
    });
  });
});

describe('fetchRatesWithRetry', () => {
  /** Runs the call with timers faked, returning the delays it waited on. */
  async function withDelays(run: () => Promise<unknown>) {
    vi.useFakeTimers();
    const delays: number[] = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms: number) => {
      delays.push(ms);
      fn();
      return 0;
    }) as never);
    const result = await run();
    vi.useRealTimers();
    return { result, delays };
  }

  beforeEach(() => startWith(0));

  describe('given the first attempt succeeds', () => {
    it('does not retry', async () => {
      await fetchRatesWithRetry(fetcher);
      expect(fetchFromCoinGecko).toHaveBeenCalledOnce();
    });
  });

  describe('given an early attempt fails', () => {
    it('retries', async () => {
      fetchFromCoinGecko.mockRejectedValueOnce(new Error('a'));
      fetchFromKraken.mockRejectedValueOnce(new Error('b'));
      const { result } = await withDelays(() => fetchRatesWithRetry(fetcher));
      expect((result as { success: boolean }).success).toBe(true);
    });

    it('backs off between attempts', async () => {
      fetchFromCoinGecko.mockRejectedValue(new Error('a'));
      fetchFromKraken.mockRejectedValue(new Error('b'));
      const { delays } = await withDelays(() => fetchRatesWithRetry(fetcher));
      expect(delays).toEqual([1000, 2000]);
    });
  });

  describe('given the transport is Nym', () => {
    it('retries fewer times', async () => {
      // A mixnet round trip is already tens of seconds; three of them is a
      // refresh that outlives the alarm that scheduled it.
      fetchFromCoinGecko.mockRejectedValue(new Error('a'));
      fetchFromKraken.mockRejectedValue(new Error('b'));
      await withDelays(() => fetchRatesWithRetry(fetcher, { isNym: true }));
      expect(fetchFromCoinGecko).toHaveBeenCalledTimes(2);
    });

    it('uses a flat backoff', async () => {
      fetchFromCoinGecko.mockRejectedValue(new Error('a'));
      fetchFromKraken.mockRejectedValue(new Error('b'));
      const { delays } = await withDelays(() => fetchRatesWithRetry(fetcher, { isNym: true }));
      expect(delays).toEqual([2000]);
    });
  });

  describe('when a retry count is given', () => {
    it('overrides the transport default', async () => {
      fetchFromCoinGecko.mockRejectedValue(new Error('a'));
      fetchFromKraken.mockRejectedValue(new Error('b'));
      await withDelays(() => fetchRatesWithRetry(fetcher, { isNym: true, maxRetries: 0 }));
      expect(fetchFromCoinGecko).toHaveBeenCalledOnce();
    });
  });

  describe('given every attempt fails', () => {
    it('returns the last result', async () => {
      fetchFromCoinGecko.mockRejectedValue(new Error('a'));
      fetchFromKraken.mockRejectedValue(new Error('b'));
      const { result } = await withDelays(() => fetchRatesWithRetry(fetcher, { maxRetries: 0 }));
      expect(result).toEqual({ success: false, errors: ['CoinGecko: a', 'Kraken: b'] });
    });
  });

  describe('given a specific source', () => {
    it('passes that source through to every attempt', async () => {
      fetchFromKraken.mockRejectedValue(new Error('down'));
      await withDelays(() => fetchRatesWithRetry(fetcher, { source: 'kraken' }));
      expect(fetchFromCoinGecko).not.toHaveBeenCalled();
      expect(fetchFromKraken).toHaveBeenCalledTimes(3);
    });
  });
});
