// 'coarse' rounds to the digits the rate can actually justify. At ZEC's daily
// volatility the third and fourth significant figures are noise, so "0.1204 ZEC"
// claims a precision the rate does not have — and a number nobody can remember.
// Memorable, honest numbers are the point: a unit of account you cannot recall
// is a conversion widget.
export type Precision = 'auto' | 'coarse' | number;
export type DisplayUnit = 'auto' | 'zec' | 'zats';

export const ZATS_PER_ZEC = 100_000_000;

/**
 * There is no automatic switch to zats. The unit is ZEC unless the user asks
 * for otherwise, and this is a deliberate reversal.
 *
 * A magnitude threshold makes the unit a function of the RATE rather than of
 * the price. The same coffee renders "0.0038 ZEC" today and "384,615 zats"
 * after a rally, so the number a person had started to learn changes not just
 * its value but its shape and scale. That is precisely what the held rate
 * exists to prevent, reintroduced through the back door.
 *
 * It also failed on its own terms. The rule keyed on the smallest amount on
 * the page, and a shopping page is one or two real prices surrounded by
 * per-unit figures, shipping thresholds and fees. EU and UK unit pricing is
 * mandatory, so a per-100g figure sits beside the price on essentially every
 * European grocery page: one 0.0006 ZEC figure rendered an $18.79 snack box
 * as "2,399,683 zats". Seven digits is past what anyone can hold in mind,
 * compare against the item beside it, or recall tomorrow — which is the whole
 * job.
 *
 * What is shared across a page is the number of DECIMALS, not the unit. One
 * shape for every price ("0.0241", "0.0006", "0.0401") lets the eye compare
 * them without reading, because a constant prefix stops being read at all.
 * Leading zeros are noise only when they vary.
 */

/**
 * Decimals every price on the page shares, or null to scale to the amount
 * itself — the right behaviour for a single conversion outside a page.
 */
let pageDecimals: number | null = null;

/**
 * Prices seen on this page so far, so a later pass cannot re-scale the page.
 *
 * The observer re-runs conversion on every mutation batch, and a batch is
 * usually ONE lazily-loaded element. Recomputing the grid from just that
 * element would re-scale the page around whatever happened to load last, while
 * everything already on screen kept its old shape — the mixed-scale page this
 * exists to prevent, arrived at from the other direction.
 *
 * Bounded because an infinite-scroll page never stops adding prices, and the
 * median of a few hundred is the same as the median of ten thousand.
 */
const pageSample: number[] = [];
const MAX_PAGE_SAMPLE = 500;

/**
 * Enough decimals to give an amount of this size three significant figures.
 * Capped at eight, because a zatoshi is 1e-8 and nothing finer exists.
 */
function scaleFor(amount: number): number {
  return Math.min(8, Math.max(2, 2 - Math.floor(Math.log10(amount))));
}

/**
 * Never more than four significant figures. The held rate is honest to ±10%
 * by default, so a fifth digit claims a precision the quote cannot support.
 */
function significantFigureCap(amount: number): number {
  return Math.max(0, 3 - Math.floor(Math.log10(Math.abs(amount))));
}

/**
 * Fix the decimal grid for everything about to be rendered together.
 *
 * The MEDIAN price decides, not the smallest. The smallest is almost always
 * the per-unit figure or a fee — noise that no threshold can be tuned around,
 * because on an API pricing page the real span is eight orders of magnitude.
 * The median is what the page is actually about.
 */
export function setPageScale(amounts: number[]): void {
  for (const amount of amounts) {
    if (amount > 0 && Number.isFinite(amount) && pageSample.length < MAX_PAGE_SAMPLE) {
      pageSample.push(amount);
    }
  }
  if (pageSample.length === 0) {
    pageDecimals = null;
    return;
  }
  const sorted = [...pageSample].sort((a, b) => a - b);
  // Lower median: erring toward more decimals is caught by the significant
  // figure cap, erring toward fewer is not.
  pageDecimals = scaleFor(sorted[Math.floor((sorted.length - 1) / 2)]);
}

/** Forget the page's prices. Called when the page itself changes underneath. */
export function clearPageScale(): void {
  pageSample.length = 0;
  pageDecimals = null;
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
/**
 * How many decimals to render this amount with.
 *
 * The page's shared grid, trimmed so no amount claims more than four
 * significant figures. Outside a page, the amount scales itself.
 */
function autoDecimals(abs: number): number {
  if (abs === 0) return 2;
  const grid = pageDecimals ?? scaleFor(abs);
  return Math.min(grid, significantFigureCap(abs));
}

export function formatZecWithSymbol(
  amount: number,
  precision: Precision = 'auto',
  unit: DisplayUnit = 'auto',
): string {
  const absAmount = Math.abs(amount);

  // 'auto' and 'zec' are the same thing. Only an explicit choice produces zats.
  if (unit === 'zats') {
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
  const decimals = precision === 'auto' ? autoDecimals(absAmount) : precision;
  // An amount too small for the page's grid gets its own decimals rather than
  // rendering as "0.0000": a price that reads as zero is a wrong price.
  const roundsToZero = amount !== 0 && absAmount < Math.pow(10, -decimals) / 2;
  const formatted = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: roundsToZero ? undefined : decimals,
    maximumFractionDigits: roundsToZero ? 8 : decimals,
    ...(roundsToZero ? { maximumSignificantDigits: 4 } : {}),
  }).format(amount);
  return `${formatted} ZEC`;
}
