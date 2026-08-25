import type { RatesData } from '../storage/rates';

// Rates are stored ZEC-per-fiat, so the quoted fiat-per-ZEC price is the
// reciprocal. Bounds are deliberately loose: they exist to catch a decimal
// shift, a unit mix-up (cents, satoshis) or a wrong-asset mapping, never to
// second-guess a real market move.
const MIN_ZEC_PRICE = 1;
const MAX_ZEC_PRICE = 100_000;

// A single quote may not move more than this against the last known good one
// within the freshness window. ZEC moves; it does not move 25% between two
// ten-minute polls without something being broken.
const MAX_DELTA = 0.25;

// After this many consecutive rejections we accept anyway. Otherwise a genuine
// crash would lock every user onto a pre-crash rate indefinitely, which is a
// worse failure than accepting a real 30% move.
const MAX_CONSECUTIVE_REJECTIONS = 3;

const rejections = new Map<string, number>();

export interface ValidationResult {
  rates: Record<string, number>;
  rejected: string[];
}

function plausible(zecPerUnit: number): boolean {
  if (!Number.isFinite(zecPerUnit) || zecPerUnit <= 0) return false;
  const fiatPerZec = 1 / zecPerUnit;
  return fiatPerZec >= MIN_ZEC_PRICE && fiatPerZec <= MAX_ZEC_PRICE;
}

/**
 * Filter a freshly fetched map down to values worth storing. Nothing else
 * stands between a broken feed and every price on the page.
 */
export function validateRates(incoming: RatesData, previous: RatesData): ValidationResult {
  const rates: Record<string, number> = {};
  const rejected: string[] = [];

  for (const [code, value] of Object.entries(incoming.rates)) {
    if (!plausible(value)) {
      rejected.push(code);
      continue;
    }

    const last = previous.rates[code];
    const lastFresh = last !== undefined
      && previous.updatedAt > 0
      && Date.now() - (previous.rateUpdatedAt?.[code] ?? previous.updatedAt) <= 24 * 60 * 60 * 1000;

    if (lastFresh && Math.abs(value - last) / last > MAX_DELTA) {
      const count = (rejections.get(code) ?? 0) + 1;
      if (count < MAX_CONSECUTIVE_REJECTIONS) {
        rejections.set(code, count);
        rejected.push(code);
        continue;
      }
      // Held out three times running — the market moved, we did not.
    }

    rejections.delete(code);
    rates[code] = value;
  }

  return { rates, rejected };
}

/** Test seam. */
export function resetRateValidation(): void {
  rejections.clear();
}
