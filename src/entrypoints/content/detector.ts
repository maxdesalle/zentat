import { type ParsedPrice, parsePrice } from '../../lib/detection/parser';
import {
  documentCurrency,
  locatePrices,
  readStructuredPrices,
} from '../../lib/detection/structured';
import { walkPriceElements } from '../../lib/detection/walker';

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
  const documentLang = typeof document !== 'undefined'
    ? document.documentElement.lang || undefined
    : undefined;

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
    const text = (element.textContent ?? '').trim();
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

  for (const { node, text, directTextOnly } of walkPriceElements(root)) {
    // Already answered authoritatively; do not let regex second-guess it.
    if (claimed.has(node) || [...claimed].some((el) => el.contains(node))) continue;

    const prices = parsePrice(text, enabledCurrencies, hostname, documentLang, pageCurrency)
      .filter((price) => !claimed.has(node));
    if (prices.length > 0) {
      results.push({ node, text, prices, directTextOnly });
    }
  }

  return results;
}

function enabledSet(codes: string[]): Set<string> {
  return new Set(codes.map((code) => code.toUpperCase()));
}
