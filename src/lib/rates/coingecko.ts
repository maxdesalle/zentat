import { CURRENCY_CODES } from '../currencies';
import type { Fetcher } from '../fetch';
import type { RatesData } from '../storage/rates';

const COINGECKO_API = 'https://api.coingecko.com/api/v3/simple/price';

export async function fetchFromCoinGecko(fetcher: Fetcher): Promise<RatesData> {
  const params = new URLSearchParams({
    ids: 'zcash',
    // Always request the full supported list (never the user's selection) so
    // the request reveals nothing about the user's configuration.
    vs_currencies: CURRENCY_CODES.map((c) => c.toLowerCase()).join(','),
  });

  const response = await fetcher.fetch(`${COINGECKO_API}?${params}`);
  if (!response.ok) {
    throw new Error(`CoinGecko API error: ${response.status}`);
  }

  const data = (await response.json()) as { zcash?: Record<string, number> };
  const zecPrices = data.zcash;

  if (!zecPrices) {
    throw new Error('CoinGecko: No ZEC price data');
  }

  // Convert fiat-per-ZEC to ZEC-per-fiat (reciprocal)
  const rates: Record<string, number> = {};
  for (const [currency, price] of Object.entries(zecPrices)) {
    if (typeof price === 'number' && price > 0) {
      rates[currency.toUpperCase()] = 1 / price;
    }
  }

  return {
    rates,
    updatedAt: Date.now(),
    source: 'coingecko',
  };
}
