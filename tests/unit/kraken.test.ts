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
  });

  describe('given a key that is not a ZEC pair', () => {
    it('ignores that key', async () => {
      // The ticker endpoint answers with whatever pairs it feels like when a
      // request is partially malformed.
      const data = await fetchFromKraken(kraken({
        result: { XXBTZUSD: { c: ['60000', '1'] }, XZECZUSD: { c: ['800.50', '1'] } },
      }));
      expect(Object.keys(data.rates)).toEqual(['USD']);
    });
  });

  describe('given the same currency appears twice', () => {
    it('keeps the first', async () => {
      // Two keys can end with the same quote currency. Overwriting would make
      // the rate depend on object key order.
      const data = await fetchFromKraken(kraken({
        result: { XZECZUSD: { c: ['800.50', '1'] }, ZECUSD: { c: ['900.00', '1'] } },
      }));
      expect(data.rates.USD).toBeCloseTo(1 / 800.5);
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
