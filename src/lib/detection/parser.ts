import { CURRENCY_PATTERNS, type CurrencyPattern } from './patterns';
import { resolveAmbiguousSymbol } from './locale';

export interface ParsedPrice {
  original: string;
  amount: number;
  currency: string;
  startIndex: number;
  endIndex: number;
}

// Symbols that are ambiguous and need locale-based resolution
const AMBIGUOUS_SYMBOLS: Record<string, string[]> = {
  $: ['USD', 'CAD', 'AUD', 'MXN'],
  '¥': ['JPY', 'CNY'],
};

export function parsePrice(text: string, enabledCurrencies: string[], hostname?: string): ParsedPrice[] {
  const results: ParsedPrice[] = [];
  const enabledSet = new Set(enabledCurrencies.map((c) => c.toUpperCase()));

  for (const pattern of CURRENCY_PATTERNS) {
    // Skip patterns restricted to specific hostnames
    if (pattern.hostnames && hostname) {
      const matchesHost = pattern.hostnames.some(
        (h) => hostname === h || hostname.endsWith('.' + h)
      );
      if (!matchesHost) continue;
    }

    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.regex.exec(text)) !== null) {
      const parsed = extractPriceFromMatch(match, pattern, hostname);
      if (parsed) {
        // Check if the resolved currency is enabled
        if (!enabledSet.has(parsed.currency)) continue;

        // Check for overlap with existing results
        const overlapIndex = results.findIndex(
          (r) =>
            (parsed.startIndex >= r.startIndex && parsed.startIndex < r.endIndex) ||
            (parsed.endIndex > r.startIndex && parsed.endIndex <= r.endIndex) ||
            (parsed.startIndex <= r.startIndex && parsed.endIndex >= r.endIndex)
        );

        if (overlapIndex === -1) {
          // No overlap, add new result
          results.push(parsed);
        } else {
          // Overlap found - prefer the match that starts earlier or is longer
          const existing = results[overlapIndex];
          const parsedLen = parsed.endIndex - parsed.startIndex;
          const existingLen = existing.endIndex - existing.startIndex;

          if (parsed.startIndex < existing.startIndex ||
              (parsed.startIndex === existing.startIndex && parsedLen > existingLen)) {
            results[overlapIndex] = parsed;
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
      const priceMatchesSymbol =
        (price.original.includes('€') && price.currency === 'EUR') ||
        (price.original.includes('$') && price.currency === 'USD') ||
        (price.original.includes('£') && price.currency === 'GBP');
      const existingMatchesSymbol =
        (existing.original.includes('€') && existing.currency === 'EUR') ||
        (existing.original.includes('$') && existing.currency === 'USD') ||
        (existing.original.includes('£') && existing.currency === 'GBP');

      if (priceMatchesSymbol && !existingMatchesSymbol) {
        deduped[sameTextIdx] = price;
      }
      continue;
    }

    // Check for overlapping positions with same amount
    const overlapIdx = deduped.findIndex(
      (p) => Math.abs(p.amount - price.amount) < 0.01 &&
        ((price.startIndex >= p.startIndex && price.startIndex < p.endIndex) ||
         (price.endIndex > p.startIndex && price.endIndex <= p.endIndex))
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

function extractPriceFromMatch(
  match: RegExpExecArray,
  pattern: CurrencyPattern,
  hostname?: string
): ParsedPrice | null {
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

  const amount = parseNumber(numStr);
  if (amount === null || amount < 0) return null;

  // Resolve currency - use locale for ambiguous symbols
  let currency = pattern.code;
  if (detectedSymbol && hostname) {
    const resolved = resolveAmbiguousSymbol(detectedSymbol, hostname);
    if (resolved) {
      currency = resolved;
    }
  }

  return {
    original: original.trim(),
    amount,
    currency,
    startIndex,
    endIndex,
  };
}

// Multipliers for k/m/M/B/T suffixes
const SUFFIX_MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  K: 1_000,
  m: 1_000_000,
  M: 1_000_000,
  B: 1_000_000_000,
  T: 1_000_000_000_000,
};

// Spelled-out multipliers (multilingual)
// Includes English, French, German, Dutch, Spanish, Portuguese, Italian
const WORD_MULTIPLIERS: Record<string, number> = {
  // Thousand (10^3)
  thousand: 1_000,
  mille: 1_000,      // FR, IT
  tausend: 1_000,    // DE
  duizend: 1_000,    // NL
  mil: 1_000,        // ES, PT
  // Million (10^6)
  million: 1_000_000,
  millón: 1_000_000, // ES
  milhão: 1_000_000, // PT
  milione: 1_000_000, // IT
  miljoen: 1_000_000, // NL
  // Billion (10^9) - short scale
  billion: 1_000_000_000,
  milliard: 1_000_000_000, // FR, DE (long scale billion)
  miljard: 1_000_000_000,  // NL
  miliardo: 1_000_000_000, // IT
  // Trillion (10^12)
  trillion: 1_000_000_000_000,
  bilhão: 1_000_000_000_000,  // PT (can mean 10^12)
  biljoen: 1_000_000_000_000, // NL
};

export function parseNumber(str: string): number | null {
  let cleaned = str.trim();

  // Check for spelled-out multipliers first (e.g., "10 million", "5 hundred thousand")
  let multiplier = 1;
  const lowerStr = cleaned.toLowerCase();

  // Handle "hundred thousand" = 100,000
  if (/hundred\s+thousand/i.test(lowerStr)) {
    multiplier = 100_000;
    cleaned = cleaned.replace(/\s*hundred\s+thousand\s*/i, '');
  } else {
    // Check for single word multipliers
    for (const [word, mult] of Object.entries(WORD_MULTIPLIERS)) {
      const wordPattern = new RegExp(`\\s*${word}\\s*$`, 'i');
      if (wordPattern.test(cleaned)) {
        multiplier = mult;
        cleaned = cleaned.replace(wordPattern, '');
        break;
      }
    }
  }

  // Remove remaining spaces (including non-breaking spaces)
  cleaned = cleaned.replace(/[\s\u00A0]/g, '');

  // Check for and extract suffix multiplier (k, K, M, B, T)
  const lastChar = cleaned.slice(-1);
  if (SUFFIX_MULTIPLIERS[lastChar]) {
    multiplier *= SUFFIX_MULTIPLIERS[lastChar];
    cleaned = cleaned.slice(0, -1);
  }

  const commaCount = (cleaned.match(/,/g) || []).length;
  const dotCount = (cleaned.match(/\./g) || []).length;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  // Multiple commas with no dot = US thousand separators only (e.g., "150,000,000")
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
  // If exactly one separator with exactly 3 digits after it, it's a thousand separator
  if (commaCount + dotCount === 1) {
    const sepIndex = Math.max(lastComma, lastDot);
    const afterSep = cleaned.slice(sepIndex + 1);
    if (afterSep.length === 3 && /^\d{3}$/.test(afterSep)) {
      // Single separator with 3 digits = thousand separator
      cleaned = cleaned.replace(/[,.]/, '');
      const num = parseFloat(cleaned);
      return isNaN(num) ? null : num * multiplier;
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
