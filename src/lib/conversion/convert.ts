import type { RatesData } from '../storage/rates';
import type { ParsedPrice } from '../detection/parser';
import { formatZecWithSymbol, type Precision } from './format';

export interface ConversionResult {
  original: string;
  zecAmount: number;
  formatted: string;
  currency: string;
}

export function convertPrice(
  parsed: ParsedPrice,
  rates: RatesData,
  precision: Precision = 'auto'
): ConversionResult | null {
  const rate = rates.rates[parsed.currency];
  if (rate === undefined) return null;

  const zecAmount = parsed.amount * rate;

  return {
    original: parsed.original,
    zecAmount,
    formatted: formatZecWithSymbol(zecAmount, precision),
    currency: parsed.currency,
  };
}

