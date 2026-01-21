import { QUICK_DETECT_PATTERN } from './patterns';

// Elements to skip entirely
const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'CANVAS',
  'SVG',
  'MATH',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'CODE',
  'PRE',
  'HEAD',
]);

// Max text length for elements to process (partial replacement handles surrounding text)
// 500 chars covers tweets (280 standard, 4000 premium) and most common text blocks
const MAX_PURE_PRICE_LENGTH = 500;

export interface WalkResult {
  node: Element;
  text: string;
}

// Track bol.com price containers that need special handling
export const bolPriceContainerSet = new WeakSet<Element>();

// Pattern to detect non-price content (skip these elements)
const NON_PRICE_PATTERNS = [
  /out of \d/i,           // "4.5 out of 5 stars"
  /\d+\s*stars?/i,        // "5 stars"
  /\d+[KMB]?\+?\s*(bought|sold|reviews?|ratings?)/i,  // "10K+ bought"
  /^\d+(\.\d+)?$/,        // Just a plain number like "4.5"
  /^\(\d/,                // Starts with "(1" like "(123 reviews)"
  /subscribe/i,           // Subscribe & save prices
];

export function walkPriceElements(root: Node): WalkResult[] {
  const results: WalkResult[] = [];
  const processedElements = new Set<Element>();

  if (!(root instanceof Element || root instanceof Document)) {
    return results;
  }

  // Bol.com-specific: price containers with grid layout and accessibility text
  // These have visual spans (aria-hidden) that need to be handled specially
  if (window.location.hostname.includes('bol.com')) {
    const bolPriceContainers = (root as Element).querySelectorAll?.('.font-produkt') || [];
    for (const container of bolPriceContainers) {
      if (processedElements.has(container)) continue;

      // Find the accessibility span (has visually-hidden styles)
      const accessibilitySpan = container.querySelector('span[style*="position: absolute"]');
      if (accessibilitySpan) {
        const text = accessibilitySpan.textContent?.trim() || '';
        if (text && QUICK_DETECT_PATTERN.test(text)) {
          // Mark this as a bol.com price container for special handling
          bolPriceContainerSet.add(container);
          results.push({ node: container as Element, text });
          processedElements.add(container);
        }
      }
    }
  }

  // First, handle Amazon-specific price containers (.a-price) - including strikethrough prices
  const amazonPrices = (root as Element).querySelectorAll?.('.a-price') || [];
  for (const priceEl of amazonPrices) {
    if (processedElements.has(priceEl)) continue;

    // Get the offscreen text which has the full price
    const offscreen = priceEl.querySelector('.a-offscreen');
    const text = offscreen?.textContent?.trim() || priceEl.textContent?.trim() || '';

    if (text && QUICK_DETECT_PATTERN.test(text) && text.length <= MAX_PURE_PRICE_LENGTH) {
      if (!NON_PRICE_PATTERNS.some(p => p.test(text))) {
        results.push({ node: priceEl, text });
        processedElements.add(priceEl);
      }
    }
  }

  const allElements = (root as Element).getElementsByTagName?.('*') || [];

  for (const element of allElements) {
    if (!(element instanceof Element)) continue;
    if (processedElements.has(element)) continue;
    if (SKIP_TAGS.has(element.tagName)) continue;
    if ((element as HTMLElement).isContentEditable) continue;

    // Skip hidden/offscreen elements (Amazon uses a-offscreen for screen readers)
    const classStr = typeof element.className === 'string' ? element.className : '';
    if (/a-offscreen|sr-only|visually-hidden|screen-reader-only/i.test(classStr)) continue;
    const htmlEl = element as HTMLElement;
    if (htmlEl.hidden === true) continue;

    // Skip if ancestor already processed
    let ancestorProcessed = false;
    for (const processed of processedElements) {
      if (processed.contains(element)) {
        ancestorProcessed = true;
        break;
      }
    }
    if (ancestorProcessed) continue;

    const text = element.textContent || '';
    const trimmed = text.trim();

    if (!trimmed) continue;
    if (!QUICK_DETECT_PATTERN.test(trimmed)) continue;

    // Skip if it looks like non-price content
    if (NON_PRICE_PATTERNS.some(p => p.test(trimmed))) continue;

    // Only process elements where the text is SHORT (likely just a price)
    // This avoids replacing "Price: $19.99 - Save 20%" with just the ZEC amount
    if (trimmed.length > MAX_PURE_PRICE_LENGTH) continue;

    // Skip if this element has children that also contain prices
    let hasMatchingChild = false;
    for (const child of element.children) {
      const childText = child.textContent?.trim() || '';
      if (childText && QUICK_DETECT_PATTERN.test(childText) &&
          childText.length <= MAX_PURE_PRICE_LENGTH &&
          !NON_PRICE_PATTERNS.some(p => p.test(childText))) {
        hasMatchingChild = true;
        break;
      }
    }

    if (!hasMatchingChild) {
      results.push({ node: element, text: trimmed });
      processedElements.add(element);
    }
  }

  return results;
}

