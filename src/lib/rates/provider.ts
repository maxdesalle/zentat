import type { Fetcher } from '../fetch';
import type { RatesData } from '../storage/rates';
import { fetchFromCoinGecko } from './coingecko';
import { fetchFromKraken } from './kraken';

export type RateProvider = (fetcher: Fetcher) => Promise<RatesData>;

const providers: { name: string; fetch: RateProvider }[] = [
  { name: 'CoinGecko', fetch: fetchFromCoinGecko },
  { name: 'Kraken', fetch: fetchFromKraken },
];

export interface FetchResult {
  success: boolean;
  data?: RatesData;
  errors: string[];
}

export async function fetchRates(fetcher: Fetcher): Promise<FetchResult> {
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      const data = await provider.fetch(fetcher);
      if (Object.keys(data.rates).length > 0) {
        return { success: true, data, errors };
      }
      errors.push(`${provider.name}: No rates returned`);
    } catch (error) {
      errors.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { success: false, errors };
}

export interface RetryOptions {
  maxRetries?: number;
  isNym?: boolean;
}

export async function fetchRatesWithRetry(
  fetcher: Fetcher,
  options: RetryOptions = {}
): Promise<FetchResult> {
  // Fewer retries for Nym since it's already slow
  const maxRetries = options.maxRetries ?? (options.isNym ? 1 : 2);
  let lastResult: FetchResult = { success: false, errors: [] };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    lastResult = await fetchRates(fetcher);
    if (lastResult.success) {
      return lastResult;
    }

    if (attempt < maxRetries) {
      // Exponential backoff: 1s, 2s (shorter for Nym)
      const delay = options.isNym ? 2000 : 1000 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return lastResult;
}
