import type { RatesData } from './storage/rates';

/**
 * A thing the user actually buys, priced once so every other price can be
 * expressed against it.
 *
 * This is the answer to ZEC's volatility, not a workaround for it. Every price
 * on a page converts at the same rate, so RATIOS between them are exactly
 * preserved no matter what ZEC does — "this laptop = 1,200 coffees" is true
 * today and still true after a 40% move. A memorised level ("coffee = 0.02 ZEC")
 * decays within weeks. Ratios are the only part of a volatile unit of account
 * that a person can actually learn.
 */
export interface Anchor {
  id: string;
  label: string;
  /** What it costs, in the currency the user thinks about it in. */
  amount: number;
  currency: string;
  /** ZEC price when the anchor was set, so drift can be surfaced. */
  zecWhenSet: number;
}

export const MAX_ANCHORS = 8;
/** How far an anchor may move in ZEC terms before it is worth re-looking. */
export const DRIFT_THRESHOLD = 0.2;

/** An anchor's cost in ZEC at the current rate, or null if we can't price it. */
export function anchorZecValue(anchor: Anchor, rates: RatesData): number | null {
  const rate = rates.rates[anchor.currency.toUpperCase()];
  if (rate === undefined || !(anchor.amount > 0)) return null;
  const value = anchor.amount * rate;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export interface Comparison {
  anchor: Anchor;
  count: number;
}

// A comparison only helps inside a range a person can picture. "0.003 rents"
// and "84,000 coffees" both fail at the one job the feature has.
const MIN_USEFUL_COUNT = 0.2;
const MAX_USEFUL_COUNT = 5_000;

/**
 * Express a ZEC amount as multiples of the user's anchors, best first.
 *
 * "Best" is the count closest to 1 on a log scale — the multiple a person can
 * hold in their head.
 */
export function compareToAnchors(
  zecAmount: number,
  anchors: Anchor[],
  rates: RatesData,
  limit = 2,
): Comparison[] {
  if (!(zecAmount > 0)) return [];

  const scored: Array<Comparison & { distance: number }> = [];
  for (const anchor of anchors) {
    const value = anchorZecValue(anchor, rates);
    if (value === null) continue;
    const count = zecAmount / value;
    if (count < MIN_USEFUL_COUNT || count > MAX_USEFUL_COUNT) continue;
    scored.push({ anchor, count, distance: Math.abs(Math.log10(count)) });
  }

  return scored
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(({ anchor, count }) => ({ anchor, count }));
}

/** Round a multiple to something speakable: "14 coffees", not "13.87 coffees". */
export function formatCount(count: number, locale?: string): string {
  const digits = count >= 100 ? 0 : count >= 10 ? 0 : count >= 1 ? 1 : 2;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(count);
}

/** "≈ 14 coffees · 0.4 rent" */
export function formatComparisons(comparisons: Comparison[], locale?: string): string {
  if (comparisons.length === 0) return '';
  const parts = comparisons.map(({ anchor, count }) =>
    `${formatCount(count, locale)} ${anchor.label}`
  );
  return `≈ ${parts.join(' · ')}`;
}

export interface Drift {
  anchor: Anchor;
  /** Signed fraction: +0.3 means it now costs 30% more ZEC than when set. */
  change: number;
}

/**
 * Anchors that have moved enough to be misleading. Surfacing these turns
 * volatility from a silent corruption of the user's mental model into a
 * scheduled, explicit re-look — which is also the moment they re-learn the
 * number.
 */
export function driftedAnchors(anchors: Anchor[], rates: RatesData): Drift[] {
  const drifted: Drift[] = [];
  for (const anchor of anchors) {
    const now = anchorZecValue(anchor, rates);
    if (now === null || !(anchor.zecWhenSet > 0)) continue;
    const change = (now - anchor.zecWhenSet) / anchor.zecWhenSet;
    if (Math.abs(change) >= DRIFT_THRESHOLD) drifted.push({ anchor, change });
  }
  return drifted.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
}

export function createAnchor(
  label: string,
  amount: number,
  currency: string,
  rates: RatesData,
): Anchor | null {
  const trimmed = label.trim();
  if (!trimmed || !(amount > 0)) return null;
  const rate = rates.rates[currency.toUpperCase()];
  if (rate === undefined) return null;
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    label: trimmed.slice(0, 24),
    amount,
    currency: currency.toUpperCase(),
    zecWhenSet: amount * rate,
  };
}
