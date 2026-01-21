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
  return results.sort((a, b) => a.startIndex - b.startIndex);
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

export function parseNumber(str: string): number | null {
  // Remove spaces
  let cleaned = str.replace(/\s/g, '');

  const commaCount = (cleaned.match(/,/g) || []).length;
  const dotCount = (cleaned.match(/\./g) || []).length;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  // Multiple commas with no dot = US thousand separators only (e.g., "150,000,000")
  if (commaCount > 1 && dotCount === 0) {
    cleaned = cleaned.replace(/,/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  // Multiple dots with no comma = EU thousand separators only (e.g., "150.000.000")
  if (dotCount > 1 && commaCount === 0) {
    cleaned = cleaned.replace(/\./g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  // Multiple dots + one comma = EU format with decimal (e.g., "1.234.567,89")
  if (dotCount > 1 && commaCount === 1) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  // Multiple commas + one dot = US format with decimal (e.g., "1,234,567.89")
  if (commaCount > 1 && dotCount === 1) {
    cleaned = cleaned.replace(/,/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
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
      return isNaN(num) ? null : num;
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
  return isNaN(num) ? null : num;
}
