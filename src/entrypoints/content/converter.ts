import { convertPrice } from '../../lib/conversion/convert';
import type { ParsedPrice } from '../../lib/detection/parser';
import { bolPriceContainerSet, isSkippedTag } from '../../lib/detection/walker';
import { isRatesUsable, type RatesData } from '../../lib/storage/rates';
import type { Settings } from '../../lib/storage/settings';
import { detectPrices } from './detector';
import { flushObserverRecords } from './state';

import {
  CONVERTED_MARKER,
  PARTIAL_MARKER,
  rememberContainer,
  rememberSpan,
  SPAN_CLASS,
  spanOriginalText,
  takeContainer,
} from './markers';

interface Replacement {
  original: string;
  converted: string;
}

export function convertPricesInDocument(rates: RatesData, settings: Settings): number {
  if (!settings.enabled) return 0;
  // Never convert with unusable rates: empty (nothing fetched yet) or older
  // than a day — silently converting at a wildly stale rate is worse than
  // showing the original fiat price.
  if (!isRatesUsable(rates)) return 0;
  if (!document.body) return 0;

  return convertPricesInNode(document.body, rates, settings);
}

export function convertPricesInNode(root: Node, rates: RatesData, settings: Settings): number {
  if (!settings.enabled) return 0;
  if (!isRatesUsable(rates)) return 0;

  const detections = detectPrices(root, settings.currencies);
  let convertedCount = 0;

  try {
    for (const { node, text, prices, directTextOnly } of detections) {
      // Skip if already processed or if this IS one of our converted spans
      if (node.closest(`.${CONVERTED_MARKER}`)) continue;
      if (node.closest(`.${SPAN_CLASS}`)) continue;

      // Captured BEFORE any mutation — this is what tooltips must show
      const originalText = text;

      let converted = false;

      const hostname = window.location.hostname;
      const isAmazonPrice = node.classList.contains('a-price');
      const isBolPrice = bolPriceContainerSet.has(node);
      // Structured-container replacement is destructive (drops child markup),
      // so on Coolblue it is limited to short, price-only elements instead of
      // firing for every element on the site.
      const isCoolbluePrice = isHost(hostname, ['coolblue.nl', 'coolblue.be'])
        && originalText.trim().length <= 32;
      const isDigitalOceanPrice = isHost(hostname, ['digitalocean.com'])
        && (node.classList.contains('pricing') || node.closest('.pricing') !== null);

      if (isAmazonPrice || isBolPrice || isCoolbluePrice || isDigitalOceanPrice) {
        // For structured price containers, replace entire content
        const convertedPrices: string[] = [];
        for (const parsed of prices) {
          const result = convertPrice(parsed, rates, settings.precision, settings.displayUnit);
          if (result) {
            convertedPrices.push(displayText(parsed.original, result.formatted, settings));
            converted = true;
          }
        }
        if (converted) {
          const newText = convertedPrices.join(' ');
          rememberContainer(node, node.innerHTML, node.getAttribute('title'));

          if (isBolPrice) {
            // Bol.com special handling: hide visual spans and update accessibility text
            const visualSpans = node.querySelectorAll('[aria-hidden="true"]');
            for (const span of visualSpans) {
              (span as HTMLElement).style.display = 'none';
            }
            const accessibilitySpan = node.querySelector('span[style*="position: absolute"]');
            if (accessibilitySpan) {
              accessibilitySpan.textContent = newText;
              (accessibilitySpan as HTMLElement).style.cssText = '';
              (accessibilitySpan as HTMLElement).style.fontWeight = 'bold';
            }
          } else {
            // Amazon/Coolblue: replace entire textContent
            node.textContent = newText;
          }

          // Tooltip carries the pre-conversion price (the old code read
          // textContent AFTER replacing it, labeling the ZEC value "Original")
          setOwnTitle(node, `Original: ${originalText.trim()}`);
        }
      } else {
        // For complex content (Wikipedia, etc.), replace within text nodes to preserve HTML
        converted = replacePricesInTextNodes(node, prices, rates, settings, directTextOnly);
      }

      if (converted) {
        node.classList.add(directTextOnly ? PARTIAL_MARKER : CONVERTED_MARKER);
        convertedCount++;
      }
    }
  } finally {
    // Synchronously drain the mutation records produced by our own writes so
    // the observer never re-processes them (see state.ts).
    flushObserverRecords();
  }

  return convertedCount;
}

function isHost(hostname: string, domains: string[]): boolean {
  return domains.some((d) => hostname === d || hostname.endsWith('.' + d));
}

function displayText(original: string, formatted: string, settings: Settings): string {
  return settings.displayMode === 'append' ? `${original} (${formatted})` : formatted;
}

function makeSpan(original: string, converted: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = SPAN_CLASS;
  span.setAttribute('title', `Original: ${original}`);
  span.textContent = converted;
  // Styled inline rather than through an injected stylesheet: a stylesheet with
  // a known id is a one-selector extension detector. text-decoration (not
  // border-bottom) avoids a double underline inside links and adds no height;
  // nowrap keeps "0.42" from splitting off its "ZEC".
  span.style.textDecoration = 'underline dotted';
  span.style.textUnderlineOffset = '0.18em';
  span.style.whiteSpace = 'nowrap';
  span.style.cursor = 'help';
  rememberSpan(span, original);
  return span;
}

// The page's own title is preserved in the WeakMap by rememberContainer.
function setOwnTitle(el: Element, title: string): void {
  el.setAttribute('title', title);
}

/**
 * Replace prices within text nodes of an element, wrapping each converted
 * price in a marked span. The span gives converted prices a visual affordance
 * (dotted underline), an accurate hover tooltip, and a precise revert path
 * that never round-trips innerHTML (so page event listeners survive).
 */
function replacePricesInTextNodes(
  element: Element,
  prices: ParsedPrice[],
  rates: RatesData,
  settings: Settings,
  directTextOnly?: boolean,
): boolean {
  const replacements: Replacement[] = [];
  for (const parsed of prices) {
    const result = convertPrice(parsed, rates, settings.precision, settings.displayUnit);
    if (result) {
      replacements.push({
        original: parsed.original,
        converted: displayText(parsed.original, result.formatted, settings),
      });
    }
  }

  if (replacements.length === 0) return false;

  // Deduplicate replacements by original text (keep first occurrence)
  const seen = new Set<string>();
  const uniqueReplacements = replacements.filter((r) => {
    if (seen.has(r.original)) return false;
    seen.add(r.original);
    return true;
  });

  // Sort by length descending - replace longest matches first
  uniqueReplacements.sort((a, b) => b.original.length - a.original.length);

  const textNodes = directTextOnly
    ? (Array.from(element.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE) as Text[])
    : collectTextNodes(element);

  let anyReplaced = false;
  for (const tNode of textNodes) {
    if (replaceInTextNode(tNode, uniqueReplacements)) {
      anyReplaced = true;
    }
  }

  // Cross-node fallback: a price split across inline children
  // (<span>$</span><span>99</span>) is detected via concatenated textContent
  // but lives in no single text node. When the element's whole text IS the
  // price, replace at the element level.
  if (!anyReplaced && !directTextOnly) {
    const trimmed = element.textContent?.trim() ?? '';
    const match = uniqueReplacements.find((r) => r.original === trimmed);
    if (match) {
      rememberContainer(element, element.innerHTML, element.getAttribute('title'));
      element.textContent = '';
      element.appendChild(makeSpan(match.original, match.converted));
      anyReplaced = true;
    }
  }

  return anyReplaced;
}

// Text nodes eligible for replacement: never inside script/style/etc.,
// contenteditable regions, or our own spans.
function collectTextNodes(element: Element): Text[] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (isSkippedTag(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
      if (parent.closest(`.${SPAN_CLASS}`)) return NodeFilter.FILTER_REJECT;
      if (parent.closest('button, [role="button"]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  let textNode: Text | null;
  while ((textNode = walker.nextNode() as Text | null)) {
    textNodes.push(textNode);
  }
  return textNodes;
}

function replaceInTextNode(tNode: Text, replacements: Replacement[]): boolean {
  const content = tNode.nodeValue || '';
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  let replacedAny = false;

  while (cursor < content.length) {
    let bestIdx = -1;
    let best: Replacement | null = null;
    for (const r of replacements) {
      const idx = content.indexOf(r.original, cursor);
      if (idx === -1) continue;
      if (
        bestIdx === -1
        || idx < bestIdx
        || (idx === bestIdx && best !== null && r.original.length > best.original.length)
      ) {
        bestIdx = idx;
        best = r;
      }
    }
    if (bestIdx === -1 || best === null) break;

    if (bestIdx > cursor) {
      fragment.appendChild(document.createTextNode(content.slice(cursor, bestIdx)));
    }
    fragment.appendChild(makeSpan(best.original, best.converted));
    cursor = bestIdx + best.original.length;
    replacedAny = true;
  }

  if (!replacedAny) return false;

  if (cursor < content.length) {
    fragment.appendChild(document.createTextNode(content.slice(cursor)));
  }
  tNode.parentNode?.replaceChild(fragment, tNode);
  return true;
}

export function revertConversions(): void {
  revertWithin(document);
  flushObserverRecords();
}

// Revert a single previously-converted element (used by the observer when the
// page rewrites content under a converted element).
export function revertElement(el: Element): void {
  revertWithin(el);
  if (el instanceof Element) {
    revertContainer(el);
  }
  flushObserverRecords();
}

function revertWithin(root: ParentNode): void {
  // Span-level conversions: precise swap back to a text node — page listeners
  // on surrounding elements survive.
  for (const span of Array.from(root.querySelectorAll(`.${SPAN_CLASS}`))) {
    // A span we did not create has no WeakMap entry — leave the page's own
    // markup alone rather than rewriting it from an attribute it controls.
    const original = spanOriginalText(span);
    if (original === undefined) continue;
    span.parentNode?.replaceChild(document.createTextNode(original), span);
  }

  for (const el of Array.from(root.querySelectorAll(`.${CONVERTED_MARKER}, .${PARTIAL_MARKER}`))) {
    revertContainer(el);
  }
}

function revertContainer(el: Element): void {
  // Only a snapshot WE took is ever written back. The page cannot supply one.
  const state = takeContainer(el);
  if (state) {
    el.innerHTML = state.html;
    if (state.prevTitle !== null) {
      el.setAttribute('title', state.prevTitle);
    } else {
      el.removeAttribute('title');
    }
  }
  el.classList.remove(CONVERTED_MARKER);
  el.classList.remove(PARTIAL_MARKER);
}
