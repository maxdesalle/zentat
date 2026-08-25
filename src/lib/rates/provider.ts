import type { Fetcher } from '../fetch';
import type { RatesData } from '../storage/rates';
import { fetchFromCoinGecko } from './coingecko';
import { fetchFromKraken } from './kraken';

export type RateProvider = (fetcher: Fetcher) => Promise<RatesData>;
export type RateSource = 'auto' | 'coingecko' | 'kraken';

const ALL_PROVIDERS: { name: string; key: RateSource; fetch: RateProvider }[] = [
  { name: 'CoinGecko', key: 'coingecko', fetch: fetchFromCoinGecko },
  { name: 'Kraken', key: 'kraken', fetch: fetchFromKraken },
];

/**
 * Start from a different provider each call.
 *
 * A fixed order meant the first provider saw ~100% of every user's requests and
 * therefore their complete refresh cadence — a per-IP record of when the
 * extension is running. Alternating splits that between operators so neither
 * holds the whole pattern, and it costs one line. Failover still tries all of
 * them, so reliability is unchanged.
 */
/** Exported for tests: the rotation is a privacy property, not an implementation detail. */
export function rotate<T>(items: T[]): T[] {
  if (items.length < 2) return items;
  const start = Math.floor(Math.random() * items.length);
  return [...items.slice(start), ...items.slice(0, start)];
}

export interface FetchResult {
  success: boolean;
  data?: RatesData;
  errors: string[];
}

export async function fetchRates(
  fetcher: Fetcher,
  source: RateSource = 'auto',
): Promise<FetchResult> {
  const errors: string[] = [];
  const providers = source === 'auto'
    ? rotate(ALL_PROVIDERS)
    : ALL_PROVIDERS.filter((p) => p.key === source);

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
  source?: RateSource;
}

export async function fetchRatesWithRetry(
  fetcher: Fetcher,
  options: RetryOptions = {},
): Promise<FetchResult> {
  // Fewer retries for Nym since it's already slow
  const maxRetries = options.maxRetries ?? (options.isNym ? 1 : 2);
  let lastResult: FetchResult = { success: false, errors: [] };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    lastResult = await fetchRates(fetcher, options.source ?? 'auto');
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
