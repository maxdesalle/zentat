// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { rememberSpan, SPAN_CLASS } from '../../src/entrypoints/content/markers';
import {
  accessiblePriceText,
  isConvertible,
  isInteractiveControl,
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

  it('converts a price in a link, which is navigation rather than payment', () => {
    document.body.innerHTML = '<a id="a" href="/pay">Pay $49.99</a>';
    expect(isConvertible(document.getElementById('a')!)).toBe(true);
  });

  it('converts an option price in a label, which charges nobody anything', () => {
    // Apple's configurator rows are a <label> around a radio. Skipping them
    // left "48GB – $2,000.00" in dollars beside every other price on the page
    // already rendered in ZEC. Amazon's "Coupon price $8.99" is the same
    // shape, a label around a checkbox. Choosing is not paying.
    document.body.innerHTML =
      '<label id="l"><input type="radio"><span>48GB</span><span>$2,000.00</span></label>';
    expect(isConvertible(document.getElementById('l')!)).toBe(true);
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
  it('skips an Amazon-style price container inside a checkout control', () => {
    // The button has to ask for something. A bare "$19.99" in a <button> is a
    // price rendered clickable, and that converts.
    document.body.innerHTML = '<button>Add to Cart <span class="a-price">'
      + '<span class="a-offscreen">$19.99</span></span></button>';
    expect(isConvertible(document.querySelector('.a-price')!)).toBe(false);
  });
});

describe('a prefixed accessibility class is still an accessibility class', () => {
  it('reads a d-sr-only copy beside an aria-hidden split rendering', () => {
    // shop.billa.at writes the canonical price in a .d-sr-only span and paints
    // the visible one as "1" plus a superscript "80 €". The selector that
    // RECOGNISES accessibility text matched .sr-only exactly while the rule
    // that SKIPS it matched by substring, so this node was skipped as
    // accessibility text and never offered as accessibility text. The
    // superscript converted alone: eighty euros for a €1,80 carton, 44x.
    document.body.innerHTML = '<div id="p"><span class="d-sr-only">1,80 €</span>'
      + '<span aria-hidden="true">1</span>'
      + '<span class="sup" aria-hidden="true">80 €</span></div>';
    expect(accessiblePriceText(document.getElementById('p')!)).toBe('1,80 €');
    // Exactly one candidate, and it is the whole price. The superscript is
    // never offered on its own, which is the reading that was 44x high.
    expect(texts()).toEqual(['1,80 €']);
  });

  it('still reads the copy once our own conversion is inside it', () => {
    // Read raw, a converted copy says "ZEC", isNonPriceText rejects it as our
    // own output, and the element stops being collected — which frees the
    // aria-hidden fragments beside it to convert as prices of their own on the
    // next pass. The observer runs a pass per mutation batch, so that
    // compounds on a live page.
    document.body.innerHTML = `<div id="p"><span class="d-sr-only">`
      + `<span class="${SPAN_CLASS}">0.0025 ZEC</span></span></div>`;
    const own = document.querySelector(`.${SPAN_CLASS}`)!;
    rememberSpan(own, '1,80 €');
    expect(accessiblePriceText(document.getElementById('p')!)).toBe('1,80 €');
  });

  it('contributes nothing for a marked span whose original was forgotten', () => {
    // A span can outlive its remembered original — reverting one element
    // clears its entry. Restoring "undefined" into the text would invent a
    // price out of a bookkeeping gap.
    document.body.innerHTML = `<div id="p"><span class="d-sr-only">£9.99 `
      + `<span class="${SPAN_CLASS}">0.0128 ZEC</span></span></div>`;
    expect(accessiblePriceText(document.getElementById('p')!)).toBe('£9.99');
  });
});

describe('a child with no number in it is not a child with a price', () => {
  it('offers the parent when the pieces are a symbol, a number and a code', () => {
    // GitHub writes "<sup>$</sup> <span>21</span> <span>USD</span>". The quick
    // pattern matches a bare "USD", so the parent deferred to a child that was
    // only a currency label — while no child held a whole price and the
    // parent's own direct text was three spaces. The price was offered to
    // nobody, and every price on that page above the free tier stayed fiat.
    document.body.innerHTML = '<span id="p"><sup>$</sup> <span>21</span>'
      + ' <span>USD</span></span>';
    expect(texts()).toContain('$ 21 USD');
  });

  it('still defers to a child that holds a whole price', () => {
    document.body.innerHTML = '<p id="p">$10 – <span>$8</span></p>';
    // The parent is offered for its own direct text only; the child is its own
    // candidate. Both prices convert, neither twice.
    expect(texts()).toContain('$8');
  });
});

describe('a control keeps its fiat only when it asks the user to act', () => {
  it('leaves a checkout button alone', () => {
    document.body.innerHTML = '<button id="b">Buy now — $49.99</button>';
    expect(isConvertible(document.getElementById('b')!)).toBe(false);
  });

  it('leaves an add-to-cart button alone even with the price inside it', () => {
    document.body.innerHTML = '<button id="b">Add to Cart CDN$ 5.19</button>';
    expect(isConvertible(document.getElementById('b')!)).toBe(false);
  });

  it('converts a price that merely happens to be clickable', () => {
    // Steam wraps the price ITSELF in role="button": the whole text is
    // "C$ 27.99". Take the price out and there is nothing left, so there is
    // nothing being asked. Twenty-two prices on one store page.
    document.body.innerHTML = '<div role="button" id="b"><div>C$ 27.99</div></div>';
    expect(isInteractiveControl(document.getElementById('b')!)).toBe(false);
  });

  it('converts a preset amount button', () => {
    // BUTTON used to be a skipped TAG, so no price inside one ever converted
    // whatever it said. A donation preset asks nothing; it offers an amount.
    document.body.innerHTML = '<button id="b">$63</button>';
    expect(isConvertible(document.getElementById('b')!)).toBe(true);
  });
});
