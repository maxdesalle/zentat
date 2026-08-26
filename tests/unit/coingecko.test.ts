import { describe, expect, it } from 'vitest';
import { CURRENCY_CODES } from '../../src/lib/currencies';
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

    it('asks for every supported currency whatever the user has chosen', async () => {
      // The request looks identical for every user. Narrowing it to the
      // currencies actually on screen would hand CoinGecko a fingerprint of
      // where the user lives and what they are reading.
      const { calls, fetcher } = fetcherReturning({
        'api.coingecko.com': { ok: true, body: { zcash: { usd: 800 } } },
      });
      await fetchFromCoinGecko(fetcher);
      const params = new URL(calls[0]).searchParams;
      expect(params.get('ids')).toBe('zcash');
      expect(params.get('vs_currencies')).toBe(CURRENCY_CODES.join(',').toLowerCase());
    });
  });

  describe('given a price that is not usable', () => {
    it('filters zero/negative/non-numeric prices', async () => {
      const { fetcher } = fetcherReturning({
        'api.coingecko.com': { ok: true, body: { zcash: { usd: 0, eur: -5, gbp: 'x', jpy: 100 } } },
      });
      expect(Object.keys((await fetchFromCoinGecko(fetcher)).rates)).toEqual(['JPY']);
    });

    it('refuses a price that arrives as a string', async () => {
      // JavaScript compares "800" > 0 happily, so the type check is the only
      // thing standing between a payload we no longer recognise and a rate.
      const { fetcher } = fetcherReturning({
        'api.coingecko.com': { ok: true, body: { zcash: { usd: '800' } } },
      });
      expect((await fetchFromCoinGecko(fetcher)).rates).toEqual({});
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
