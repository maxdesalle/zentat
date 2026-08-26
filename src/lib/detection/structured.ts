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
  if (depth > 12 || node === null) return;
  // Everything here came out of JSON.parse, so a non-object is a string, a
  // number or a boolean — none of which can hold a key naming a currency.
  // Stryker disable next-line ConditionalExpression: walking a primitive finds no price
  if (typeof node !== 'object') return;

  // Arrays are walked through their values like anything else, so @graph and
  // offer lists need no case of their own.
  const record = node as Record<string, unknown>;
  const currency = record.priceCurrency;

  if (isCurrency(currency)) {
    for (const key of ['price', 'lowPrice', 'highPrice'] as const) {
      // An unreadable amount counts as zero, and zero is never a price.
      const amount = toAmount(record[key]) ?? 0;
      if (amount > 0) {
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
    // An empty block is malformed too, and lands in the same catch.
    if (text.length > MAX_JSONLD_BYTES) continue;
    try {
      collectFromJsonLd(JSON.parse(text), prices);
    } catch {
      // A broken block on the page is not a reason to stop reading the others.
    }
  }

  // Microdata is uniquely valuable: the attribute sits ON the element about to
  // be rewritten, so it answers detection and targeting at once.
  for (const el of root.querySelectorAll('[itemprop="price"]')) {
    const amount = toAmount(el.getAttribute('content') ?? textOf(el)) ?? 0;
    if (amount <= 0) continue;
    const scope: ParentNode = el.closest('[itemscope]') ?? root;
    const currencyEl = scope.querySelector('[itemprop="priceCurrency"]');
    const currency = currencyEl?.getAttribute('content') ?? textOf(currencyEl);
    if (isCurrency(currency)) {
      prices.push({ amount, currency: currency.toUpperCase(), source: 'microdata' });
    }
  }

  const ogAmount = root.querySelector(
    'meta[property="product:price:amount"], meta[property="og:price:amount"]',
  );
  const ogCurrency = root.querySelector(
    'meta[property="product:price:currency"], meta[property="og:price:currency"]',
  );
  const amount = toAmount(ogAmount?.getAttribute('content')) ?? 0;
  const currency = ogCurrency?.getAttribute('content');
  if (amount > 0 && isCurrency(currency)) {
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
 *
 * An amount that renders no digits contributes nothing: an empty projection
 * would match every element on the page that shows no price at all.
 */
export function projectionsFor(amount: number): string[] {
  const out = new Set<string>();
  out.add(digitProjection(amount.toFixed(2)));
  out.add(digitProjection(String(amount)));
  out.add(digitProjection(String(Math.round(amount))));
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
  const located: Located[] = [];
  const claimed = new Set<Element>();
  // Most pages state no price in markup at all; do not walk them for nothing.
  let candidates: Element[] | null = null;

  for (const price of prices) {
    candidates ??= Array.from(root.querySelectorAll('*'));
    const targets = new Set(projectionsFor(price.amount));
    // Shopify themes leak cents-integers into JSON-LD ("15900" for $159.00).
    // Note the two readings project to the SAME digits, so the projection alone
    // cannot separate them — the visible decimal point is what settles it.
    const centsCandidate = Number.isInteger(price.amount) && price.amount >= 1000
      ? price.amount / 100
      : null;

    let best: { element: Element; text: string; size: number } | null = null;

    for (const el of candidates) {
      if (claimed.has(el)) continue;
      const text = textOf(el);
      if (!targets.has(digitProjection(text))) continue;

      const size = el.getElementsByTagName('*').length;
      if (best === null || size < best.size) best = { element: el, text, size };
    }

    if (best) {
      claimed.add(best.element);
      // A visible two-decimal rendering means the on-screen value already has
      // its cents; an integer claim of the same digits was cents all along.
      const showsCents = /\d[.,]\d{2}(?!\d)/.test(best.text);
      const amount = centsCandidate !== null && showsCents ? centsCandidate : price.amount;
      located.push({ element: best.element, price: { ...price, amount } });
    }
  }

  return located;
}
