import { convertPrice } from './conversion/convert';
import { formatZecWithSymbol } from './conversion/format';
import { ZATS_PER_ZEC } from './conversion/format';
import { CURRENCY_CODES } from './currencies';
import { parseNumber, parsePrice } from './detection/parser';
import type { RatesData } from './storage/rates';
import type { Settings } from './storage/settings';

export interface QuickResult {
  input: string;
  output: string;
}

/**
 * Convert a free-text amount — a selection, an omnibox query, anything not
 * attached to a page element. Deliberately shares the page parser so the
 * omnibox and the context menu understand every format the content script does.
 */
export function quickConvert(
  text: string,
  rates: RatesData,
  settings: Settings,
): QuickResult | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const zecToFiat = parseZecInput(trimmed);
  if (zecToFiat !== null) return toFiat(zecToFiat, rates, settings);

  const [price] = parsePrice(trimmed, CURRENCY_CODES, undefined, undefined);
  if (!price) return null;

  const result = convertPrice(price, rates, settings.precision, settings.displayUnit);
  if (!result) return null;
  return { input: price.original, output: result.formatted };
}

/** "3 zec", "0.5 ZEC", "20000 zats" — the reverse direction. */
function parseZecInput(text: string): number | null {
  const match = text.match(/^([\d.,\s'’ ]+)\s*(zec|ⓩ|zats?|zatoshis?)$/i);
  if (!match) return null;
  const amount = parseNumber(match[1]);
  if (amount === null || amount < 0) return null;
  return /^z(ats?|atoshis?)$/i.test(match[2]) ? amount / ZATS_PER_ZEC : amount;
}

/**
 * ZEC to fiat is always spot, deliberately.
 *
 * The two directions are different questions. "What does this thing cost" is a
 * browsing question and takes the held rate, matching every page. "What is my
 * money worth" is a valuation question about a balance the user actually holds
 * — the one case outside checkout where a held rate could cost them.
 */
function toFiat(zec: number, rates: RatesData, settings: Settings): QuickResult | null {
  const currency = settings.displayCurrency;
  const rate = rates.rates[currency];
  if (rate === undefined || rate <= 0) return null;
  const fiat = zec / rate;
  const formatted = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(fiat);
  return {
    input: formatZecWithSymbol(zec, settings.precision, settings.displayUnit),
    output: `${formatted} ${currency}`,
  };
}
