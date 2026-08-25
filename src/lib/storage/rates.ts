import { storage } from 'wxt/utils/storage';
import type { HeldRate } from '../rates/held';

export interface RatesData {
  // Stored as ZEC-per-fiat for fast multiplication
  // e.g., { USD: 0.025 } means 1 USD = 0.025 ZEC
  rates: Record<string, number>;
  // When each individual rate was last fetched. A merged map holds values from
  // different fetches, so one timestamp for the whole map is a lie: with the
  // CoinGecko -> Kraken fallback, ten currencies keep week-old values while the
  // map claims to be seconds old. Absent entries fall back to `updatedAt` so
  // caches written by older versions still work.
  rateUpdatedAt?: Record<string, number>;
  // Newest write across the map. Display and refresh scheduling only.
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

const heldRateItem = storage.defineItem<HeldRate | null>('local:heldRate', {
  fallback: null,
});

export async function getHeldRate(): Promise<HeldRate | null> {
  return heldRateItem.getValue();
}

export async function setHeldRate(held: HeldRate | null): Promise<void> {
  await heldRateItem.setValue(held);
}

export function watchHeldRate(callback: (held: HeldRate | null) => void): () => void {
  return heldRateItem.watch(callback);
}

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

/** Age of one currency's rate, falling back to the map-wide timestamp. */
export function rateAge(data: RatesData, currency: string): number {
  const at = data.rateUpdatedAt?.[currency.toUpperCase()] ?? data.updatedAt;
  return at ? Date.now() - at : Infinity;
}

/**
 * Whether a specific currency may still be converted. Checked per currency so
 * a stalled provider stops the currencies it stopped refreshing without taking
 * down the ones that are still current.
 */
export function isCurrencyUsable(data: RatesData, currency: string): boolean {
  if (data.rates[currency.toUpperCase()] === undefined) return false;
  return rateAge(data, currency) <= MAX_RATE_AGE_MS;
}

export function isRatesUsable(data: RatesData): boolean {
  return Object.keys(data.rates).some((code) => isCurrencyUsable(data, code));
}

// Merge freshly fetched rates over the existing cache instead of replacing it,
// so a partial result (e.g. Kraken's USD/EUR-only fallback) never wipes the
// other currencies' recent rates.
export function mergeRates(current: RatesData, incoming: RatesData): RatesData {
  // Only the currencies this fetch actually returned get a new timestamp.
  // Carrying the rest forward at their real age is what keeps the 24h cap
  // honest — otherwise pinning the rate source to Kraken freezes eleven of
  // thirteen currencies while every one of them reports as fresh.
  const rateUpdatedAt: Record<string, number> = { ...current.rateUpdatedAt };
  for (const code of Object.keys(current.rates)) {
    rateUpdatedAt[code] ??= current.updatedAt;
  }
  for (const code of Object.keys(incoming.rates)) {
    rateUpdatedAt[code] = incoming.updatedAt;
  }

  return {
    rates: { ...current.rates, ...incoming.rates },
    rateUpdatedAt,
    updatedAt: incoming.updatedAt,
    source: incoming.source,
  };
}
