import { storage } from 'wxt/utils/storage';

export interface RatesData {
  // Stored as ZEC-per-fiat for fast multiplication
  // e.g., { USD: 0.025 } means 1 USD = 0.025 ZEC
  rates: Record<string, number>;
  updatedAt: number;
  source: string;
}

export type RateFetchState = 'idle' | 'fetching' | 'ok' | 'error';

export interface RateFetchStatus {
  state: RateFetchState;
  error?: string;
  changedAt: number;
}

// Single source of truth for refresh cadence:
// - rates older than REFRESH_TTL_MS are considered stale and re-fetched
// - the background alarm fires at roughly REFRESH_TTL_MS / 2 so a failed
//   fetch gets a retry within one TTL window
// - conversions older than MAX_RATE_AGE_MS are not applied at all
export const REFRESH_TTL_MS = 10 * 60 * 1000;
export const MAX_RATE_AGE_MS = 24 * 60 * 60 * 1000;

const DEFAULT_RATES: RatesData = {
  rates: {},
  updatedAt: 0,
  source: '',
};

const ratesItem = storage.defineItem<RatesData>('local:rates', {
  fallback: DEFAULT_RATES,
});

const fetchStatusItem = storage.defineItem<RateFetchStatus>('local:rateFetchStatus', {
  fallback: { state: 'idle', changedAt: 0 },
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

export async function getFetchStatus(): Promise<RateFetchStatus> {
  return fetchStatusItem.getValue();
}

export async function setFetchStatus(state: RateFetchState, error?: string): Promise<void> {
  await fetchStatusItem.setValue({ state, error, changedAt: Date.now() });
}

export function watchFetchStatus(callback: (status: RateFetchStatus) => void): () => void {
  return fetchStatusItem.watch(callback);
}

export function isRatesStale(data: RatesData, maxAgeMs: number = REFRESH_TTL_MS): boolean {
  if (!data.updatedAt) return true;
  return Date.now() - data.updatedAt > maxAgeMs;
}

export function isRatesUsable(data: RatesData): boolean {
  if (Object.keys(data.rates).length === 0) return false;
  if (!data.updatedAt) return false;
  return Date.now() - data.updatedAt <= MAX_RATE_AGE_MS;
}

// Merge freshly fetched rates over the existing cache instead of replacing it,
// so a partial result (e.g. Kraken's USD/EUR-only fallback) never wipes the
// other currencies' recent rates.
export function mergeRates(current: RatesData, incoming: RatesData): RatesData {
  return {
    rates: { ...current.rates, ...incoming.rates },
    updatedAt: incoming.updatedAt,
    source: incoming.source,
  };
}
