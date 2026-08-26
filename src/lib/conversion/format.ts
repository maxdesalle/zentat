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
    // Stryker disable next-line EqualityOperator: equivalent — the cap differs
    // by one sample out of five hundred, which cannot move a median.
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

/**
 * Format ZEC amount with symbol.
 *
 * - zats only when the user has explicitly chosen them
 * - Large amounts use locale-aware compact notation: "27.15K ZEC" — unless the
 *   user chose a fixed precision, which is honored with full grouped digits
 * - Everything else: grouped digits and " ZEC"
 */
/**
 * How many decimals to render this amount with.
 *
 * The page's shared grid, trimmed so no amount claims more than four
 * significant figures. Outside a page, the amount scales itself.
 */
function autoDecimals(abs: number): number {
  // Zero wears the page's shape but never sets it. setPageScale drops it from
  // the sample because scaleFor(0) is 8 — log10(0) is -Infinity — and would
  // drag the median; outside a page that same runaway is why the fallback here
  // is a literal 2 rather than scaleFor. Returning 2 unconditionally made a $0
  // free tier the one row in a column of "0.0128 ZEC" that a reader had to
  // actually read, which is the opposite of what a shared grid is for.
  if (abs === 0) return pageDecimals ?? 2;
  const grid = pageDecimals ?? scaleFor(abs);
  return Math.min(grid, significantFigureCap(abs));
}

export function formatZecWithSymbol(
  amount: number,
  precision: Precision = 'auto',
  // Stryker disable next-line StringLiteral: equivalent — 'auto' and 'zec' are
  // the same behaviour, so any default that is not 'zats' is indistinguishable.
  unit: DisplayUnit = 'auto',
): string {
  const absAmount = Math.abs(amount);

  // 'auto' and 'zec' are the same thing. Only an explicit choice produces zats.
  if (unit === 'zats') {
    const zats = amount * ZATS_PER_ZEC;
    const formatted = new Intl.NumberFormat(LOCALE, {
      // Stryker disable next-line ConditionalExpression,EqualityOperator:
      // equivalent — a whole number of zats renders identically at 0 or 2
      // maximum fraction digits, so only sub-zatoshi amounts can tell.
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
