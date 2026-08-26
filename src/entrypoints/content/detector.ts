import { textOf } from '../../lib/detection/dom';
import { type ParsedPrice, parsePrice } from '../../lib/detection/parser';
import {
  documentCurrency,
  locatePrices,
  readStructuredPrices,
} from '../../lib/detection/structured';
import { walkPriceElements } from '../../lib/detection/walker';
import { SPAN_CLASS } from './markers';

export interface DetectionResult {
  node: Element;
  text: string;
  prices: ParsedPrice[];
  directTextOnly?: boolean;
}

export function detectPrices(
  root: Node,
  enabledCurrencies: string[],
  hostname: string = window.location.hostname,
): DetectionResult[] {
  const results: DetectionResult[] = [];
  // detectPrices only ever runs against a live DOM: walkPriceElements below
  // requires an Element or Document root, so there is always a document here.
  const documentLang = document.documentElement.lang || undefined;

  // Structured data first. It states the amount and the currency outright,
  // where regex has to reverse-engineer both from glyphs — so it is exactly
  // right on the markup regex handles worst (prices split across spans) and it
  // settles the currency for the whole page, retiring the "$ means USD by TLD"
  // guess that is a ~37% error on any geo-priced .com.
  const structured = readStructuredPrices(document);
  const pageCurrency = documentCurrency(structured);
  const claimed = new Set<Element>();

  for (const { element, price } of locatePrices(root as ParentNode, structured)) {
    if (!enabledSet(enabledCurrencies).has(price.currency)) continue;
    // Never re-read our own output. The regex path is guarded by
    // isNonPriceText rejecting "ZEC", but nothing stood between a structured
    // claim and an element we had already converted: on the second pass a
    // sub-cent claim bound to a div reading "0.00 ZEC/month" and converted it
    // again, to 0.00000003 ZEC. The converter writes into the DOM the observer
    // is watching, so a pass that can read its own output compounds forever.
    if (element.classList.contains(SPAN_CLASS)) continue;
    if (element.querySelector(`.${SPAN_CLASS}`) !== null) continue;
    const text = textOf(element);
    if (!leafTextAgrees(element, text, price.amount, enabledCurrencies, hostname, documentLang)) {
      continue;
    }
    claimed.add(element);
    results.push({
      node: element,
      text,
      prices: [{
        original: text,
        amount: price.amount,
        currency: price.currency,
        startIndex: 0,
        endIndex: text.length,
      }],
    });
  }

  for (const { node, text, directTextOnly, inPriceContainer } of walkPriceElements(root)) {
    // Already answered authoritatively; do not let regex second-guess it.
    if (claimed.has(node) || [...claimed].some((el) => el.contains(node))) continue;

    const prices = parsePrice(
      text,
      enabledCurrencies,
      hostname,
      documentLang,
      pageCurrency,
      inPriceContainer,
    );
    if (prices.length > 0) {
      results.push({ node, text, prices, directTextOnly });
    }
  }

  return results;
}

/**
 * Whether a structured claim may speak for what this element displays.
 *
 * locatePrices binds a claim to an element by digit projection, and digits
 * alone cannot tell "$200" from "$2.00" — they are the same three digits. On
 * Cloudflare's pricing page that bound the $2/mo claim to the $200 tier and
 * rendered it at one hundredth of its price, under a tooltip still reading
 * "Original: $200". The same collision converted "100%" and "1x", whose digits
 * project onto 1.00 and 1.
 *
 * Structured data earns its override on markup regex reads WRONG: a price cut
 * across child elements, where the text is a concatenation artifact
 * ("$18" + "<sup>79</sup>" reading as 1879). An element with no element
 * children has no such artifact — its text is exactly what the site wrote, and
 * it is exactly what the user is about to spend money on. So for a leaf, the
 * claim has to agree with the visible number or it does not apply, and the
 * regex path reads the element instead.
 */
function leafTextAgrees(
  element: Element,
  text: string,
  amount: number,
  enabledCurrencies: string[],
  hostname: string,
  documentLang: string | undefined,
): boolean {
  if (element.children.length > 0) return true;
  const visible = parsePrice(text, enabledCurrencies, hostname, documentLang);
  // Text a reader cannot read as a price ("100%", "1x") is not one, whatever
  // the page's own data says about the digits inside it.
  if (visible.length !== 1) return false;
  // Both sides come from decimal strings, so equal values compare equal; the
  // tolerance is here for representation, not for disagreement. Half a cent is
  // far below the hundredfold errors this exists to catch.
  return Math.abs(visible[0].amount - amount) < 0.005;
}

function enabledSet(codes: string[]): Set<string> {
  return new Set(codes.map((code) => code.toUpperCase()));
}
