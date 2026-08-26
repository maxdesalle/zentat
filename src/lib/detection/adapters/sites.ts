import type { SiteAdapter } from './types';

/**
 * The trimmed text of the first `selector` inside `container`, or null when the
 * site did not render one.
 *
 * Null and empty string are not interchangeable here: null tells the walker to
 * fall back to the visible text, an empty string tells it there is no price.
 */
function textIn(container: Element, selector: string): string | null {
  const match = container.querySelector(selector);
  if (!match) return null;
  // textContent is typed as nullable because Document and DocumentType nodes
  // return null there; querySelector only ever yields an Element, so this is a
  // string. Guarding it would be an unreachable branch, not a safety net.
  return match.textContent!.trim();
}

/**
 * The sites that need more than the generic path.
 *
 * Each of these was previously spread across patterns.ts, walker.ts and
 * converter.ts. Here they are one object each, and the shape makes the
 * difference between them legible: Amazon and bol.com publish an accessible
 * copy of the price, the Dutch retailers publish bare numbers in a known
 * currency, and DigitalOcean just needs its pricing tables treated as whole.
 */
export const SITE_ADAPTERS: SiteAdapter[] = [
  {
    id: 'amazon',
    hosts: [
      'amazon.com',
      'amazon.co.uk',
      'amazon.de',
      'amazon.fr',
      'amazon.it',
      'amazon.es',
      'amazon.nl',
      'amazon.ca',
      'amazon.co.jp',
      'amazon.com.au',
      'amazon.com.br',
      'amazon.com.mx',
      'amazon.in',
    ],
    containers: ['.a-price'],
    replaceWhole: ['.a-price'],
    // Checkout controls stay fiat: the merchant will charge fiat.
    exclude: ['#buy-now-button', '#add-to-cart-button', '#one-click-button'],
    // .a-offscreen is the canonical, unsplit price; the visible spans are the
    // styled rendering of the same number.
    extract: (el) => textIn(el, '.a-offscreen'),
  },
  {
    id: 'bol',
    hosts: ['bol.com'],
    assume: { currency: 'EUR' },
    containers: ['.font-produkt'],
    // The extracted text is the accessible sentence, not what is on screen, so
    // there is nothing in the visible markup for a partial replace to match.
    // This used to be carried by a WeakSet the walker filled and the converter
    // read; the adapter refactor stopped filling it and nothing noticed,
    // because no test covered bol's replacement path.
    replaceWhole: ['.font-produkt'],
    // The visible spans are aria-hidden fragments; the absolutely-positioned
    // span carries the whole price as a sentence.
    extract: (el) => textIn(el, 'span[style*="position: absolute"]'),
  },
  {
    id: 'coolblue',
    hosts: ['coolblue.nl', 'coolblue.be'],
    assume: { currency: 'EUR' },
    containers: ['[data-testid="price"]', '.sales-price'],
    replaceWhole: ['[data-testid="price"]', '.sales-price'],
  },
  {
    id: 'mediamarkt',
    hosts: ['mediamarkt.nl', 'mediamarkt.be'],
    assume: { currency: 'EUR' },
  },
  {
    id: 'digitalocean',
    hosts: ['digitalocean.com'],
    containers: ['.pricing'],
    replaceWhole: ['.pricing'],
  },
];
