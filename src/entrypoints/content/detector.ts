import { parsePrice, type ParsedPrice } from '../../lib/detection/parser';
import { walkPriceElements } from '../../lib/detection/walker';

export interface DetectionResult {
  node: Element;
  text: string;
  prices: ParsedPrice[];
}

export function detectPrices(
  root: Node,
  enabledCurrencies: string[],
  hostname: string = window.location.hostname
): DetectionResult[] {
  const elements = walkPriceElements(root);
  const results: DetectionResult[] = [];

  for (const { node, text } of elements) {
    const prices = parsePrice(text, enabledCurrencies, hostname);
    if (prices.length > 0) {
      results.push({ node, text, prices });
    }
  }

  return results;
}
