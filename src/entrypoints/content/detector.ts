import { type ParsedPrice, parsePrice } from '../../lib/detection/parser';
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
  const elements = walkPriceElements(root);
  const results: DetectionResult[] = [];
  const documentLang = typeof document !== 'undefined'
    ? document.documentElement.lang || undefined
    : undefined;

  for (const { node, text, directTextOnly } of elements) {
    const prices = parsePrice(text, enabledCurrencies, hostname, documentLang);
    if (prices.length > 0) {
      results.push({ node, text, prices, directTextOnly });
    }
  }

  return results;
}
