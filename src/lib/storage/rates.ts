import { storage } from 'wxt/utils/storage';

export interface RatesData {
  // Stored as ZEC-per-fiat for fast multiplication
  // e.g., { USD: 0.025 } means 1 USD = 0.025 ZEC
  rates: Record<string, number>;
  updatedAt: number;
  source: string;
}

const DEFAULT_RATES: RatesData = {
  rates: {},
  updatedAt: 0,
  source: '',
};

const ratesItem = storage.defineItem<RatesData>('local:rates', {
  fallback: DEFAULT_RATES,
});

export async function getRates(): Promise<RatesData> {
  return ratesItem.getValue();
}

export async function setRates(data: RatesData): Promise<void> {
  await ratesItem.setValue(data);
}

export function watchRates(callback: (data: RatesData) => void): () => void {
  return ratesItem.watch(callback);
}

export function isRatesStale(data: RatesData, maxAgeMs: number = 10 * 60 * 1000): boolean {
  if (!data.updatedAt) return true;
  return Date.now() - data.updatedAt > maxAgeMs;
}

export function convertToZec(amount: number, currency: string, rates: RatesData): number | null {
  const rate = rates.rates[currency.toUpperCase()];
  if (rate === undefined) return null;
  return amount * rate;
}
