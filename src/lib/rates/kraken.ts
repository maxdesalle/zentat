import type { RatesData } from '../storage/rates';

const KRAKEN_API = 'https://api.kraken.com/0/public/Ticker';

// Kraken trading pairs for ZEC
const KRAKEN_PAIRS: Record<string, string> = {
  USD: 'ZECUSD',
  EUR: 'ZECEUR',
};

export async function fetchFromKraken(): Promise<RatesData> {
  const pairs = Object.values(KRAKEN_PAIRS).join(',');
  const response = await fetch(`${KRAKEN_API}?pair=${pairs}`);

  if (!response.ok) {
    throw new Error(`Kraken API error: ${response.status}`);
  }

  const data = await response.json();

  if (data.error?.length > 0) {
    throw new Error(`Kraken API error: ${data.error.join(', ')}`);
  }

  const rates: Record<string, number> = {};

  for (const [currency, pair] of Object.entries(KRAKEN_PAIRS)) {
    // Kraken uses different key formats, try both
    const tickerData = data.result[pair] || data.result[`X${pair}`];
    if (tickerData) {
      // 'c' is the last trade closed [price, lot volume]
      const price = parseFloat(tickerData.c[0]);
      if (price > 0) {
        rates[currency] = 1 / price;
      }
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
