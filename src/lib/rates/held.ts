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

/**
 * ONE currency is pegged and every other is derived from it at the live fiat
 * cross. Running an independent band per currency looks equivalent and is not:
 * the bands re-peg at slightly different moments, so the fiat cross IMPLIED by
 * two converted prices on the same page goes wrong — measured at >2% for a
 * third of all hours, worst case 10.5%. A page showing $100 and EUR100 would
 * then imply EUR/USD = 1.20 when it is 1.09.
 *
 * That directly breaks the invariant the anchors feature rests on: every price
 * on a page converts at the same rate, so ratios between them are exact.
 * Fiat crosses move under 1% a day, so carrying them live costs no stability.
 */
export const HELD_NUMERAIRE = 'USD';

export interface HeldRate {
  /** ZEC-per-unit of the numeraire. The only pegged number. */
  peg: number;
  /** When this peg was taken. */
  pegged: number;
}

export interface HeldRateUpdate {
  held: HeldRate | null;
  /** Whether the displayed rate just moved, for the re-peg notice. */
  repegged: boolean;
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
  const spotPeg = spot.rates[HELD_NUMERAIRE];
  if (!Number.isFinite(spotPeg) || !(spotPeg > 0)) {
    return { held: current, repegged: false };
  }

  if (current === null || !(current.peg > 0)) {
    return { held: { peg: spotPeg, pegged: spot.updatedAt }, repegged: false };
  }

  if (Math.abs(spotPeg - current.peg) / current.peg > band) {
    return { held: { peg: spotPeg, pegged: spot.updatedAt }, repegged: true };
  }

  return { held: current, repegged: false };
}

/**
 * The rate to display for a currency: the held ZEC leg carried at the live
 * fiat cross, so every price on a page shares one ZEC rate and the crosses
 * between them stay exact.
 */
export function heldRateFor(
  held: HeldRate,
  spot: RatesData,
  currency: string,
): number | null {
  const code = currency.toUpperCase();
  const spotNumeraire = spot.rates[HELD_NUMERAIRE];
  if (!(held.peg > 0) || !(spotNumeraire > 0)) return null;
  if (code === HELD_NUMERAIRE) return held.peg;

  const spotRate = spot.rates[code];
  if (!(spotRate > 0)) return null;
  // held ZEC/USD x live (XXX->USD) cross
  return held.peg * (spotRate / spotNumeraire);
}

/** How far the displayed rate currently sits from spot, as a signed fraction. */
export function divergence(held: HeldRate, spot: RatesData): number | null {
  const spotPeg = spot.rates[HELD_NUMERAIRE];
  if (!(held.peg > 0) || !(spotPeg > 0)) return null;
  return (spotPeg - held.peg) / held.peg;
}
