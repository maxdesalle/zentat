import { AMBIGUOUS_SYMBOLS, resolveAmbiguousSymbol } from './locale';
import { CURRENCY_PATTERNS, type CurrencyPattern } from './patterns';

export interface ParsedPrice {
  original: string;
  amount: number;
  currency: string;
  startIndex: number;
  endIndex: number;
}

// Currencies whose conventional format uses "." as the decimal separator, so a
// single-digit integer part before ".ddd" reads as a decimal ($3.499 gas-style
// pricing), not a thousands separator.
const US_DECIMAL_CURRENCIES = new Set(['USD', 'GBP', 'CAD', 'AUD', 'MXN']);

// The gas-style "$3.499" read is only safe on a page that writes decimals with
// a dot. "$1.500" on an es-AR page is 1500 pesos, and reading it as 1.5 is a
// 1000x error. Ask ICU rather than keeping a hand-list of locales — es-MX uses
// a dot while es-AR uses a comma, and a hand-list gets that wrong.
const decimalSepCache = new Map<string, string>();

function usesDotDecimal(lang: string | undefined): boolean {
  if (!lang) return true;
  let sep = decimalSepCache.get(lang);
  if (sep === undefined) {
    try {
      sep = new Intl.NumberFormat(lang).formatToParts(1.1)
        .find((part) => part.type === 'decimal')?.value ?? '.';
    } catch {
      sep = '.';
    }
    decimalSepCache.set(lang, sep);
  }
  return sep === '.';
}

export function parsePrice(
  text: string,
  enabledCurrencies: string[],
  hostname?: string,
  documentLang?: string,
  /**
   * Currency the page states in its own structured data. Beats every guess we
   * would otherwise make from a symbol or a TLD — "$" on a geo-priced .com is
   * CAD roughly as often as it is USD.
   */
  pageCurrency?: string | null,
  /**
   * Whether the text came from an element a site adapter identified as a price
   * container. Patterns matching bare numbers only run when this is true.
   */
  inPriceContainer = false,
): ParsedPrice[] {
  const results: ParsedPrice[] = [];
  const enabledSet = new Set(enabledCurrencies.map((c) => c.toUpperCase()));

  for (const pattern of CURRENCY_PATTERNS) {
    // A bare-number pattern with no currency evidence needs positional
    // evidence instead, or it reads screen resolutions as prices.
    if (pattern.requiresPriceContainer && !inPriceContainer) continue;

    // Skip patterns restricted to specific hostnames
    if (pattern.hostnames && hostname) {
      const matchesHost = pattern.hostnames.some(
        (h) => hostname === h || hostname.endsWith('.' + h),
      );
      if (!matchesHost) continue;
    }

    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.regex.exec(text)) !== null) {
      const parsed = extractPriceFromMatch(match, pattern, hostname, documentLang);
      if (parsed) {
        // Skip negative amounts (refunds, discounts): a minus sign directly
        // before the match — but not a range dash, which has a price/digit on
        // its left side ("£10–£20").
        if (isNegatedAt(text, parsed.price.startIndex)) continue;

        let currency = parsed.price.currency;
        // An ambiguous symbol resolved by TLD is a guess; the page's own
        // declaration is not.
        if (pageCurrency && parsed.symbol && AMBIGUOUS_SYMBOLS[parsed.symbol]) {
          const candidates = AMBIGUOUS_SYMBOLS[parsed.symbol];
          if (candidates.includes(pageCurrency)) currency = pageCurrency;
        }
        // If the locale-resolved currency for an ambiguous symbol is disabled,
        // fall back to another enabled candidate for that symbol instead of
        // silently dropping the price (e.g. "$" resolved to MXN on a .mx site
        // while the user only enabled USD).
        if (!enabledSet.has(currency) && parsed.symbol) {
          const candidates = AMBIGUOUS_SYMBOLS[parsed.symbol];
          const fallback = candidates?.find((c) => enabledSet.has(c));
          if (fallback) currency = fallback;
        }
        if (!enabledSet.has(currency)) continue;
        const price = { ...parsed.price, currency };

        // Check for overlap with existing results
        const overlapIndex = results.findIndex(
          (r) =>
            (price.startIndex >= r.startIndex && price.startIndex < r.endIndex)
            || (price.endIndex > r.startIndex && price.endIndex <= r.endIndex)
            || (price.startIndex <= r.startIndex && price.endIndex >= r.endIndex),
        );

        if (overlapIndex === -1) {
          // No overlap, add new result
          results.push(price);
        } else {
          // Overlap found - prefer the match that starts earlier or is longer
          const existing = results[overlapIndex];
          const parsedLen = price.endIndex - price.startIndex;
          const existingLen = existing.endIndex - existing.startIndex;

          if (
            price.startIndex < existing.startIndex
            || (price.startIndex === existing.startIndex && parsedLen > existingLen)
          ) {
            results[overlapIndex] = price;
          }
        }
      }
    }
  }

  // Sort by position
  results.sort((a, b) => a.startIndex - b.startIndex);

  // Deduplicate prices with the same original text or overlapping positions
  // Prefer currency that matches the symbol in the original text
  const deduped: ParsedPrice[] = [];
  for (const price of results) {
    // Check for existing price with same original text
    const sameTextIdx = deduped.findIndex(p => p.original === price.original);
    if (sameTextIdx !== -1) {
      // Prefer the currency that matches the symbol in the original
      const existing = deduped[sameTextIdx];
      const priceMatchesSymbol = (price.original.includes('€') && price.currency === 'EUR')
        || (price.original.includes('$') && price.currency === 'USD')
        || (price.original.includes('£') && price.currency === 'GBP');
      const existingMatchesSymbol = (existing.original.includes('€') && existing.currency === 'EUR')
        || (existing.original.includes('$') && existing.currency === 'USD')
        || (existing.original.includes('£') && existing.currency === 'GBP');

      if (priceMatchesSymbol && !existingMatchesSymbol) {
        deduped[sameTextIdx] = price;
      }
      continue;
    }

    // Check for overlapping positions with same amount
    const overlapIdx = deduped.findIndex(
      (p) =>
        Math.abs(p.amount - price.amount) < 0.01
        && ((price.startIndex >= p.startIndex && price.startIndex < p.endIndex)
          || (price.endIndex > p.startIndex && price.endIndex <= p.endIndex)),
    );
    if (overlapIdx !== -1) {
      // Keep the longer (more specific) match
      if (price.original.length > deduped[overlapIdx].original.length) {
        deduped[overlapIdx] = price;
      }
      continue;
    }

    deduped.push(price);
  }

  return deduped;
}

// A minus sign binds tightly to its number: "-$5" is negative, "Basic – $10" is
// a label separated from a price. Requiring adjacency is what separates the two
// — the earlier "nearest non-space character" rule swallowed every price in a
// pricing table, a bullet list, or any "label — price" line.
const MINUS_SIGNS = new Set(['-', '\u2212', '\u2013', '\u2014']);

function isNegatedAt(text: string, startIndex: number): boolean {
  const ch = text[startIndex - 1];
  if (ch === undefined || !MINUS_SIGNS.has(ch)) return false;
  // A dash with a price on its left is a range ("£10-£20"), not a sign.
  return !/[\d$€£¥₩₹]$/.test(text.slice(0, startIndex - 1));
}

interface ExtractedPrice {
  price: ParsedPrice;
  symbol?: string;
}

function extractPriceFromMatch(
  match: RegExpExecArray,
  pattern: CurrencyPattern,
  hostname?: string,
  documentLang?: string,
): ExtractedPrice | null {
  const original = match[0];
  const startIndex = match.index;
  const endIndex = startIndex + original.length;

  // Find the numeric parts from the match groups
  const numericGroups: string[] = [];
  let detectedSymbol: string | undefined;

  for (let i = 1; i < match.length; i++) {
    const group = match[i];
    if (!group) continue;
    if (/^\d+$/.test(group)) {
      // Pure digit group (like euros or cents separately)
      numericGroups.push(group);
    } else if (/\d/.test(group)) {
      // Mixed group with digits (like "149" or "53,95")
      numericGroups.push(group);
    } else if (/[$€£¥₩₹]/.test(group)) {
      detectedSymbol = group;
    }
  }

  if (numericGroups.length === 0) return null;

  // Handle bol.com "X euro en Y cent" format - two separate numeric groups
  let numStr: string;
  if (numericGroups.length === 2 && pattern.symbols.includes('euro')) {
    // Combine euros and cents: "149" + "95" -> "149.95"
    const euros = numericGroups[0];
    const cents = numericGroups[1].padStart(2, '0');
    numStr = `${euros}.${cents}`;
  } else {
    // Use the first numeric group (standard case)
    numStr = numericGroups[0];
  }

  const preferUsDecimal = US_DECIMAL_CURRENCIES.has(pattern.code) && usesDotDecimal(documentLang);
  const amount = parseNumber(numStr, preferUsDecimal);
  if (amount === null || amount < 0) return null;

  // Resolve currency - use locale for ambiguous symbols
  let currency = pattern.code;
  if (detectedSymbol && hostname) {
    const resolved = resolveAmbiguousSymbol(detectedSymbol, hostname, documentLang);
    if (resolved) {
      currency = resolved;
    }
  }

  return {
    price: {
      original: original.trim(),
      amount,
      currency,
      startIndex,
      endIndex,
    },
    symbol: detectedSymbol,
  };
}

// Multipliers for k/m/b/t suffixes (both cases: the patterns are compiled with
// the 'i' flag, so lowercase b/t match too and must map correctly)
const SUFFIX_MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  K: 1_000,
  m: 1_000_000,
  M: 1_000_000,
  b: 1_000_000_000,
  B: 1_000_000_000,
  t: 1_000_000_000_000,
  T: 1_000_000_000_000,
};

// Spelled-out multipliers (multilingual)
// Includes English, French, German, Dutch, Spanish, Portuguese, Italian
const WORD_MULTIPLIERS: Record<string, number> = {
  // Thousand (10^3)
  thousand: 1_000,
  mille: 1_000, // FR, IT
  tausend: 1_000, // DE
  duizend: 1_000, // NL
  mil: 1_000, // ES, PT
  // Million (10^6)
  million: 1_000_000,
  millón: 1_000_000, // ES
  milhão: 1_000_000, // PT
  milione: 1_000_000, // IT
  miljoen: 1_000_000, // NL
  // Billion (10^9) - short scale
  billion: 1_000_000_000,
  milliard: 1_000_000_000, // FR, DE (long scale billion)
  miljard: 1_000_000_000, // NL
  miliardo: 1_000_000_000, // IT
  // Trillion (10^12)
  trillion: 1_000_000_000_000,
  bilhão: 1_000_000_000_000, // PT (can mean 10^12)
  biljoen: 1_000_000_000_000, // NL
};

// Longest-first so a word is never consumed as a prefix of a longer word
const WORD_MULTIPLIER_ENTRIES = Object.entries(WORD_MULTIPLIERS).sort(
  (a, b) => b[0].length - a[0].length,
);

export function parseNumber(str: string, preferUsDecimal: boolean = false): number | null {
  let cleaned = str.trim();

  // Check for spelled-out multipliers first (e.g., "10 million", "5 hundred thousand")
  let multiplier = 1;
  const lowerStr = cleaned.toLowerCase();

  // Handle "hundred thousand" = 100,000
  if (/hundred\s+thousand/i.test(lowerStr)) {
    multiplier = 100_000;
    cleaned = cleaned.replace(/\s*hundred\s+thousand\s*/i, '');
  } else {
    // Check for single word multipliers, longest first
    for (const [word, mult] of WORD_MULTIPLIER_ENTRIES) {
      const wordPattern = new RegExp(`\\s*${word}\\s*$`, 'i');
      if (wordPattern.test(cleaned)) {
        multiplier = mult;
        cleaned = cleaned.replace(wordPattern, '');
        break;
      }
    }
  }

  // Remove spaces (incl. non-breaking/narrow) and Swiss apostrophe separators
  cleaned = cleaned.replace(/[\s\u00A0\u202F'’]/g, '');

  // Check for and extract suffix multiplier (k, K, m, M, b, B, t, T)
  const lastChar = cleaned.slice(-1);
  if (SUFFIX_MULTIPLIERS[lastChar]) {
    multiplier *= SUFFIX_MULTIPLIERS[lastChar];
    cleaned = cleaned.slice(0, -1);
  }

  const commaCount = (cleaned.match(/,/g) || []).length;
  const dotCount = (cleaned.match(/\./g) || []).length;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  // Multiple commas with no dot = thousand separators only — covers both US
  // grouping ("150,000,000") and Indian lakh grouping ("1,00,000")
  if (commaCount > 1 && dotCount === 0) {
    cleaned = cleaned.replace(/,/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num * multiplier;
  }

  // Multiple dots with no comma = EU thousand separators only (e.g., "150.000.000")
  if (dotCount > 1 && commaCount === 0) {
    cleaned = cleaned.replace(/\./g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num * multiplier;
  }

  // Multiple dots + one comma = EU format with decimal (e.g., "1.234.567,89")
  if (dotCount > 1 && commaCount === 1) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num * multiplier;
  }

  // Multiple commas + one dot = US format with decimal (e.g., "1,234,567.89")
  if (commaCount > 1 && dotCount === 1) {
    cleaned = cleaned.replace(/,/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num * multiplier;
  }

  // Handle ambiguous single-separator cases like "1,234" or "1.234"
  // If exactly one separator with exactly 3 digits after it, it's usually a
  // thousand separator — EXCEPT for a dot in a US-decimal currency with a
  // single-digit integer part ("$3.499" gas-style pricing), which reads as a
  // decimal rather than $3,499. A redundant trailing zero rules that out:
  // pump prices never end in one, so "$1.500" is EU-formatted 1500.
  if (commaCount + dotCount === 1) {
    const sepIndex = Math.max(lastComma, lastDot);
    const afterSep = cleaned.slice(sepIndex + 1);
    if (afterSep.length === 3 && /^\d{3}$/.test(afterSep)) {
      const isUsDecimalRead = preferUsDecimal && cleaned[sepIndex] === '.'
        && sepIndex <= 1 && !afterSep.endsWith('0');
      if (!isUsDecimalRead) {
        // Single separator with 3 digits = thousand separator
        cleaned = cleaned.replace(/[,.]/, '');
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num * multiplier;
      }
    }
  }

  // Detect format: 1,234.56 (US) vs 1.234,56 (EU)
  if (lastComma > lastDot) {
    // EU format: 1.234,56 -> remove dots, replace comma with dot
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // US format: 1,234.56 -> remove commas
    cleaned = cleaned.replace(/,/g, '');
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num * multiplier;
}
