// 'coarse' rounds to the digits the rate can actually justify. At ZEC's daily
// volatility the third and fourth significant figures are noise, so "0.1204 ZEC"
// claims a precision the rate does not have — and a number nobody can remember.
// Memorable, honest numbers are the point: a unit of account you cannot recall
// is a conversion widget.
export type Precision = 'auto' | 'coarse' | number;
export type DisplayUnit = 'auto' | 'zec' | 'zats';

export const ZATS_PER_ZEC = 100_000_000;
// In 'auto' unit mode, amounts below this render in zats for readability
// Below this, decimals stop being scannable ("0.000423") and zats read better.
// Raised from 0.0001, which left an unreadable six-decimal band populated by
// exactly the sub-dime items that fill a shopping page.
const ZATS_THRESHOLD_ZEC = 0.001;

/**
 * The unit chosen for a whole page, rather than per price.
 *
 * Switching units per amount is locally sensible and globally wrong: a page
 * with a 0.0004 ZEC item and a 5 ZEC item would render one in zats and one in
 * ZEC, so the two numbers cannot be compared by eye at all. Consistent
 * denomination is most of what makes a unit calculable — the medieval public
 * did not learn to reckon in money by having the unit change under them.
 *
 * Null means "decide per amount", which is the right behaviour for a single
 * conversion outside a page context.
 */
let pageUnit: 'zec' | 'zats' | null = null;

/**
 * Pick one unit for everything about to be rendered together.
 *
 * The smallest amount decides, because that is the one that becomes unreadable
 * first: 0.0004 ZEC is six decimals of noise, while 12,500,000 zats is merely
 * a large number. Legibility of the worst case beats tidiness of the best.
 */
export function setPageUnit(amounts: number[]): void {
  const positive = amounts.filter((amount) => amount > 0);
  if (positive.length === 0) {
    pageUnit = null;
    return;
  }
  pageUnit = Math.min(...positive) < ZATS_THRESHOLD_ZEC ? 'zats' : 'zec';
}

export function clearPageUnit(): void {
  pageUnit = null;
}

// Output honors the user's locale (decimal comma for a German user, etc.) so
// the extension never writes "1.234" into a page where the site itself uses
// "." as a thousands separator. Falls back to en-US outside a browser context.
let LOCALE = typeof navigator !== 'undefined' && navigator.language
  ? navigator.language
  : 'en-US';

/**
 * Render in the page's locale rather than the browser's. A US user on a German
 * shop parses "1.234,56 €" under German rules and would then read the result
 * under US ones — the meaning of "." flipping mid-sentence.
 */
export function setDisplayLocale(locale: string | undefined): void {
  if (locale) LOCALE = locale;
}

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
  if (precision === 'coarse') {
    return new Intl.NumberFormat(LOCALE, { maximumSignificantDigits: 2 }).format(amount);
  }
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
    // absAmount >= 1 in this branch, so intPart is at least 1 and log10 of it
    // is defined. The zero guard that used to sit here could never fire.
    const intDigits = Math.floor(Math.log10(Math.floor(absAmount))) + 1;
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
/** Significant figures a currency amount should show at a given magnitude. */
function decimalsFor(abs: number): number {
  if (abs >= 1_000) return 0;
  if (abs >= 100) return 1;
  if (abs >= 1) return 2;
  if (abs >= 0.01) return 4;
  return 5;
}

export function formatZecWithSymbol(
  amount: number,
  precision: Precision = 'auto',
  unit: DisplayUnit = 'auto',
): string {
  const absAmount = Math.abs(amount);

  const auto = unit === 'auto'
    && absAmount > 0
    && (pageUnit === null ? absAmount < ZATS_THRESHOLD_ZEC : pageUnit === 'zats');

  if (unit === 'zats' || auto) {
    const zats = amount * ZATS_PER_ZEC;
    const formatted = new Intl.NumberFormat(LOCALE, {
      maximumFractionDigits: Math.abs(zats) < 1 ? 2 : 0,
    }).format(zats);
    return `${formatted} zats`;
  }

  if (precision === 'coarse') {
    // Two significant figures, and an explicit "about" so the number is not
    // mistaken for a precise quote.
    const formatted = new Intl.NumberFormat(LOCALE, {
      maximumSignificantDigits: 2,
    }).format(amount);
    return `≈${formatted} ZEC`;
  }

  // Grouped digits, never compact notation. No currency prices anything as
  // "1.235M" — and at four significant figures that rounding silently discards
  // hundreds of ZEC from a large amount.
  const decimals = precision === 'auto' ? decimalsFor(absAmount) : precision;
  const roundsToZero = amount !== 0 && Math.abs(amount) < Math.pow(10, -decimals) / 2;
  const formatted = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: roundsToZero ? undefined : decimals,
    maximumFractionDigits: roundsToZero ? 8 : decimals,
    ...(roundsToZero ? { maximumSignificantDigits: 4 } : {}),
  }).format(amount);
  return `${formatted} ZEC`;
}
