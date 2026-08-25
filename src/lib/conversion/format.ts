export type Precision = 'auto' | number;
export type DisplayUnit = 'auto' | 'zec' | 'zats';

export const ZATS_PER_ZEC = 100_000_000;
// In 'auto' unit mode, amounts below this render in zats for readability
const ZATS_THRESHOLD_ZEC = 0.0001;

// Output honors the user's locale (decimal comma for a German user, etc.) so
// the extension never writes "1.234" into a page where the site itself uses
// "." as a thousands separator. Falls back to en-US outside a browser context.
const LOCALE = typeof navigator !== 'undefined' && navigator.language
  ? navigator.language
  : 'en-US';

function formatFixed(amount: number, decimals: number): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: false,
  }).format(amount);
}

/**
 * Format ZEC amount with adaptive precision.
 *
 * Rules for 'auto':
 * - Minimum 2 decimals always shown
 * - Expand until 4 significant figures are visible
 *
 * A fixed numeric precision that would round a nonzero amount to zero falls
 * back to the auto rules — "0.00 ZEC" carries no information.
 *
 * Examples (en-US locale):
 * - 100      → "100.00"
 * - 1.234    → "1.234"
 * - 0.001234 → "0.001234"
 * - 0.00001  → "0.00001000"
 */
export function formatZec(amount: number, precision: Precision = 'auto'): string {
  if (precision !== 'auto') {
    const roundsToZero = amount !== 0 && Math.abs(amount) < Math.pow(10, -precision) / 2;
    if (!roundsToZero) {
      return formatFixed(amount, precision);
    }
    // Fall through to auto so cheap items don't all display as "0.00"
  }

  // Auto precision: minimum 2 decimals, expand for 4 significant figures
  const minDecimals = 2;
  const targetSigFigs = 4;

  // Handle zero
  if (amount === 0) {
    return formatFixed(0, 2);
  }

  const absAmount = Math.abs(amount);

  // Count leading zeros after decimal
  let decimalsNeeded = minDecimals;

  if (absAmount < 1) {
    // For numbers < 1, we need to show enough decimals to get significant figures
    const log10 = Math.floor(Math.log10(absAmount));
    // log10 of 0.001 is -3, so we need 3 leading zeros
    const leadingZeros = -log10 - 1;
    // We need leadingZeros + targetSigFigs decimals
    decimalsNeeded = Math.max(minDecimals, leadingZeros + targetSigFigs);
  } else {
    // For numbers >= 1, check if we need more than 2 decimals
    // Count digits before decimal
    const intPart = Math.floor(absAmount);
    const intDigits = intPart === 0 ? 0 : Math.floor(Math.log10(intPart)) + 1;
    const sigFigsNeeded = Math.max(0, targetSigFigs - intDigits);
    decimalsNeeded = Math.max(minDecimals, sigFigsNeeded);
  }

  // Cap at reasonable max
  decimalsNeeded = Math.min(decimalsNeeded, 8);

  return formatFixed(amount, decimalsNeeded);
}

/**
 * Format ZEC amount with symbol.
 *
 * - Very small amounts (auto unit mode) render in zats: "6,250 zats"
 * - Large amounts use locale-aware compact notation: "27.15K ZEC" — unless the
 *   user chose a fixed precision, which is honored with full grouped digits
 * - Everything else: formatZec + " ZEC"
 */
export function formatZecWithSymbol(
  amount: number,
  precision: Precision = 'auto',
  unit: DisplayUnit = 'auto',
): string {
  const absAmount = Math.abs(amount);

  // Sub-unit display for small amounts
  if (unit === 'zats' || (unit === 'auto' && absAmount > 0 && absAmount < ZATS_THRESHOLD_ZEC)) {
    const zats = amount * ZATS_PER_ZEC;
    const formatted = new Intl.NumberFormat(LOCALE, {
      maximumFractionDigits: Math.abs(zats) < 1 ? 2 : 0,
    }).format(zats);
    return `${formatted} zats`;
  }

  if (absAmount >= 1_000) {
    if (precision !== 'auto') {
      // Honor the user's fixed precision with full grouped digits
      const formatted = new Intl.NumberFormat(LOCALE, {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      }).format(amount);
      return `${formatted} ZEC`;
    }
    // Compact notation picks the unit after rounding, so 999,999,999 promotes
    // to "1B" instead of "1000M"
    const compact = new Intl.NumberFormat(LOCALE, {
      notation: 'compact',
      compactDisplay: 'short',
      maximumSignificantDigits: 4,
    }).format(amount);
    return `${compact} ZEC`;
  }

  // Standard format for smaller amounts
  return `${formatZec(amount, precision)} ZEC`;
}
