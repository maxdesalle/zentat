import type { RatesData } from '../../lib/storage/rates';
import type { Settings } from '../../lib/storage/settings';
import { convertPrice } from '../../lib/conversion/convert';
import { detectPrices } from './detector';
import { bolPriceContainerSet } from '../../lib/detection/walker';

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

  for (const { node, text, prices } of detections) {
    // Skip if already processed
    if (node.closest(`.${CONVERTED_MARKER}`)) continue;

    const originalText = node.textContent || '';
    const trimmedOriginal = originalText.trim();

    // Determine if we can use partial replacement:
    // Only if the element's trimmed content matches exactly what we parsed
    // Complex structures (like Amazon .a-price with multiple children) have
    // textContent that concatenates all child text, so partial replacement would corrupt them
    const canUsePartialReplacement = trimmedOriginal === text;

    let newText = originalText;
    let converted = false;

    if (canUsePartialReplacement && prices.length > 0) {
      // Calculate offset for leading whitespace
      const trimStart = originalText.indexOf(text);
      const offset = trimStart >= 0 ? trimStart : 0;

      // Replace all prices in reverse order (to preserve indices)
      for (let i = prices.length - 1; i >= 0; i--) {
        const parsed = prices[i];
        const result = convertPrice(parsed, rates, settings.precision);
        if (result) {
          const start = parsed.startIndex + offset;
          const end = parsed.endIndex + offset;
          newText = newText.slice(0, start) + result.formatted + newText.slice(end);
          converted = true;
        }
      }
    } else {
      // For complex structures or when text doesn't match exactly,
      // convert all prices and join them (typically just one price)
      const convertedPrices: string[] = [];
      for (const parsed of prices) {
        const result = convertPrice(parsed, rates, settings.precision);
        if (result) {
          convertedPrices.push(result.formatted);
          converted = true;
        }
      }
      if (converted) {
        newText = convertedPrices.join(' ');
      }
    }

    if (converted) {
      if (!node.hasAttribute('data-zentat-original')) {
        node.setAttribute('data-zentat-original', node.innerHTML);
      }

      // Bol.com special handling: replace entire container, hide visual price spans
      if (bolPriceContainerSet.has(node)) {
        // Hide aria-hidden visual spans and update accessibility text
        const visualSpans = node.querySelectorAll('[aria-hidden="true"]');
        for (const span of visualSpans) {
          (span as HTMLElement).style.display = 'none';
        }
        // Update the accessibility span text
        const accessibilitySpan = node.querySelector('span[style*="position: absolute"]');
        if (accessibilitySpan) {
          accessibilitySpan.textContent = newText;
          // Make it visible
          (accessibilitySpan as HTMLElement).style.cssText = '';
          (accessibilitySpan as HTMLElement).style.fontWeight = 'bold';
        }
      } else {
        node.textContent = newText;
      }

      node.classList.add(CONVERTED_MARKER);
      node.setAttribute('title', `Original: ${originalText}`);
      convertedCount++;
    }
  }

  return convertedCount;
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
