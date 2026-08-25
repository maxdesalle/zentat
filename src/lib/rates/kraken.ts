import type { Fetcher } from '../fetch';
import type { RatesData } from '../storage/rates';

interface KrakenResponse {
  error?: string[];
  result?: Record<string, { c: [string, string] }>;
}

const KRAKEN_API = 'https://api.kraken.com/0/public/Ticker';

// Kraken trading pairs for ZEC. Note Kraken only lists USD/EUR pairs for ZEC,
// so this provider covers a subset of the supported currencies — the caller
// merges its result over the existing cache rather than replacing it.
const KRAKEN_PAIRS: Record<string, string> = {
  USD: 'ZECUSD',
  EUR: 'ZECEUR',
};

export async function fetchFromKraken(fetcher: Fetcher): Promise<RatesData> {
  const pairs = Object.values(KRAKEN_PAIRS).join(',');
  const response = await fetcher.fetch(`${KRAKEN_API}?pair=${pairs}`);

  if (!response.ok) {
    throw new Error(`Kraken API error: ${response.status}`);
  }

  const data = (await response.json()) as KrakenResponse;

  if (data.error?.length) {
    throw new Error(`Kraken API error: ${data.error.join(', ')}`);
  }

  const rates: Record<string, number> = {};

  // Kraken renames pairs in responses using X/Z asset-class prefixes: a request
  // for ZECUSD comes back keyed "XZECZUSD". Match keys structurally (contains
  // ZEC + ends with the quote currency) instead of guessing exact key names.
  for (const [key, tickerData] of Object.entries(data.result ?? {})) {
    if (!key.includes('ZEC')) continue;
    const currency = Object.keys(KRAKEN_PAIRS).find((c) => key.endsWith(c));
    if (!currency || rates[currency] !== undefined) continue;

    // 'c' is the last trade closed [price, lot volume]
    const price = parseFloat(tickerData.c?.[0]);
    if (price > 0) {
      rates[currency] = 1 / price;
    }
  }

  if (Object.keys(rates).length === 0) {
    throw new Error('Kraken: No valid rate data');
  }

  return {
    rates,
    updatedAt: Date.now(),
    source: 'kraken',
  };
}
