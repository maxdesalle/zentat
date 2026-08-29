import { parsePrice } from '../../lib/detection/parser';
import type { SeenPrice } from '../../lib/practice/seen';
import { SPAN_CLASS, spanOriginalText } from './markers';

/**
 * Gather practice material from prices already converted on this page.
 *
 * Read off our OWN spans rather than plumbed through the converter. The
 * converter's job is to be cheap and to not break the host page, and threading
 * a collection channel through it would put a storage concern inside the one
 * function on the hot path of every page load. Everything needed is already in
 * the DOM: the span holds the price it replaced, and its surroundings say what
 * the price was for.
 *
 * This runs only when the user has turned practice material on. See
 * src/lib/practice/seen.ts for what may be kept and PRIVACY.md for the promise
 * that matches it.
 */

/** How far up to look for a name before giving up. */
const ANCESTOR_LIMIT = 4;

/** Where a name is likely to be written, in the order worth trusting. */
const NAME_SELECTORS = ['h1', 'h2', 'h3', 'h4', '[itemprop="name"]', 'a', 'img[alt]'];

function nameFrom(element: Element): string {
  for (const selector of NAME_SELECTORS) {
    for (const found of element.querySelectorAll(selector)) {
      // An <img> says its name in the attribute; everything else says it in
      // text. Reading textContent off an image returns the empty string, which
      // would silently skip the one element that had the answer.
      //
      // Both assertions are guaranteed by the selectors above: the image arm is
      // only reached through `img[alt]`, so the attribute is present, and
      // textContent is never null on an element. Written as fallbacks they were
      // two branches no test could ever take.
      const text = found.tagName === 'IMG'
        ? found.getAttribute('alt')!
        : found.textContent!;
      const trimmed = text.replace(/\s+/g, ' ').trim();
      if (trimmed !== '') return trimmed;
    }
  }
  return '';
}

/**
 * What a person would call the thing this price is for.
 *
 * Climbs a bounded number of ancestors, because the name of a product sits
 * near its price and the name of the SITE sits at the top of the document. An
 * unbounded climb always finds something, and what it finds on a page with no
 * product name is the page's own heading — which is a record of what the user
 * was reading, and the one thing this must never keep.
 */
export function labelFor(span: Element): string {
  let element: Element | null = span.parentElement;
  for (let step = 0; step < ANCESTOR_LIMIT && element !== null; step++) {
    const name = nameFrom(element);
    if (name !== '') return name;
    element = element.parentElement;
  }
  return '';
}

/**
 * Every price on this page that can honestly become practice material.
 *
 * A price with no name beside it is dropped rather than stored under some
 * generic label: "a price you saw once, 47 euros" teaches nothing, and a store
 * full of them is a list of amounts kept for no benefit at all. `seen.ts`
 * decides what survives of the label; this decides whether there is one.
 */
export function harvestSeenPrices(
  root: ParentNode,
  enabledCurrencies: string[],
  hostname: string,
  documentLang: string | undefined,
): SeenPrice[] {
  const found: SeenPrice[] = [];

  for (const span of root.querySelectorAll(`.${SPAN_CLASS}`)) {
    const original = spanOriginalText(span);
    // A span we did not record an original for cannot be read back, and
    // guessing from the rendered ZEC would store our own output as a price.
    if (!original) continue;

    const label = labelFor(span);
    if (label === '') continue;

    // Re-read rather than remembered: the amount and currency have to come from
    // the same parser the page was converted with, or the practice material
    // disagrees with what the user was shown.
    const [price] = parsePrice(original, enabledCurrencies, hostname, documentLang);
    if (!price) continue;

    found.push({ label, amount: price.amount, currency: price.currency });
  }

  return found;
}
