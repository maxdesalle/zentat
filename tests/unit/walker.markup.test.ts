// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  accessiblePriceText,
  isConvertible,
  looksConcatenated,
  walkPriceElements,
} from '../../src/lib/detection/walker';

beforeEach(() => {
  document.body.innerHTML = '';
});

const texts = () => walkPriceElements(document.body).map((r) => r.text);

describe('split cents do not become a 100x error', () => {
  it('refuses an element whose children concatenated into one long number', () => {
    document.body.innerHTML = '<div id="p"><span>$</span><span>49</span><span>99</span></div>';
    // "$4999" must never be offered as a price.
    expect(texts().some((t) => t.includes('4999'))).toBe(false);
  });

  it('recognises the signature directly', () => {
    document.body.innerHTML = '<div id="a"><span>$</span><span>49</span><span>99</span></div>'
      + '<div id="b"><span>$</span><span>49.99</span></div>';
    const a = document.getElementById('a')!;
    const b = document.getElementById('b')!;
    expect(looksConcatenated(a, a.textContent!)).toBe(true);
    expect(looksConcatenated(b, b.textContent!)).toBe(false);
  });

  it('still converts a split price when a separator survives', () => {
    document.body.innerHTML = '<div><span>$</span><strong>132</strong><sup>.99</sup></div>';
    expect(texts().join(' ')).toContain('132.99');
  });

  it('converts the split price when an accessible copy disambiguates it', () => {
    document.body.innerHTML = '<div><span class="sr-only">$49.99</span>'
      + '<span aria-hidden="true"><span>$</span><span>49</span><span>99</span></span></div>';
    expect(texts().join(' ')).toContain('$49.99');
  });
});

describe('the accessible copy is preferred over split visible text', () => {
  it('reads an aria-label price', () => {
    document.body.innerHTML =
      '<div aria-label="Price: $19.99"><span>19</span><span>99</span></div>';
    expect(accessiblePriceText(document.querySelector('div')!)).toBe('Price: $19.99');
  });

  it('reads an sr-only descendant', () => {
    document.body.innerHTML = '<div><span class="sr-only">$1,299.00</span><span>1,299</span></div>';
    expect(accessiblePriceText(document.querySelector('div')!)).toBe('$1,299.00');
  });

  it('returns null when there is nothing price-shaped', () => {
    document.body.innerHTML = '<div aria-label="Add to cart"><span>$19.99</span></div>';
    expect(accessiblePriceText(document.querySelector('div')!)).toBeNull();
  });
});

describe('interactive controls', () => {
  it('skips a small checkout control', () => {
    document.body.innerHTML = '<button id="b">Buy now — $49.99</button>';
    expect(isConvertible(document.getElementById('b')!)).toBe(false);
  });

  it('skips a link styled as a control', () => {
    document.body.innerHTML = '<a id="a" href="/pay">Pay $49.99</a>';
    expect(isConvertible(document.getElementById('a')!)).toBe(false);
  });

  it('does NOT skip a card-sized container that happens to be clickable', () => {
    // Storefront grids wrap whole tiles in role="button"; measured across real
    // pages, treating those as controls would drop entire category pages.
    document.body.innerHTML = '<div id="card" role="button">'
      + '<img><h3>Wireless Headphones, Over Ear, Noise Cancelling</h3>'
      + '<p>Highly rated by shoppers</p><span>4.5 stars</span><span>$49.99</span></div>';
    expect(isConvertible(document.getElementById('card')!)).toBe(true);
  });
});

describe('eligibility applies however a candidate was collected', () => {
  it('skips an Amazon-style price container inside a control', () => {
    document.body.innerHTML =
      '<button><span class="a-price"><span class="a-offscreen">$19.99</span></span></button>';
    expect(isConvertible(document.querySelector('.a-price')!)).toBe(false);
  });
});
