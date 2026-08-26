import { describe, expect, it } from 'vitest';
import { fetchFromCoinGecko } from '../../src/lib/rates/coingecko';
import { fetcherReturning } from '../helpers/rate-fetcher';

// Spec: tests/trees/coingecko.tree

describe('fetchFromCoinGecko', () => {
  describe('given a successful response', () => {
    it('converts fiat-per-ZEC to ZEC-per-fiat', async () => {
      // Stored inverted so conversion is a multiply. Getting this backwards is
      // a 640,000x error at ZEC ≈ $800 and reads as a plausible number.
      const { fetcher } = fetcherReturning({
        'api.coingecko.com': { ok: true, body: { zcash: { usd: 800, eur: 750 } } },
      });
      const data = await fetchFromCoinGecko(fetcher);
      expect(data.rates.USD).toBeCloseTo(1 / 800);
      expect(data.rates.EUR).toBeCloseTo(1 / 750);
    });

    it('upper-cases the currency codes', async () => {
      const { fetcher } = fetcherReturning({
        'api.coingecko.com': { ok: true, body: { zcash: { usd: 800 } } },
      });
      expect(Object.keys((await fetchFromCoinGecko(fetcher)).rates)).toEqual(['USD']);
    });

    it('names itself as the source', async () => {
      const { fetcher } = fetcherReturning({
        'api.coingecko.com': { ok: true, body: { zcash: { usd: 800 } } },
      });
      expect((await fetchFromCoinGecko(fetcher)).source).toBe('coingecko');
    });
  });

  describe('given a price that is not usable', () => {
    it('filters zero/negative/non-numeric prices', async () => {
      const { fetcher } = fetcherReturning({
        'api.coingecko.com': { ok: true, body: { zcash: { usd: 0, eur: -5, gbp: 'x', jpy: 100 } } },
      });
      expect(Object.keys((await fetchFromCoinGecko(fetcher)).rates)).toEqual(['JPY']);
    });
  });

  describe('given ZEC data is missing', () => {
    it('throws', async () => {
      const { fetcher } = fetcherReturning({ 'api.coingecko.com': { ok: true, body: {} } });
      await expect(fetchFromCoinGecko(fetcher)).rejects.toThrow('No ZEC price data');
    });
  });

  describe('given an HTTP error', () => {
    it('throws', async () => {
      const { fetcher } = fetcherReturning({ 'api.coingecko.com': { ok: false, status: 429 } });
      await expect(fetchFromCoinGecko(fetcher)).rejects.toThrow('429');
    });
  });
});
