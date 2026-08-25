import { describe, expect, it } from 'vitest';
import type { Fetcher } from '../../src/lib/fetch/types';
import { fetchFromCoinGecko } from '../../src/lib/rates/coingecko';
import { fetchFromKraken } from '../../src/lib/rates/kraken';
import { fetchRates } from '../../src/lib/rates/provider';

function fetcherReturning(
  byHost: Record<string, { ok: boolean; status?: number; body?: unknown }>,
): {
  fetcher: Fetcher;
  calls: string[];
} {
  const calls: string[] = [];
  const fetcher: Fetcher = {
    async fetch(url: string) {
      calls.push(url);
      const host = new URL(url).hostname;
      const spec = byHost[host];
      if (!spec) throw new Error(`Unexpected host: ${host}`);
      return {
        ok: spec.ok,
        status: spec.status ?? (spec.ok ? 200 : 500),
        json: async () => spec.body,
      };
    },
  };
  return { fetcher, calls };
}

// Captured shape of a real Kraken response: pairs are renamed with X/Z
// asset-class prefixes (request ZECUSD → response key XZECZUSD). The old code
// looked up ZECUSD/XZECUSD and therefore never matched anything.
const KRAKEN_FIXTURE = {
  error: [],
  result: {
    XZECZUSD: { c: ['800.50', '1.000'] as [string, string] },
    XZECZEUR: { c: ['750.25', '1.000'] as [string, string] },
  },
};

describe('fetchFromCoinGecko', () => {
  it('converts fiat-per-ZEC to ZEC-per-fiat', async () => {
    const { fetcher } = fetcherReturning({
      'api.coingecko.com': { ok: true, body: { zcash: { usd: 800, eur: 750 } } },
    });
    const data = await fetchFromCoinGecko(fetcher);
    expect(data.rates.USD).toBeCloseTo(1 / 800);
    expect(data.rates.EUR).toBeCloseTo(1 / 750);
    expect(data.source).toBe('coingecko');
  });

  it('filters zero/negative/non-numeric prices', async () => {
    const { fetcher } = fetcherReturning({
      'api.coingecko.com': { ok: true, body: { zcash: { usd: 0, eur: -5, gbp: 'x', jpy: 100 } } },
    });
    const data = await fetchFromCoinGecko(fetcher);
    expect(Object.keys(data.rates)).toEqual(['JPY']);
  });

  it('throws when ZEC data is missing', async () => {
    const { fetcher } = fetcherReturning({ 'api.coingecko.com': { ok: true, body: {} } });
    await expect(fetchFromCoinGecko(fetcher)).rejects.toThrow('No ZEC price data');
  });

  it('throws on HTTP errors', async () => {
    const { fetcher } = fetcherReturning({ 'api.coingecko.com': { ok: false, status: 429 } });
    await expect(fetchFromCoinGecko(fetcher)).rejects.toThrow('429');
  });
});

describe('fetchFromKraken', () => {
  it('parses the real X/Z-prefixed pair keys', async () => {
    const { fetcher } = fetcherReturning({ 'api.kraken.com': { ok: true, body: KRAKEN_FIXTURE } });
    const data = await fetchFromKraken(fetcher);
    expect(data.rates.USD).toBeCloseTo(1 / 800.5);
    expect(data.rates.EUR).toBeCloseTo(1 / 750.25);
    expect(data.source).toBe('kraken');
  });

  it('also accepts unprefixed pair keys', async () => {
    const { fetcher } = fetcherReturning({
      'api.kraken.com': {
        ok: true,
        body: { result: { ZECUSD: { c: ['800.50', '1'] } } },
      },
    });
    const data = await fetchFromKraken(fetcher);
    expect(data.rates.USD).toBeCloseTo(1 / 800.5);
  });

  it('throws on API-level errors', async () => {
    const { fetcher } = fetcherReturning({
      'api.kraken.com': { ok: true, body: { error: ['EGeneral:Invalid arguments'] } },
    });
    await expect(fetchFromKraken(fetcher)).rejects.toThrow('Invalid arguments');
  });

  it('throws when no usable pairs are present', async () => {
    const { fetcher } = fetcherReturning({
      'api.kraken.com': { ok: true, body: { result: {} } },
    });
    await expect(fetchFromKraken(fetcher)).rejects.toThrow('No valid rate data');
  });
});

describe('fetchRates', () => {
  it('falls back from CoinGecko to Kraken', async () => {
    // Provider order is rotated per call, so pin the source to make this test
    // about failover rather than about which operator happens to go first.
    const { fetcher, calls } = fetcherReturning({
      'api.coingecko.com': { ok: false, status: 429 },
      'api.kraken.com': { ok: true, body: KRAKEN_FIXTURE },
    });
    let result = await fetchRates(fetcher);
    // Retry once if rotation happened to start at the healthy provider.
    if (calls.length === 1) result = await fetchRates(fetcher);

    expect(result.success).toBe(true);
    expect(result.data?.source).toBe('kraken');
    expect(result.errors.some((e) => e.includes('CoinGecko'))).toBe(true);
  });

  it('honors a pinned rate source', async () => {
    const { fetcher, calls } = fetcherReturning({
      'api.coingecko.com': { ok: false, status: 500 },
      'api.kraken.com': { ok: true, body: KRAKEN_FIXTURE },
    });
    const result = await fetchRates(fetcher, 'coingecko');
    expect(result.success).toBe(false);
    // Never contacted Kraken when pinned to CoinGecko
    expect(calls.every((u) => u.includes('coingecko'))).toBe(true);
  });

  it('reports all provider errors on total failure', async () => {
    const { fetcher } = fetcherReturning({
      'api.coingecko.com': { ok: false, status: 500 },
      'api.kraken.com': { ok: false, status: 503 },
    });
    const result = await fetchRates(fetcher);
    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(2);
  });
});

describe('provider rotation', () => {
  it('does not always start with the same operator', async () => {
    // A fixed order gives the first provider a complete per-IP record of when
    // the extension refreshes.
    const firstContacted = new Set<string>();

    for (let i = 0; i < 60; i++) {
      let first: string | null = null;
      const fetcher = {
        fetch: async (url: string) => {
          first ??= new URL(url).hostname;
          throw new Error('unreachable');
        },
      };
      await fetchRates(fetcher, 'auto');
      if (first) firstContacted.add(first);
    }

    expect(firstContacted.size).toBe(2);
  });

  it('still tries every provider before giving up', async () => {
    const seen = new Set<string>();
    const fetcher = {
      fetch: async (url: string) => {
        seen.add(new URL(url).hostname);
        throw new Error('unreachable');
      },
    };
    const result = await fetchRates(fetcher, 'auto');
    expect(result.success).toBe(false);
    expect(seen.size).toBe(2);
  });
});
