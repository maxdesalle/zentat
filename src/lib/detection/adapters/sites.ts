import type { SiteAdapter } from './types';

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
    extract: (el) => el.querySelector('.a-offscreen')?.textContent?.trim() ?? null,
  },
  {
    id: 'bol',
    hosts: ['bol.com'],
    assume: { currency: 'EUR' },
    containers: ['.font-produkt'],
    // The visible spans are aria-hidden fragments; the absolutely-positioned
    // span carries the whole price as a sentence.
    extract: (el) =>
      el.querySelector('span[style*="position: absolute"]')?.textContent?.trim() ?? null,
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
