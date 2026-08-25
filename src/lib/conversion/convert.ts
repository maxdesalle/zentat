import type { ParsedPrice } from '../detection/parser';
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
  precision: Precision = 'auto',
  displayUnit: DisplayUnit = 'auto',
): ConversionResult | null {
  const rate = rates.rates[parsed.currency];
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
