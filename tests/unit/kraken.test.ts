import { describe, expect, it } from 'vitest';
import { fetchFromKraken } from '../../src/lib/rates/kraken';
import { fetcherReturning } from '../helpers/rate-fetcher';

// Spec: tests/trees/kraken.tree

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

const kraken = (body: unknown, ok = true, status?: number) =>
  fetcherReturning({ 'api.kraken.com': { ok, status, body } }).fetcher;

describe('fetchFromKraken', () => {
  describe('given a successful response', () => {
    it('parses the real X/Z-prefixed pair keys', async () => {
      const data = await fetchFromKraken(kraken(KRAKEN_FIXTURE));
      expect(Object.keys(data.rates).sort()).toEqual(['EUR', 'USD']);
    });

    it('also accepts unprefixed pair keys', async () => {
      const data = await fetchFromKraken(kraken({ result: { ZECUSD: { c: ['800.50', '1'] } } }));
      expect(data.rates.USD).toBeCloseTo(1 / 800.5);
    });

    it('inverts the quote into ZEC-per-fiat', async () => {
      const data = await fetchFromKraken(kraken(KRAKEN_FIXTURE));
      expect(data.rates.USD).toBeCloseTo(1 / 800.5);
      expect(data.rates.EUR).toBeCloseTo(1 / 750.25);
    });

    it('names itself as the source', async () => {
      expect((await fetchFromKraken(kraken(KRAKEN_FIXTURE))).source).toBe('kraken');
    });

    it('asks for both ZEC pairs in one request', async () => {
      // Kraken answers one pair per name in this parameter. Drop a name and
      // that currency silently stops refreshing while the cache keeps serving
      // a stale rate, which is the shape of every wrong-price bug we have had.
      const { calls, fetcher } = fetcherReturning({
        'api.kraken.com': { ok: true, body: KRAKEN_FIXTURE },
      });
      await fetchFromKraken(fetcher);
      expect(calls).toEqual(['https://api.kraken.com/0/public/Ticker?pair=ZECUSD,ZECEUR']);
    });
  });

  describe('given a key that is not a ZEC pair', () => {
    it('ignores that key', async () => {
      // The ticker endpoint answers with whatever pairs it feels like when a
      // request is partially malformed.
      const data = await fetchFromKraken(kraken({
        result: { XXBTZUSD: { c: ['60000', '1'] }, XZECZUSD: { c: ['800.50', '1'] } },
      }));
      expect(Object.keys(data.rates)).toEqual(['USD']);
      // A bitcoin quote also ends with "USD"; taking it would price everything
      // on the page against BTC.
      expect(data.rates.USD).toBe(1 / 800.5);
    });
  });

  describe('given a ZEC pair quoted in something we do not track', () => {
    it('ignores that pair', async () => {
      // ZEC/XBT is a real Kraken pair. It has no currency to file itself under,
      // and a rate stored under a made-up key is a rate nothing can reconcile.
      const data = await fetchFromKraken(kraken({
        result: { XZECXXBT: { c: ['0.0130', '1'] }, XZECZUSD: { c: ['800.50', '1'] } },
      }));
      expect(Object.keys(data.rates)).toEqual(['USD']);
    });
  });

  describe('given the same currency appears twice', () => {
    it('keeps the first', async () => {
      // Two keys can end with the same quote currency. Overwriting would make
      // the rate depend on object key order. Compared exactly: inverted rates
      // are small enough that a 12% error still looks close to zero.
      const data = await fetchFromKraken(kraken({
        result: { XZECZUSD: { c: ['800.50', '1'] }, ZECUSD: { c: ['900.00', '1'] } },
      }));
      expect(data.rates.USD).toBe(1 / 800.5);
    });
  });

  describe('given a pair with no usable price', () => {
    it('ignores that pair', async () => {
      const data = await fetchFromKraken(kraken({
        result: { XZECZEUR: { c: ['0', '1'] }, XZECZUSD: { c: ['800.50', '1'] } },
      }));
      expect(Object.keys(data.rates)).toEqual(['USD']);
    });
  });

  describe('given a pair with no last trade data', () => {
    it('ignores that pair', async () => {
      // A freshly listed pair comes back without a close price. Reading through
      // it would take the whole refresh down and leave every currency stale.
      const data = await fetchFromKraken(kraken({
        result: { XZECZEUR: {}, XZECZUSD: { c: ['800.50', '1'] } },
      }));
      expect(Object.keys(data.rates)).toEqual(['USD']);
    });
  });

  describe('given the response has no result at all', () => {
    it('throws', async () => {
      await expect(fetchFromKraken(kraken({}))).rejects.toThrow('No valid rate data');
    });
  });

  describe('given an API-level error', () => {
    it('throws', async () => {
      await expect(fetchFromKraken(kraken({ error: ['EGeneral:Invalid arguments'] })))
        .rejects.toThrow('Invalid arguments');
    });
  });

  describe('given several API-level errors', () => {
    it('throws naming every one of them', async () => {
      await expect(
        fetchFromKraken(kraken({ error: ['EAPI:Rate limit exceeded', 'EQuery:Unknown asset'] })),
      ).rejects.toThrow('EAPI:Rate limit exceeded, EQuery:Unknown asset');
    });
  });

  describe('given no usable pairs are present', () => {
    it('throws', async () => {
      await expect(fetchFromKraken(kraken({ result: {} }))).rejects.toThrow('No valid rate data');
    });
  });

  describe('given an HTTP error', () => {
    it('throws', async () => {
      await expect(fetchFromKraken(kraken(null, false, 503))).rejects.toThrow('503');
    });
  });
});
