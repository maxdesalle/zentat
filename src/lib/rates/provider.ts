import type { RatesData } from '../storage/rates';
import { fetchFromCoinGecko } from './coingecko';
import { fetchFromKraken } from './kraken';

export type RateProvider = () => Promise<RatesData>;

const providers: { name: string; fetch: RateProvider }[] = [
  { name: 'CoinGecko', fetch: fetchFromCoinGecko },
  { name: 'Kraken', fetch: fetchFromKraken },
];

export interface FetchResult {
  success: boolean;
  data?: RatesData;
  errors: string[];
}

export async function fetchRates(): Promise<FetchResult> {
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      const data = await provider.fetch();
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

export async function fetchRatesWithRetry(maxRetries: number = 2): Promise<FetchResult> {
  let lastResult: FetchResult = { success: false, errors: [] };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    lastResult = await fetchRates();
    if (lastResult.success) {
      return lastResult;
    }

    if (attempt < maxRetries) {
      // Exponential backoff: 1s, 2s
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  return lastResult;
}
