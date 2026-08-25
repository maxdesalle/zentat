import type { RatesData } from '../storage/rates';

/**
 * The held rate.
 *
 * Nobody learns to think in a unit that moves 8% overnight, so the displayed
 * rate should not be spot. The obvious fix — a 7d or 30d moving average — is
 * the wrong one, and measurably so: an average's tracking error is UNBOUNDED
 * under trend, and ZEC's last year was a 19x trend rather than noise around a
 * level. Backtested on real ZEC/USD, a 30-day mean was wrong by up to 309%,
 * a 30-day median by 410%, and an EMA never stops drifting at all.
 *
 * A deadband is bounded by construction, which is what makes it honest: the
 * displayed rate is never further from spot than the threshold. That sentence
 * is a guarantee a user can check, and no average can make it.
 *
 * At matched stability the deadband is 4-5x more accurate than any average:
 * ~10 display changes a month with a worst case of 11%, against a 7-day mean's
 * 55% at the same churn.
 *
 * This is the standard (S,s) menu-cost result — when changing a displayed
 * number is costly, the optimal policy is a threshold, not continuous
 * adjustment. The "menu cost" here is the number the user has memorised.
 */

/** Re-peg once spot leaves this band. Also the disclosed accuracy bound. */
export const HELD_RATE_BAND = 0.1;

export interface HeldRate {
  /** ZEC-per-fiat, by currency code — the number actually displayed. */
  rates: Record<string, number>;
  /** When this peg was taken. */
  pegged: number;
}

export interface HeldRateUpdate {
  held: HeldRate;
  /** Currencies whose displayed rate just moved, for the re-peg notice. */
  repegged: string[];
}

/**
 * Peg against RAW spot, deliberately.
 *
 * Smoothing the input before the band ("median-of-3 then deadband") was tested
 * and is worse on every axis — the lag inside the band compounds rather than
 * cancels. The band is already a noise filter: anything that does not leave it
 * never triggers.
 *
 * There is also no confirmation window. Requiring a breach to persist sounds
 * prudent and raises the worst case, because the price keeps running during the
 * delay. Trigger instantly, peg to the value that triggered.
 */
export function updateHeldRate(
  current: HeldRate | null,
  spot: RatesData,
  band: number = HELD_RATE_BAND,
): HeldRateUpdate {
  const rates: Record<string, number> = { ...current?.rates };
  const repegged: string[] = [];

  for (const [code, spotRate] of Object.entries(spot.rates)) {
    if (!Number.isFinite(spotRate) || spotRate <= 0) continue;

    const heldRate = rates[code];
    if (heldRate === undefined || !(heldRate > 0)) {
      rates[code] = spotRate;
      continue;
    }

    if (Math.abs(spotRate - heldRate) / heldRate > band) {
      rates[code] = spotRate;
      repegged.push(code);
    }
  }

  const changed = repegged.length > 0 || current === null;
  return {
    held: { rates, pegged: changed ? spot.updatedAt : current.pegged },
    repegged,
  };
}

/** How far the displayed rate currently sits from spot, as a signed fraction. */
export function divergence(
  held: HeldRate,
  spot: RatesData,
  currency: string,
): number | null {
  const heldRate = held.rates[currency];
  const spotRate = spot.rates[currency];
  if (!(heldRate > 0) || !(spotRate > 0)) return null;
  return (spotRate - heldRate) / heldRate;
}
