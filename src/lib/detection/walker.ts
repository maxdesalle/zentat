import { QUICK_DETECT_PATTERN } from './patterns';

// Elements to skip entirely. Tag names are compared upper-cased because SVG
// and MathML elements report lowercase tagName in HTML documents.
// BUTTON is skipped so checkout CTAs ("Pay $49.99 now") never show a ZEC
// amount the merchant won't actually charge.
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
  'BUTTON',
  'CODE',
  'PRE',
  'HEAD',
]);

export function isSkippedTag(tagName: string): boolean {
  return SKIP_TAGS.has(tagName.toUpperCase());
}

// Max text length for elements to process (partial replacement handles surrounding text)
// Twitter splits long tweets into multiple spans, some of which can be 600+ chars
const MAX_PURE_PRICE_LENGTH = 1000;

export interface WalkResult {
  node: Element;
  text: string;
  // When set, only the element's DIRECT text-node children should be
  // converted — its element children carry their own prices and are walked
  // separately (fixes "<p>$10 – <span>$8</span></p>" losing the $10).
  directTextOnly?: boolean;
}

// Track bol.com price containers that need special handling
export const bolPriceContainerSet = new WeakSet<Element>();

// Text that looks numeric but is not a price. Never treat the extension's own
// output ("… ZEC", "… zats") as a price — that is what allowed converted text
// to be re-parsed and compounded on sites with bare-number patterns.
export function isNonPriceText(text: string): boolean {
  if (/\bZEC\b/.test(text) || /\bzats?\b/i.test(text)) return true;
  if (/out of \d/i.test(text)) return true; // "4.5 out of 5 stars"
  if (/\d+\s*stars?\b/i.test(text)) return true; // "5 stars" (but not "$5 Starship kit")
  if (/\d+[KMB]?\+?\s*(bought|sold|reviews?|ratings?)/i.test(text)) return true; // "10K+ bought"
  if (/^\d+(\.\d{1,2})?$/.test(text)) return true; // Just a plain number like "4.5"
  // "(123 reviews)" — but keep parenthesized text that contains a currency symbol
  if (/^\(\d/.test(text) && !/[$€£¥₩₹]/.test(text)) return true;
  return false;
}

export function walkPriceElements(root: Node): WalkResult[] {
  const results: WalkResult[] = [];
  const processedElements = new Set<Element>();

  if (!(root instanceof Element || root instanceof Document)) {
    return results;
  }

  // Bol.com-specific: price containers with grid layout and accessibility text
  // These have visual spans (aria-hidden) that need to be handled specially
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  if (hostname === 'bol.com' || hostname.endsWith('.bol.com')) {
    const bolPriceContainers = (root as Element).querySelectorAll?.('.font-produkt') || [];
    for (const container of bolPriceContainers) {
      if (processedElements.has(container)) continue;

      // Find the accessibility span (has visually-hidden styles)
      const accessibilitySpan = container.querySelector('span[style*="position: absolute"]');
      if (accessibilitySpan) {
        const text = accessibilitySpan.textContent?.trim() || '';
        if (text && QUICK_DETECT_PATTERN.test(text) && !isNonPriceText(text)) {
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
      if (!isNonPriceText(text)) {
        results.push({ node: priceEl, text });
        processedElements.add(priceEl);
      }
    }
  }

  const allElements = (root as Element).getElementsByTagName?.('*') || [];

  for (const element of allElements) {
    if (!(element instanceof Element)) continue;
    if (processedElements.has(element)) continue;
    if (isSkippedTag(element.tagName)) continue;
    if ((element as HTMLElement).isContentEditable) continue;

    // Skip hidden/offscreen elements (Amazon uses a-offscreen for screen readers)
    const classStr = typeof element.className === 'string' ? element.className : '';
    if (/a-offscreen|sr-only|visually-hidden|screen-reader-only/i.test(classStr)) continue;
    const htmlEl = element as HTMLElement;
    if (htmlEl.hidden === true) continue;

    // Skip if an ancestor was already collected (walk up — much cheaper than
    // scanning the whole processed set per element)
    let ancestorProcessed = false;
    for (let p = element.parentElement; p; p = p.parentElement) {
      if (processedElements.has(p)) {
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
    if (isNonPriceText(trimmed)) continue;

    // Only process elements where the text is SHORT (likely just a price)
    // This avoids replacing "Price: $19.99 - Save 20%" with just the ZEC amount
    if (trimmed.length > MAX_PURE_PRICE_LENGTH) continue;

    // Prices inside interactive controls stay fiat — the site will charge fiat
    if (element.closest('button, [role="button"]')) continue;

    // If a child also contains a price, the child will be collected on its own —
    // but the parent's DIRECT text may hold a price of its own
    // ("<p>$10 – <span class='sale'>$8</span></p>"), so convert just that part.
    let hasMatchingChild = false;
    for (const child of element.children) {
      const childText = child.textContent?.trim() || '';
      if (
        childText && QUICK_DETECT_PATTERN.test(childText)
        && childText.length <= MAX_PURE_PRICE_LENGTH
        && !isNonPriceText(childText)
      ) {
        hasMatchingChild = true;
        break;
      }
    }

    if (!hasMatchingChild) {
      results.push({ node: element, text: trimmed });
      processedElements.add(element);
    } else {
      const directText = Array.from(element.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.nodeValue || '')
        .join(' ');
      const directTrimmed = directText.trim();
      if (
        directTrimmed
        && QUICK_DETECT_PATTERN.test(directTrimmed)
        && !isNonPriceText(directTrimmed)
      ) {
        // Deliberately NOT added to processedElements: the matching children
        // must still be collected below.
        results.push({ node: element, text: directTrimmed, directTextOnly: true });
      }
    }
  }

  return results;
}
