// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { rememberSpan, SPAN_CLASS } from '../../src/entrypoints/content/markers';

import {
  accessibleCopyCovers,
  accessiblePriceText,
  isConvertible,
  isInteractiveControl,
  isNonPriceText,
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

describe('a price in prose is still a price', () => {
  it('offers a long paragraph its own direct text', () => {
    // AWS states its worked examples inside a 3,581-character paragraph and
    // Apple its subscription terms inside a 2,298-character footnote. The
    // length cap exists so a blob is never replaced AS one price; it was
    // refusing the element outright, so neither page was ever looked at.
    const filler = 'Some explanatory text that goes on at length. '.repeat(40);
    document.body.innerHTML = `<p id="p">${filler}The total comes to $19.99 per month.`
      + `<span>and a child</span>${filler}</p>`;
    expect(texts().some((t) => t.includes('$19.99'))).toBe(true);
  });

  it('still refuses to treat the whole paragraph as one price', () => {
    // It comes back marked directTextOnly, which keeps the whole-element path
    // away from it: only the price's own characters are ever replaced.
    const filler = 'Some explanatory text that goes on at length. '.repeat(40);
    document.body.innerHTML = `<p id="p">${filler}$19.99${filler}</p>`;
    const long = walkPriceElements(document.body).filter((r) => r.text.length > 1000);
    expect(long.length).toBeGreaterThan(0);
    expect(long.every((r) => r.directTextOnly === true)).toBe(true);
  });
});

describe('a long element reads the same on every pass', () => {
  it('counts our own conversion as the price it replaced', () => {
    // A price that was a direct text node on the first pass sits inside a span
    // child on the second. Read plainly, the element's direct text shrinks and
    // the element is offered differently each time; Craigslist drifted on
    // exactly that, and the harness caught it as "second pass changed the
    // page". The comment and the unremembered span are here because childNodes
    // hands back every kind of node, and a span can outlive its original.
    const filler = 'word '.repeat(300);
    document.body.innerHTML = `<p id="p">${filler}$800 more words<!-- note -->`
      + `<span class="${SPAN_CLASS}">stray</span></p>`;
    const before = walkPriceElements(document.body).find((r) => r.node.id === 'p')!;

    // The same element as it looks once that price has been converted.
    document.body.innerHTML = `<p id="p">${filler}<span class="${SPAN_CLASS}">1.00 ZEC</span>`
      + ` more words<!-- note --><span class="${SPAN_CLASS}">stray</span></p>`;
    const ours = document.querySelector(`.${SPAN_CLASS}`)!;
    rememberSpan(ours, '$800');
    const after = walkPriceElements(document.body).find((r) => r.node.id === 'p')!;

    expect(after.text).toBe(before.text);
  });
});

describe('the page may say ZEC for its own reasons', () => {
  it('reads a price in text that mentions ZEC without a number', () => {
    // coinmarketcap.com is the page on the web most about Zcash, and every
    // price on it sits in text that says ZEC: "ZEC/CAD", "ZEC Hits 8-Year
    // High Over $855". Matching the bare word treated the page's own
    // vocabulary as our output, and it converted none of them.
    document.body.innerHTML = '<a id="p">ZEC Hits 8-Year High Over $855</a>';
    expect(isNonPriceText('ZEC Hits 8-Year High Over $855')).toBe(false);
    expect(texts()).toContain('ZEC Hits 8-Year High Over $855');
  });

  it('still refuses our own output', () => {
    expect(isNonPriceText('1.00 ZEC')).toBe(true);
    expect(isNonPriceText('78.3B ZEC')).toBe(true);
    expect(isNonPriceText('2,399,683 zats')).toBe(true);
  });

  it('still refuses a stated rate, which is not a price to convert', () => {
    expect(isNonPriceText('1 ZEC = $783.51')).toBe(true);
  });
});

describe('a join between two digits invents a number', () => {
  it("reads the element's own text when splicing a child would fabricate one", () => {
    // CoinMarketCap puts a coin's price in the <a>'s own text and the
    // percentage change in a child, so reading the element whole gives
    // "$78,426.810.53%" — which parses to nothing anyone wrote.
    document.body.innerHTML = '<a id="p">BitcoinBTC$78,426.81<span>0.53%</span></a>';
    expect(texts()).toContain('BitcoinBTC$78,426.81');
    expect(texts().some((t) => t.includes('810.53'))).toBe(false);
  });

  it('does not change what a split price does', () => {
    // "$" + "49" + "99" joins digits too, but the element has no text of its
    // own to read instead — so this stays where it was, refused by the
    // concatenation guard because no accessible copy resolves it.
    document.body.innerHTML = '<div id="p"><span>$</span><span>49</span><span>99</span></div>';
    expect(texts()).toEqual([]);
  });

  it('leaves a symbol-then-digits join alone', () => {
    // Franklin BBQ: the join is "$" against "4", which fabricates nothing.
    document.body.innerHTML = '<p id="p"><span>$</span>42 / lb</p>';
    expect(texts()).toContain('$42 / lb');
  });

  it('reads our own output as the price it replaced', () => {
    // On the second pass the price is inside a span child, and reading that
    // span's ZEC text instead of the price it replaced changes the answer —
    // which is how Amazon converted more on the second pass than the first.
    // The comment node is here because childNodes hands back every kind.
    document.body.innerHTML = `<a id="p">BTC<!-- c -->`
      + `<span class="${SPAN_CLASS}">0.0128 ZEC</span><span>0.53%</span></a>`;
    const ours = document.querySelector(`.${SPAN_CLASS}`)!;
    rememberSpan(ours, '$78,426.81');
    // "…81" meets "0.53%", so the splice is a fiction and the element's own
    // text is read instead — the same answer as before it was converted.
    expect(texts()).not.toContain('BTC$78,426.810.53%');
  });
});

describe('a currency prefix is part of the price', () => {
  it('converts a button whose whole text is a prefixed price', () => {
    // "CA$0.51" left "CA" behind when the price was stripped out, and two
    // letters read as a call to action — so Humble's discount buttons kept
    // their dollars on a page where everything else had converted.
    document.body.innerHTML = '<button id="b">CA$0.51</button>';
    expect(isInteractiveControl(document.getElementById('b')!)).toBe(false);
  });

  it('still leaves a prefixed price in a real checkout button', () => {
    document.body.innerHTML = '<button id="b">Add to Cart CDN$ 5.19</button>';
    expect(isInteractiveControl(document.getElementById('b')!)).toBe(true);
  });
});

describe('a control keeps its fiat only when it says a verb', () => {
  it.each([
    ['<button id="b">Buy now — $49.99</button>', true],
    ['<button id="b">Add to Cart CDN$ 5.19</button>', true],
    ['<button id="b">Jetzt kaufen 49,99 €</button>', true],
    ['<button id="b">$63Donation</button>', false],
    ['<button id="b">20 oz. Soda$3.50</button>', false],
    ['<button id="b">£1,614 below market average</button>', false],
    ['<div role="button" id="b">C$ 27.99</div>', false],
  ])('%s', (html, expected) => {
    // "Any words at all" kept the fiat on all four of the false cases. None of
    // them asks for anything — they name what the price is FOR. UNICEF's
    // preset amounts, Grubhub's menu items, AutoTrader's price comparison and
    // Steam's clickable price all stayed in dollars because of it.
    document.body.innerHTML = html;
    expect(isInteractiveControl(document.getElementById('b')!)).toBe(expected);
  });
});

describe('a paragraph may mention an amount of ZEC', () => {
  it('reads a price out of prose that also states a ZEC figure', () => {
    // CoinMarketCap's description of Zcash states the circulating supply, and
    // Google Finance's earnings summaries do the same sort of thing. Treating
    // any "N ZEC" as our own output disqualified the whole paragraph, and the
    // real prices in it with it.
    const prose = 'The live Zcash price today is $783.51 USD with a 24-hour trading volume'
      + ' of $99,000,000. The current circulating supply is 16,000,000 ZEC out of a'
      + ' maximum supply of 21,000,000 ZEC, and the price is up today.';
    expect(isNonPriceText(prose)).toBe(false);
  });

  it('still refuses our own output', () => {
    expect(isNonPriceText('1.00 ZEC')).toBe(true);
    expect(isNonPriceText('78.3B ZEC')).toBe(true);
    expect(isNonPriceText('2,399,683 zats')).toBe(true);
  });
});

describe('an accessible copy must account for every price inside', () => {
  it('refuses a label that covers only one price in a large container', () => {
    // An aria-label reading "₹498.00" on a 1,089-character Amazon carousel
    // passed the direct-child test — its immediate children are wrappers — so
    // the copy stood in for the whole subtree. The container was collected as
    // ONE price, marked processed, and the four real prices inside it were
    // never looked at. The label also bypasses the length cap, which is how
    // something that big was treated as a price at all.
    document.body.innerHTML = '<div id="c" aria-label="₹498.00">'
      + '<div><span>₹498.00</span></div>'
      + '<div><span>₹999.00</span></div></div>';
    expect(accessiblePriceText(document.getElementById('c')!)).toBe('₹498.00');
    expect(texts()).toContain('₹999.00');
  });

  it('still stands in when it accounts for the split rendering', () => {
    document.body.innerHTML = '<div id="c" aria-label="$19.99">'
      + '<span class="a-offscreen">$19.99</span>'
      + '<span aria-hidden="true"><span>$</span><span>19</span><span>99</span></span></div>';
    expect(texts()).toContain('$19.99');
  });
});

describe('a price stated in prose is still a price', () => {
  it('reads it out of a body too long to be a price itself', () => {
    // Craigslist states the asking figure four times inside a
    // 10,967-character posting, and the length pre-filter dropped the whole
    // section before anything looked at it.
    // The SECTION is far too long to be a price; the paragraph of prose that
    // states it is not. Craigslist's postings are exactly this shape.
    const para = 'This car has been well maintained and serviced regularly. '.repeat(8);
    const block = `${para}<div>photo</div>`;
    document.body.innerHTML = `<section id="s">${block.repeat(6)}`
      + `Asking $16,995 today.<div>photo</div>${block.repeat(6)}</section>`;
    expect(document.getElementById('s')!.textContent!.length).toBeGreaterThan(4000);
    expect(texts().some((t) => t.includes('$16,995'))).toBe(true);
  });

  it('still refuses a text node too long to be a price', () => {
    // One node at a time, each held to the same length rule as any other
    // candidate — so this cannot be cheaper to abuse than the guard it sits
    // in front of.
    const long = `$19.99 ${'x'.repeat(4000)}`;
    document.body.innerHTML = `<p id="p">${long}</p>`;
    expect(texts().filter((t) => t.length > 1000)).toEqual([]);
  });
});

describe('the prose scan gives up rather than trawling', () => {
  it("stops after enough of an element's own text nodes", () => {
    // A long element with a great many text nodes and no price in the first
    // forty is not worth reading further; the pre-filter it sits in front of
    // exists to stop exactly that kind of work.
    const nodes = Array.from({ length: 60 }, (_, i) => `word${i} <b>x</b>`).join('');
    document.body.innerHTML = `<div id="d">${'padding text '.repeat(400)}${nodes}$19.99</div>`;
    expect(texts().some((t) => t.includes('$19.99'))).toBe(false);
  });
});

describe('four digits after a symbol are only suspect when the digits were split', () => {
  it('reads a four-digit price beside a footnote marker', () => {
    // Apple's lineup page is entirely four-digit prices, each beside a <sup>
    // footnote. Testing the run WITH its symbol refused every one of them,
    // because any child at all made the element eligible for the check.
    document.body.innerHTML = '<p id="p">From $1199 or more<sup>**</sup></p>';
    expect(looksConcatenated(document.getElementById('p')!, 'From $1199 or more**')).toBe(false);
  });

  it('still refuses digits genuinely split across elements', () => {
    document.body.innerHTML = '<div id="p"><span>$</span><span>49</span><span>99</span></div>';
    expect(looksConcatenated(document.getElementById('p')!, '$4999')).toBe(true);
  });

  it('reads a four-digit price whose symbol alone is in a child', () => {
    // Franklin BBQ's shape: the symbol is separate, the digits are whole.
    document.body.innerHTML = '<p id="p"><span>$</span>1199 each</p>';
    expect(looksConcatenated(document.getElementById('p')!, '$1199 each')).toBe(false);
  });
});

describe("an accessible copy must account for the element's own text too", () => {
  it('refuses a summary that covers only part of a long footnote', () => {
    // Apple states its lease terms in a 4,056-character span carrying a
    // 286-character accessible summary. Checking only descendants found
    // nothing to disagree with, so the summary stood in for the lot and three
    // of twelve prices were read.
    document.body.innerHTML = '<span id="c" aria-label="Lease from $24.99 per month">'
      + 'For an iPad Pro with a purchase price of $1199 and a lease of $24.99'
      + '<a href="#f">1</a></span>';
    expect(accessibleCopyCovers(document.getElementById('c')!, 'Lease from $24.99 per month'))
      .toBeNull();
  });

  it('still stands in when the element has no text of its own', () => {
    document.body.innerHTML = '<div id="c" aria-label="$19.99">'
      + '<span class="a-offscreen">$19.99</span><span aria-hidden="true">$19.99</span></div>';
    expect(accessibleCopyCovers(document.getElementById('c')!, '$19.99')).toBe('$19.99');
  });
});
