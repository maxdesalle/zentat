import type { RatesData } from '../../lib/storage/rates';
import type { Settings } from '../../lib/storage/settings';
import { convertPrice } from '../../lib/conversion/convert';
import { detectPrices } from './detector';
import { bolPriceContainerSet } from '../../lib/detection/walker';
import type { ParsedPrice } from '../../lib/detection/parser';

const CONVERTED_MARKER = 'zentat-processed';

export function convertPricesInDocument(rates: RatesData, settings: Settings): number {
  if (!settings.enabled) return 0;
  if (Object.keys(rates.rates).length === 0) return 0;
  if (!document.body) return 0;

  return convertPricesInNode(document.body, rates, settings);
}

export function convertPricesInNode(root: Node, rates: RatesData, settings: Settings): number {
  const detections = detectPrices(root, settings.currencies);
  let convertedCount = 0;

  const isCoolblue = window.location.hostname.includes('coolblue');

  for (const { node, text, prices } of detections) {
    // Skip if already processed
    if (node.closest(`.${CONVERTED_MARKER}`)) continue;

    if (isCoolblue) {
      console.log('Zentat converter:', { text, prices, ratesAvailable: Object.keys(rates.rates) });
    }

    if (!node.hasAttribute('data-zentat-original')) {
      node.setAttribute('data-zentat-original', node.innerHTML);
    }

    let converted = false;

    // Check if this is a special price container (Amazon .a-price, bol.com, Coolblue, DigitalOcean)
    // These have structured child elements that need full textContent replacement
    const isAmazonPrice = node.classList.contains('a-price');
    const isBolPrice = bolPriceContainerSet.has(node);
    const isCoolbluePrice = window.location.hostname.includes('coolblue');
    const isDigitalOceanPrice = window.location.hostname.includes('digitalocean') &&
      (node.classList.contains('pricing') || node.closest('.pricing') !== null);

    if (isAmazonPrice || isBolPrice || isCoolbluePrice || isDigitalOceanPrice) {
      // For structured price containers, replace entire content
      const convertedPrices: string[] = [];
      for (const parsed of prices) {
        const result = convertPrice(parsed, rates, settings.precision);
        if (result) {
          convertedPrices.push(result.formatted);
          converted = true;
        }
      }
      if (converted) {
        const newText = convertedPrices.join(' ');

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
      }
    } else {
      // For complex content (Wikipedia, etc.), replace within text nodes to preserve HTML
      converted = replacePricesInTextNodes(node, prices, rates, settings);
    }

    if (converted) {
      node.classList.add(CONVERTED_MARKER);
      const originalText = node.textContent || '';
      node.setAttribute('title', `Original: ${originalText}`);
      convertedCount++;
    }
  }

  return convertedCount;
}

/**
 * Replace prices within text nodes of an element, preserving HTML structure.
 * This prevents destroying links, sup tags, etc. when replacing prices.
 */
function replacePricesInTextNodes(
  element: Element,
  prices: ParsedPrice[],
  rates: RatesData,
  settings: Settings
): boolean {
  // Build a list of replacements, sorted by original length (longest first)
  // This prevents "$1" from being replaced before "$1,000,000,000"
  const replacements: Array<{ original: string; converted: string }> = [];
  for (const parsed of prices) {
    const result = convertPrice(parsed, rates, settings.precision);
    if (result) {
      replacements.push({ original: parsed.original, converted: result.formatted });
    }
  }

  if (replacements.length === 0) return false;

  // Sort by length descending - replace longest matches first
  replacements.sort((a, b) => b.original.length - a.original.length);

  // Walk all text nodes and replace prices
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  let textNode: Text | null;
  while ((textNode = walker.nextNode() as Text | null)) {
    textNodes.push(textNode);
  }

  let anyReplaced = false;

  for (const tNode of textNodes) {
    let content = tNode.nodeValue || '';
    let modified = false;

    for (const { original, converted } of replacements) {
      if (content.includes(original)) {
        content = content.split(original).join(converted);
        modified = true;
      }
    }

    if (modified) {
      tNode.nodeValue = content;
      anyReplaced = true;
    }
  }

  return anyReplaced;
}

export function revertConversions(): void {
  const converted = document.querySelectorAll('.zentat-processed');
  for (const el of converted) {
    // Check for element-level conversion (Amazon-style)
    const originalHtml = el.getAttribute('data-zentat-original');
    if (originalHtml) {
      el.innerHTML = originalHtml;
      el.removeAttribute('data-zentat-original');
      el.removeAttribute('title');
      el.classList.remove('zentat-processed');
      continue;
    }

    // Check for span-replacement conversion
    const originalText = el.getAttribute('data-original');
    if (originalText && el.parentNode) {
      el.parentNode.replaceChild(document.createTextNode(originalText), el);
    }
  }
}
