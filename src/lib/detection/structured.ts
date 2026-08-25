/**
 * Structured price data — JSON-LD, microdata, OpenGraph.
 *
 * Regex over rendered text has to reverse-engineer three things from glyphs:
 * the currency, the magnitude, and the separator convention. Structured markup
 * states all three outright, and Google Shopping effectively requires it on
 * retail product pages, so it is present exactly where guessing hurts most.
 *
 * Two rules govern the design:
 *
 * 1. Structured data is ground truth for the VALUE and never for the LOCATION.
 *    It is page-level; it cannot tell you which text node on screen shows it.
 * 2. It is not always right. Shopify themes leak cents-integers into JSON-LD
 *    ("price":"15900" for a $159.00 item), so a value that matches nothing
 *    visible must be reconciled, not trusted.
 */

import { textOf } from './dom';

export interface StructuredPrice {
  amount: number;
  currency: string;
  source: 'jsonld' | 'microdata' | 'meta';
}

const MAX_JSONLD_BYTES = 512 * 1024;

/**
 * Exported for tests: JSON cannot carry a non-finite number, so that arm is
 * unreachable through readStructuredPrices — and it is the one that decides
 * whether Infinity reaches a price on the page.
 */
export function toAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  // Structured `price` is machine-normalised: dot decimal, no grouping.
  const parsed = Number.parseFloat(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function isCurrency(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value.toUpperCase());
}

/** Walk an arbitrary JSON-LD tree collecting every offer-shaped node. */
function collectFromJsonLd(node: unknown, into: StructuredPrice[], depth = 0): void {
  if (depth > 12 || node === null || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const item of node) collectFromJsonLd(item, into, depth + 1);
    return;
  }

  const record = node as Record<string, unknown>;
  const currency = record.priceCurrency;

  if (isCurrency(currency)) {
    for (const key of ['price', 'lowPrice', 'highPrice'] as const) {
      const amount = toAmount(record[key]);
      if (amount !== null && amount > 0) {
        into.push({ amount, currency: currency.toUpperCase(), source: 'jsonld' });
      }
    }
  }

  for (const value of Object.values(record)) collectFromJsonLd(value, into, depth + 1);
}

export function readStructuredPrices(root: ParentNode = document): StructuredPrice[] {
  const prices: StructuredPrice[] = [];

  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    const text = textOf(script);
    // Malformed ld+json is common in the wild; parse defensively, never eval.
    if (!text || text.length > MAX_JSONLD_BYTES) continue;
    try {
      collectFromJsonLd(JSON.parse(text), prices);
    } catch {
      // A broken block on the page is not a reason to stop reading the others.
    }
  }

  // Microdata is uniquely valuable: the attribute sits ON the element about to
  // be rewritten, so it answers detection and targeting at once.
  for (const el of root.querySelectorAll('[itemprop="price"]')) {
    const amount = toAmount(el.getAttribute('content') ?? textOf(el));
    if (amount === null || amount <= 0) continue;
    const scope = el.closest('[itemscope]') ?? root;
    const currencyEl = (scope as ParentNode).querySelector?.('[itemprop="priceCurrency"]');
    const currency = currencyEl?.getAttribute('content') ?? textOf(currencyEl);
    if (isCurrency(currency)) {
      prices.push({ amount, currency: currency.toUpperCase(), source: 'microdata' });
    }
  }

  const ogAmount = root.querySelector?.(
    'meta[property="product:price:amount"], meta[property="og:price:amount"]',
  );
  const ogCurrency = root.querySelector?.(
    'meta[property="product:price:currency"], meta[property="og:price:currency"]',
  );
  const amount = toAmount(ogAmount?.getAttribute('content'));
  const currency = ogCurrency?.getAttribute('content') ?? '';
  if (amount !== null && amount > 0 && isCurrency(currency)) {
    prices.push({ amount, currency: currency.toUpperCase(), source: 'meta' });
  }

  return prices;
}

/**
 * The currency this page prices in, when it says so unambiguously.
 *
 * Worth more than any single price: it retires the "$ means USD by TLD" guess
 * for the whole document, which is a ~37% error on any geo-priced .com.
 */
export function documentCurrency(prices: StructuredPrice[]): string | null {
  const seen = new Set(prices.map((p) => p.currency));
  return seen.size === 1 ? [...seen][0] : null;
}

/** Digits only — how a price looks once markup has eaten its separators. */
export function digitProjection(text: string): string {
  return text.replace(/\D/g, '');
}

/**
 * Plausible on-screen renderings of a structured amount, as digit projections.
 * "$49.99" may be rendered "$49.99", "49,99 $", or split into "$49" + "99",
 * all of which project to "4999" or "49".
 */
export function projectionsFor(amount: number): string[] {
  const out = new Set<string>();
  const fixed = amount.toFixed(2);
  out.add(digitProjection(fixed));
  out.add(digitProjection(String(amount)));
  out.add(digitProjection(String(Math.round(amount))));
  if (Number.isInteger(amount)) out.add(digitProjection(amount.toFixed(2)));
  return [...out].filter(Boolean);
}

export interface Located {
  element: Element;
  price: StructuredPrice;
}

/**
 * Find the smallest visible element whose digits match a structured amount.
 *
 * The oracle does not find the node — the projection match does. The oracle
 * says what that node MEANS. Independently useless, jointly decisive.
 */
export function locatePrices(root: ParentNode, prices: StructuredPrice[]): Located[] {
  if (prices.length === 0) return [];

  const candidates = Array.from(root.querySelectorAll('*'))
    .filter((el) => el.children.length > 0 || textOf(el).length > 0);

  const located: Located[] = [];
  const claimed = new Set<Element>();

  for (const price of prices) {
    const targets = new Set(projectionsFor(price.amount));
    // Shopify themes leak cents-integers into JSON-LD ("15900" for $159.00).
    // Note the two readings project to the SAME digits, so the projection alone
    // cannot separate them — the visible decimal point is what settles it.
    const centsCandidate = Number.isInteger(price.amount) && price.amount >= 1000
      ? price.amount / 100
      : null;
    const centsTargets = centsCandidate === null
      ? null
      : new Set(projectionsFor(centsCandidate));

    let best: Element | null = null;
    let bestSize = Infinity;
    let bestText = '';

    for (const el of candidates) {
      if (claimed.has(el)) continue;
      const text = textOf(el);
      const projection = digitProjection(text);
      if (!projection) continue;
      if (!targets.has(projection) && centsTargets?.has(projection) !== true) continue;

      const size = el.getElementsByTagName('*').length;
      if (size < bestSize) {
        best = el;
        bestSize = size;
        bestText = text;
      }
    }

    if (best) {
      claimed.add(best);
      // A visible two-decimal rendering means the on-screen value already has
      // its cents; an integer claim of the same digits was cents all along.
      const showsCents = /\d[.,]\d{2}(?!\d)/.test(bestText);
      const amount = centsCandidate !== null && showsCents ? centsCandidate : price.amount;
      located.push({ element: best, price: { ...price, amount } });
    }
  }

  return located;
}
