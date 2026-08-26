import type { ParsedPrice } from '../detection/parser';
import { type HeldRate, heldRateFor } from '../rates/held';
import { isCurrencyUsable, type RatesData } from '../storage/rates';
import { type DisplayUnit, formatZecWithSymbol, type Precision } from './format';

export interface ConversionResult {
  original: string;
  zecAmount: number;
  formatted: string;
  currency: string;
}

export function convertPrice(
  parsed: ParsedPrice,
  rates: RatesData,
  // No defaults: every caller has the user's settings in hand, and a default
  // here is a silent way to ignore them.
  precision: Precision,
  displayUnit: DisplayUnit,
  /** When present, prices display at the held rate instead of spot. */
  held?: HeldRate | null,
): ConversionResult | null {
  const rate = held
    ? heldRateFor(held, rates, parsed.currency) ?? undefined
    : rates.rates[parsed.currency];
  // Stryker disable next-line ConditionalExpression: equivalent — a missing
  // rate also fails isCurrencyUsable below, and an undefined rate makes the
  // product NaN, which the finite check catches. Kept because relying on two
  // downstream accidents to express "we have no rate" is not a contract.
  if (rate === undefined) return null;
  // Checked per currency, not map-wide: a fallback provider that only quotes
  // USD/EUR leaves the others frozen, and converting those at a week-old rate
  // is worse than leaving the fiat price alone.
  if (!isCurrencyUsable(rates, parsed.currency)) return null;

  const zecAmount = parsed.amount * rate;
  // A rate outside any plausible range is a broken feed, not a market move.
  // Nothing else stands between a garbage quote and every price on the page.
  if (!Number.isFinite(zecAmount) || zecAmount < 0) return null;

  return {
    original: parsed.original,
    zecAmount,
    formatted: formatZecWithSymbol(zecAmount, precision, displayUnit),
    currency: parsed.currency,
  };
}
