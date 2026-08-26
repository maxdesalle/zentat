// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { SPAN_CLASS } from '../../src/entrypoints/content/markers';
import { textLengthOf } from '../../src/lib/detection/dom';
import {
  accessibleCopyCovers,
  accessiblePriceText,
  isConvertible,
  isInteractiveControl,
  isNonPriceText,
  isSkippedTag,
  looksConcatenated,
  textOf,
  walkPriceElements,
} from '../../src/lib/detection/walker';

// Spec: tests/trees/walker.tree
// Markup regressions from real sites live in walker.markup.test.ts, and the
// pass budget has its own timing-sensitive file in walker.budget.test.ts.

function render(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

function onHost(hostname: string) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hostname },
    writable: true,
    configurable: true,
  });
}

function textsFrom(html: string): string[] {
  return walkPriceElements(render(html)).map((r) => r.text);
}

beforeEach(() => {
  document.body.innerHTML = '';
  onHost('example.com');
});

describe('isSkippedTag', () => {
  describe('given a tag that cannot hold a real price', () => {
    it('is skipped', () => {
      // Named individually: each one is a place a number can appear that is
      // not a price a shopper pays — markup, form state, code samples, or a
      // document Zentat has no business rewriting.
      for (
        const tag of [
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
        ]
      ) {
        expect(isSkippedTag(tag)).toBe(true);
      }
    });
  });

  describe('given a button', () => {
    it('is skipped', () => {
      // A checkout CTA saying "Pay $49.99 now" must never show a ZEC amount
      // the merchant will not actually charge.
      expect(isSkippedTag('BUTTON')).toBe(true);
    });
  });

  describe('given an ordinary tag', () => {
    it('is not skipped', () => {
      expect(isSkippedTag('SPAN')).toBe(false);
    });
  });

  describe('when the tag arrives lower-cased', () => {
    it('is still recognised', () => {
      // SVG and MathML elements report a lowercase tagName in HTML documents.
      expect(isSkippedTag('svg')).toBe(true);
    });
  });
});

describe('textLengthOf', () => {
  describe('given a node with text', () => {
    it('reports the untrimmed length', () => {
      // Untrimmed on purpose: this is the cheap check that decides whether an
      // element is worth cloning, and trimming it would mean reading the text
      // twice to save reading it once.
      render('<div id="p">  $19.99  </div>');
      expect(textLengthOf(document.getElementById('p'))).toBe(10);
    });
  });

  describe('given a node with no text at all', () => {
    it('reports nothing', () => {
      // textContent is typed `string | null` because a Document and a
      // DocumentType really do answer null in a browser. happy-dom answers ''
      // for both, so the null case is stated directly rather than staged.
      expect(textLengthOf(null)).toBe(0);
      expect(textLengthOf(undefined)).toBe(0);
      expect(textLengthOf({ textContent: null } as unknown as Node)).toBe(0);
    });
  });
});

describe('textOf', () => {
  describe('given an element', () => {
    it('returns its trimmed text', () => {
      render('<div id="p">  $19.99  </div>');
      expect(textOf(document.getElementById('p'))).toBe('$19.99');
    });
  });

  describe('given a text node', () => {
    it('returns its trimmed value', () => {
      expect(textOf(document.createTextNode('  $8  '))).toBe('$8');
    });
  });

  describe('given nothing', () => {
    it('returns an empty string', () => {
      // querySelector and closest both answer null, and every caller wants a
      // string it can test a regex against.
      expect(textOf(null)).toBe('');
      expect(textOf(undefined)).toBe('');
    });
  });

  describe('given a node whose text is null', () => {
    it('returns an empty string', () => {
      // Document and DocumentType really do answer null in a browser, which is
      // why the DOM types say `string | null`; happy-dom hands back '' instead,
      // so the shape has to be built by hand. A throw from here would land
      // mid-pass and leave the page half converted.
      expect(textOf({ textContent: null } as unknown as Node)).toBe('');
    });
  });
});

describe('isNonPriceText', () => {
  describe('given text this extension itself produced', () => {
    it('rejects a ZEC amount', () => {
      // Re-parsing our own output is what let conversions compound on sites
      // with bare-number patterns.
      expect(isNonPriceText('0.062 ZEC')).toBe(true);
    });

    it('rejects a zats amount', () => {
      expect(isNonPriceText('6,200 zats')).toBe(true);
    });

    it('rejects a single zat', () => {
      // Our own output at the smallest magnitude. Reading it back as a price
      // is how a conversion compounds into a wrong number.
      expect(isNonPriceText('1 zat')).toBe(true);
    });
  });

  describe('given a rating', () => {
    it('rejects an out-of-five score', () => {
      expect(isNonPriceText('4.5 out of 5 stars')).toBe(true);
    });

    it('rejects a score with no word after it', () => {
      // "4.5 out of 5" appears on its own in review summaries, with nothing
      // after it for the star rule to catch.
      expect(isNonPriceText('4.5 out of 5')).toBe(true);
    });

    it('rejects a single star, spaced or not', () => {
      expect(isNonPriceText('1 star')).toBe(true);
      expect(isNonPriceText('5stars')).toBe(true);
    });

    it('rejects a star count', () => {
      expect(isNonPriceText('5 stars')).toBe(true);
      expect(isNonPriceText('$5 Starship kit')).toBe(false);
    });
  });

  describe('given a sales or review count', () => {
    it('rejects it', () => {
      expect(isNonPriceText('10K+ bought')).toBe(true);
      expect(isNonPriceText('2,300 reviews')).toBe(true);
    });

    it('rejects a single one, spaced or not', () => {
      expect(isNonPriceText('1 review')).toBe(true);
      expect(isNonPriceText('1 rating')).toBe(true);
      expect(isNonPriceText('300sold')).toBe(true);
    });
  });

  describe('given a bare number', () => {
    it('rejects it', () => {
      expect(isNonPriceText('4.5')).toBe(true);
      expect(isNonPriceText('42')).toBe(true);
    });

    it('rejects one with cents but not a longer fraction', () => {
      // Two decimals is a rating or a bare amount; more than two is a
      // measurement, and neither is a price without a currency on it.
      expect(isNonPriceText('4.55')).toBe(true);
      expect(isNonPriceText('4.5551')).toBe(false);
    });
  });

  describe('given parenthesised text', () => {
    describe('given it holds no currency symbol', () => {
      it('rejects it', () => {
        expect(isNonPriceText('(2 left)')).toBe(true);
        expect(isNonPriceText('(123 reviews)')).toBe(true);
      });
    });

    describe('given it holds a currency symbol', () => {
      it('keeps it', () => {
        expect(isNonPriceText('($19.99)')).toBe(false);
      });
    });

    describe('given the parenthesis is not at the start', () => {
      it('keeps it', () => {
        // The rule is about a parenthesised aside standing alone. A price
        // followed by one is still a price.
        expect(isNonPriceText('Bag (2 left)')).toBe(false);
      });
    });
  });

  describe('given an ordinary price', () => {
    it('keeps it', () => {
      expect(isNonPriceText('$19.99')).toBe(false);
    });
  });
});

describe('isInteractiveControl', () => {
  describe('given the element is not inside a control', () => {
    it('is not a control', () => {
      render('<div><span id="p">$19.99</span></div>');
      expect(isInteractiveControl(document.getElementById('p')!)).toBe(false);
    });
  });

  describe('given a short control', () => {
    it('is a control', () => {
      render('<a href="/pay"><span id="p">Pay $49.99</span></a>');
      expect(isInteractiveControl(document.getElementById('p')!)).toBe(true);
    });
  });

  describe('given a large product tile wrapped in a link', () => {
    it('is not a control', () => {
      // Modern storefronts wrap whole tiles in an <a>. Skipping those would
      // drop entire category pages; only about 1% of prices sit in a real
      // control, so the test is size rather than tag.
      render(
        '<a href="/product"><h2>A rather long product title that runs on</h2>'
          + '<p>Some description text that also runs on for a while</p>'
          + '<span id="p">$19.99</span></a>',
      );
      expect(isInteractiveControl(document.getElementById('p')!)).toBe(false);
    });
  });

  describe('given a control with many descendants', () => {
    it('is not a control', () => {
      const kids = Array.from({ length: 14 }, (_, i) => `<i>${i}</i>`).join('');
      render(`<a href="/x">${kids}<span id="p">$5</span></a>`);
      expect(isInteractiveControl(document.getElementById('p')!)).toBe(false);
    });
  });

  describe('at the size boundaries', () => {
    // These two numbers are the whole rule. One character or one element
    // either side decides whether a checkout button keeps its fiat price or
    // an entire category page stops converting.
    it('treats a control of exactly the maximum length as a control', () => {
      const exactly40 = 'Pay now for this item and save money!!!!'.slice(0, 40);
      render(`<a href="/pay"><span id="p">${exactly40}</span></a>`);
      expect(isInteractiveControl(document.getElementById('p')!)).toBe(true);
    });

    it('treats a control with exactly the maximum descendants as a control', () => {
      const eleven = Array.from({ length: 11 }, (_, i) => `<i>${i}</i>`).join('');
      render(`<a href="/pay">${eleven}<span id="p">$5</span></a>`);
      expect(isInteractiveControl(document.getElementById('p')!)).toBe(true);
    });

    it('treats one descendant past the maximum as a tile', () => {
      const twelve = Array.from({ length: 12 }, (_, i) => `<i>${i}</i>`).join('');
      render(`<a href="/pay">${twelve}<span id="p">$5</span></a>`);
      expect(isInteractiveControl(document.getElementById('p')!)).toBe(false);
    });
  });
});

describe('looksConcatenated', () => {
  describe('given a single child', () => {
    it('is not concatenated', () => {
      render('<div id="p"><span>$19.99</span></div>');
      expect(looksConcatenated(document.getElementById('p')!, '$19.99')).toBe(false);
    });

    describe('given that child carries the cents', () => {
      it('is concatenated', () => {
        // `$18<sup>79</sup>` is ONE child and reads as "$1879". Requiring two
        // walked the commonest superscript-cents markup on the web straight
        // past a guard written to stop hundredfold errors.
        render('<div id="p">$18<sup>79</sup></div>');
        expect(looksConcatenated(document.getElementById('p')!, '$1879')).toBe(true);
      });
    });
  });

  describe('given several children and a long unbroken digit run', () => {
    it('is concatenated', () => {
      // $<span>49</span><span>99</span> reads as "$4999": a silent 100x error,
      // and one of the most common price markups on the web.
      render('<div id="p"><span>49</span><span>99</span></div>');
      expect(looksConcatenated(document.getElementById('p')!, '$4999')).toBe(true);
    });
  });

  describe('given several children and an ordinary price', () => {
    it('is not concatenated', () => {
      render('<div id="p"><span>$19</span><span>.99</span></div>');
      expect(looksConcatenated(document.getElementById('p')!, '$19.99')).toBe(false);
    });
  });

  describe('given the symbol is spaced away from the digits', () => {
    it('is still concatenated', () => {
      // Styled prices routinely put whitespace, including a non-breaking
      // space, between the symbol and the number.
      render('<div id="p"><span>49</span><span>99</span></div>');
      expect(looksConcatenated(document.getElementById('p')!, '$ 4999')).toBe(true);
      expect(looksConcatenated(document.getElementById('p')!, '$\u00A04999')).toBe(true);
    });
  });

  describe('given the run of digits is followed by other text', () => {
    it('is still concatenated', () => {
      // "$4999/mo" is the same lost separator as "$4999" — the unit after it
      // says nothing about whether the cents went missing.
      render('<div id="p"><span>49</span><span>99</span></div>');
      expect(looksConcatenated(document.getElementById('p')!, '$4999/mo')).toBe(true);
    });
  });
});

describe('accessiblePriceText', () => {
  describe('given an aria-label holding a price', () => {
    it('uses the label', () => {
      render('<div id="p" aria-label="$19.99"><span>19</span><span>99</span></div>');
      expect(accessiblePriceText(document.getElementById('p')!)).toBe('$19.99');
    });
  });

  describe('given an aria-label holding a price with whitespace', () => {
    it('trims the surrounding whitespace', () => {
      // The label becomes the text the converter searches for, and a stray
      // newline means it matches nothing at all.
      render('<div id="p" aria-label="  $19.99  ">19</div>');
      expect(accessiblePriceText(document.getElementById('p')!)).toBe('$19.99');
    });
  });

  describe('given an aria-label that is not a price', () => {
    it('ignores the label', () => {
      render('<div id="p" aria-label="Add to cart">$19.99</div>');
      expect(accessiblePriceText(document.getElementById('p')!)).toBeNull();
    });
  });

  describe('given a visually hidden price', () => {
    it('uses that text', () => {
      render('<div id="p"><span class="a-offscreen">$19.99</span><span>19</span></div>');
      expect(accessiblePriceText(document.getElementById('p')!)).toBe('$19.99');
    });
  });

  describe('given a visually hidden element that is not a price', () => {
    it('ignores it', () => {
      render('<div id="p"><span class="sr-only">4.5 out of 5 stars</span></div>');
      expect(accessiblePriceText(document.getElementById('p')!)).toBeNull();
    });
  });

  describe('given a visually hidden element holding ordinary words', () => {
    it('ignores it', () => {
      // Screen-reader spans carry all sorts of prose. Only one that reads as
      // a price may stand in for the element's text.
      render('<div id="p"><span class="sr-only">free returns</span>$19.99</div>');
      expect(accessiblePriceText(document.getElementById('p')!)).toBeNull();
    });
  });

  describe('given no accessible copy', () => {
    it('reports nothing', () => {
      render('<div id="p">$19.99</div>');
      expect(accessiblePriceText(document.getElementById('p')!)).toBeNull();
    });
  });
});

describe('accessibleCopyCovers', () => {
  describe('given the copy accounts for every price inside', () => {
    it('may stand in for the element', () => {
      // "-40% $18.79" covers a child reading "$18.79": same digits, so the
      // copy really is describing this element and nothing else.
      render('<div id="p"><span>-40%</span><span>$18.79</span></div>');
      expect(accessibleCopyCovers(document.getElementById('p')!, '-40% $18.79'))
        .toBe('-40% $18.79');
    });
  });

  describe('given a child holds a price the copy does not mention', () => {
    it('may not', () => {
      // This is the guard that stops <body> adopting the first hidden price
      // on the page as its own whole text — which marked the body converted
      // and silently dropped every other price for the rest of the visit.
      render('<div id="p"><span>$18.79</span><span>$0.47 / ounce</span></div>');
      expect(accessibleCopyCovers(document.getElementById('p')!, '$18.79')).toBeNull();
    });
  });

  describe('given a child holds no price at all', () => {
    it('is not counted against the copy', () => {
      render('<div id="p"><span>Deal of the day</span><span>$18.79</span></div>');
      expect(accessibleCopyCovers(document.getElementById('p')!, '$18.79')).toBe('$18.79');
    });
  });

  describe('given a child holds a number that is not a price', () => {
    it('is not counted against the copy', () => {
      // An SKU or a model number shares no digits with the price, and holding
      // it against the copy would refuse a perfectly good one.
      render('<div id="p"><span>SKU 12345</span><span>$18.79</span></div>');
      expect(accessibleCopyCovers(document.getElementById('p')!, '$18.79')).toBe('$18.79');
    });
  });

  describe('given a child holds our own earlier output', () => {
    it('is not counted against the copy', () => {
      render(
        `<div id="p"><span class="${SPAN_CLASS}">6,200 zats</span>`
          + '<span>$18.79</span></div>',
      );
      expect(accessibleCopyCovers(document.getElementById('p')!, '$18.79')).toBe('$18.79');
    });
  });

  describe('given the copy and the child punctuate the price differently', () => {
    it('compares the digits', () => {
      // The accessible copy and the visible rendering almost never agree on
      // separators — that is most of why the copy exists.
      render('<div id="p"><span>$1,879</span></div>');
      expect(accessibleCopyCovers(document.getElementById('p')!, '$1879')).toBe('$1879');
    });
  });

  describe('given there is no copy', () => {
    it('reports nothing', () => {
      render('<div id="p">$18.79</div>');
      expect(accessibleCopyCovers(document.getElementById('p')!, null)).toBeNull();
    });
  });
});

describe('isConvertible', () => {
  describe('given a skipped tag', () => {
    it('is not convertible', () => {
      render('<textarea id="p">$19.99</textarea>');
      expect(isConvertible(document.getElementById('p')!)).toBe(false);
    });
  });

  describe('given an editable element', () => {
    it('is not convertible', () => {
      // Rewriting text under a cursor loses the user's work.
      render('<div id="p" contenteditable="true">$19.99</div>');
      expect(isConvertible(document.getElementById('p')!)).toBe(false);
    });
  });

  describe('given a hidden element', () => {
    it('is not convertible', () => {
      render('<div id="p" hidden>$19.99</div>');
      expect(isConvertible(document.getElementById('p')!)).toBe(false);
    });
  });

  describe('given a control', () => {
    it('is not convertible', () => {
      render('<a href="/pay"><span id="p">Pay $49.99</span></a>');
      expect(isConvertible(document.getElementById('p')!)).toBe(false);
    });
  });

  describe('given an ordinary element', () => {
    it('is convertible', () => {
      render('<div id="p">$19.99</div>');
      expect(isConvertible(document.getElementById('p')!)).toBe(true);
    });
  });
});

describe('walkPriceElements', () => {
  describe('given a root that is not an element or document', () => {
    it('returns nothing', () => {
      expect(walkPriceElements(document.createTextNode('$19.99'))).toEqual([]);
    });
  });

  describe('given an element whose text is far too long to be a price', () => {
    it('is skipped before its text is examined', () => {
      // The cheap length check runs first so a page-sized element never gets
      // cloned or pattern-matched. A whole article is not a price.
      const long = `$19.99 ${'word '.repeat(3000)}`;
      const results = walkPriceElements(render(`<p>${long}</p>`));
      expect(results.filter((r) => r.node.tagName === 'P')).toHaveLength(0);
    });
  });

  describe('given text of exactly the greatest length a price may be', () => {
    it('is still collected', () => {
      // A thousand characters is the line between "a price with words round
      // it" and "a paragraph". One character either side changes which.
      const text = `$19.99${'x'.repeat(994)}`;
      expect(text).toHaveLength(1000);
      expect(textsFrom(`<span>${text}</span>`)).toEqual([text]);
    });
  });

  describe('given text one character longer', () => {
    it('is skipped', () => {
      const text = `$19.99${'x'.repeat(995)}`;
      expect(text).toHaveLength(1001);
      expect(textsFrom(`<span>${text}</span>`)).toEqual([]);
    });
  });

  describe('given an element that is only whitespace', () => {
    it('is skipped', () => {
      expect(textsFrom('<span>   </span>')).toEqual([]);
    });
  });

  describe('given a parent whose direct text spans several nodes', () => {
    it('keeps them separated', () => {
      // Joined with nothing between them, "$10" and "$8" become "$10$8" and
      // parse as one number.
      const results = walkPriceElements(render(
        '<p>$10<span>x</span>$8<span><em>$5</em></span></p>',
      ));
      const parent = results.find((r) => r.node.tagName === 'P');
      expect(parent?.text).toContain('$10 ');
    });
  });

  describe('given a parent whose direct text is too long', () => {
    it('is left alone', () => {
      const filler = 'word '.repeat(300);
      const results = walkPriceElements(render(
        `<p>$10 ${filler}<span>$8</span></p>`,
      ));
      expect(results.filter((r) => r.directTextOnly)).toHaveLength(0);
    });
  });

  describe('given a parent of exactly the greatest length holding a child price', () => {
    it('converts its own text and defers the child', () => {
      // A thousand characters is the most an element may be and still be read
      // as a price with words round it. One character either side decides
      // whether a whole product card converts or none of it does.
      const own = `$10 ${'x'.repeat(994)}`;
      const html = `<p>${own}<span>$8</span></p>`;
      expect(`${own}$8`).toHaveLength(1000);
      const results = walkPriceElements(render(html));
      const parent = results.find((r) => r.node.tagName === 'P');
      expect(parent?.directTextOnly).toBe(true);
      expect(results.map((r) => r.text)).toContain('$8');
    });
  });

  describe('given a parent whose direct text is padded with whitespace', () => {
    it('collects the text tight', () => {
      // The collected text is what the converter searches for the price in,
      // and what the tooltip shows as the original. Whitespace either side
      // belongs to the page's layout, not to the price.
      const results = walkPriceElements(render('<p>  $10  <span>$8</span></p>'));
      expect(results.find((r) => r.node.tagName === 'P')?.text).toBe('$10');
    });
  });

  describe('given a page that exhausts the pass budget', () => {
    it('stops rather than freezing the tab', () => {
      // The per-element cap bounds one string, not the pass. The number
      // patterns are quadratic on long digit runs, so an unbounded pass is
      // seconds of frozen main thread.
      const filler = '1'.repeat(900);
      const cells = Array.from({ length: 400 }, () => `<p>$19.99 ${filler}</p>`).join('');
      expect(walkPriceElements(render(cells)).length).toBeLessThan(400);
    });
  });

  describe('given the budget lands exactly on zero', () => {
    it('stops there', () => {
      // Two hundred elements of a thousand characters is the budget exactly.
      // Whether the next one is examined turns on one comparison, and the
      // whole point of the budget is that the pass ends rather than runs on.
      const filler = `$19.99 ${'x'.repeat(993)}`;
      expect(filler).toHaveLength(1000);
      const page = Array.from({ length: 200 }, () => `<p>${filler}</p>`).join('')
        + '<p>$1,600</p>';
      const texts = walkPriceElements(render(page)).map((r) => r.text);
      expect(texts).not.toContain('$1,600');
    });
  });

  describe('given an element whose class is reported as an object', () => {
    it('is still considered', () => {
      // SVG elements report className as an SVGAnimatedString rather than a
      // string. Only <svg> itself is a skipped tag, so its children reach the
      // class check and a bare regex test on the object matches nothing.
      const root = render('<div id="p">$19.99</div>');
      const element = document.getElementById('p')!;
      Object.defineProperty(element, 'className', {
        value: { baseVal: 'price', animVal: 'price' },
        configurable: true,
      });
      expect(walkPriceElements(root).map((r) => r.text)).toContain('$19.99');
    });
  });

  describe('given an element longer than the pre-filter allows', () => {
    it('is skipped without inspecting its text', () => {
      const long = `$19.99 ${'x'.repeat(4000)}`;
      const results = walkPriceElements(render(`<p>${long}</p>`));
      expect(results.filter((r) => r.node.tagName === 'P')).toHaveLength(0);
    });
  });

  describe('given an element exactly at the pre-filter limit', () => {
    it('is still inspected', () => {
      // Four thousand characters is the line. It is well above what a price
      // can be, so an element on it is still rejected — but by the length
      // rule that knows about prices, not by the one that avoids the clone.
      const text = `$19.99 ${'x'.repeat(3993)}`;
      expect(text).toHaveLength(4000);
      const results = walkPriceElements(render(`<p>${text}</p>`));
      expect(results.filter((r) => r.node.tagName === 'P')).toHaveLength(0);
    });
  });

  describe('given an element read through its accessible copy', () => {
    it('nothing beneath it is collected as well', () => {
      // The copy describes the whole element, so its children are the split
      // rendering of that one price. Collecting them too converts it twice.
      const results = walkPriceElements(render(
        '<div class="p" aria-label="$19.99"><span>$19.99</span></div>',
      ));
      expect(results).toHaveLength(1);
      expect(results[0].node.className).toBe('p');
    });
  });

  describe('given a site adapter declares price containers', () => {
    beforeEach(() => onHost('www.coolblue.nl'));

    it('collects the container as a whole', () => {
      const results = walkPriceElements(
        render('<div data-testid="price"><span>1.349</span></div>'),
      );
      expect(results).toHaveLength(1);
      expect(results[0].text).toBe('1.349');
    });

    it('marks it as a price container', () => {
      // Bare-number patterns only run inside a container a site adapter
      // vouched for; anywhere else they would read every number on the page.
      const results = walkPriceElements(render('<div data-testid="price">1.349</div>'));
      expect(results[0].inPriceContainer).toBe(true);
    });

    it("uses the adapter's own extraction when there is one", () => {
      // bol splits the visible price into aria-hidden fragments and keeps the
      // real one in an absolutely-positioned span. No selector expresses that.
      onHost('www.bol.com');
      const results = walkPriceElements(render(
        '<div class="font-produkt"><span aria-hidden="true">149</span>'
          + "<span style=\"position: absolute\">'149' euro en '95' cent</span></div>",
      ));
      expect(results).toHaveLength(1);
      expect(results[0].text).toBe("'149' euro en '95' cent");
    });

    describe('given the container sits in an excluded region', () => {
      it('is skipped', () => {
        // Amazon's buy box repeats the price inside the buy-now control. A
        // ZEC amount there reads as what will be charged, and it is not.
        onHost('www.amazon.com');
        const results = walkPriceElements(render(
          '<div id="buy-now-button"><span class="a-price">'
            + '<span class="a-offscreen">$19.99</span></span></div>',
        ));
        expect(results.filter((r) => r.inPriceContainer)).toHaveLength(0);
      });
    });

    describe('given the container is not convertible', () => {
      it('is skipped', () => {
        const results = walkPriceElements(render('<div data-testid="price" hidden>1.349</div>'));
        expect(results).toHaveLength(0);
      });
    });

    describe('given the container holds no price', () => {
      it('is skipped', () => {
        const results = walkPriceElements(render('<div data-testid="price">Sold out</div>'));
        expect(results).toHaveLength(0);
      });
    });

    describe('given the container holds only our own earlier output', () => {
      it('is skipped', () => {
        // A bare-number adapter site is the one place our own "1.20" could be
        // re-read as a price, so the container pass has to recognise it.
        const results = walkPriceElements(render(
          `<div data-testid="price"><span class="${SPAN_CLASS}">1.20 ZEC</span></div>`,
        ));
        expect(results).toHaveLength(0);
      });

      it('still reads a price the page added beside it', () => {
        // What this must NOT do is disqualify the container outright: once one
        // price inside it had converted, the container's text contained "ZEC"
        // and every later pass rejected it — so a price the site rendered
        // afterwards could never convert.
        const results = walkPriceElements(render(
          `<div data-testid="price"><span class="${SPAN_CLASS}">1.20 ZEC</span>`
            + `<span>1.349</span></div>`,
        ));
        expect(results).toHaveLength(1);
        expect(results[0].text).toBe('1.349');
      });
    });

    describe("given the container's own text lost its separator", () => {
      it('refuses rather than risk a hundredfold error', () => {
        // A price element whose decimal point is CSS rather than a node reads
        // as "$4999". Being named by a site adapter is not evidence about the
        // separator, and this pass used to skip the check entirely — the last
        // route to a silent 100x error.
        const results = walkPriceElements(render(
          '<div data-testid="price"><span>$49</span><span>99</span></div>',
        ));
        // And nothing beneath it either: the children are fragments of that
        // same price, so converting "$49" while leaving "99" is its own
        // wrong answer.
        expect(results).toHaveLength(0);
      });
    });

    describe('given the adapter extracted the text itself', () => {
      it('trusts the extraction over the visible markup', () => {
        // bol's visible spans are aria-hidden fragments that concatenate to a
        // separator-less number. The extraction is the whole point, and the
        // refusal that protects the generic path must not override it.
        onHost('www.bol.com');
        const results = walkPriceElements(render(
          '<div class="font-produkt"><span aria-hidden="true">149</span>'
            + '<span aria-hidden="true">95</span>'
            + "<span style=\"position: absolute\">'149' euro en '95' cent</span></div>",
        ));
        expect(results).toHaveLength(1);
        expect(results[0].inPriceContainer).toBe(true);
        expect(results[0].text).toBe("'149' euro en '95' cent");
      });
    });

    describe('given the visible fragments concatenate to a bare run of digits', () => {
      it('still trusts the extraction', () => {
        // The concatenation refusal exists for markup we have to read by
        // eye. An adapter that told us the canonical price outright has
        // already answered the question the refusal is asking.
        onHost('www.amazon.com');
        const results = walkPriceElements(render(
          '<span class="a-price"><span class="a-offscreen">$4999</span>'
            + '<span aria-hidden="true"><span>49</span><span>99</span></span></span>',
        ));
        expect(results).toHaveLength(1);
        expect(results[0].inPriceContainer).toBe(true);
        expect(results[0].text).toBe('$4999');
      });
    });

    describe('given container text of exactly the greatest length', () => {
      it('is still collected', () => {
        onHost('www.coolblue.nl');
        // Padded after a space so the bare-number pattern still sees a word
        // boundary; the cap is about total length, not about the price.
        const price = `1.349 ${'x'.repeat(994)}`;
        expect(price).toHaveLength(1000);
        const results = walkPriceElements(render(
          `<div data-testid="price">${price}</div>`,
        ));
        expect(results.filter((r) => r.inPriceContainer)).toHaveLength(1);
      });
    });

    describe('given the container text is too long', () => {
      it('is skipped', () => {
        const long = `${'a'.repeat(1001)} 1.349`;
        const results = walkPriceElements(render(`<div data-testid="price">${long}</div>`));
        expect(results.filter((r) => r.inPriceContainer)).toHaveLength(0);
      });
    });
  });

  describe('given the root element itself holds the price', () => {
    it('is collected', () => {
      // The observer queues each added element as a root, so an infinite-
      // scroll page appending `<span class="price">$19.99</span>` — the price
      // in the added element's own text — had it skipped entirely.
      // getElementsByTagName only looks downwards.
      const root = render('<p id="p">$19.99</p>').querySelector('#p')!;
      expect(walkPriceElements(root).map((r) => r.text)).toEqual(['$19.99']);
    });

    describe("given the root itself is an adapter's price container", () => {
      it('is collected', () => {
        onHost('www.coolblue.nl');
        const root = render('<div data-testid="price">1.349</div>')
          .querySelector('[data-testid="price"]')!;
        const results = walkPriceElements(root);
        expect(results).toHaveLength(1);
        expect(results[0].inPriceContainer).toBe(true);
      });
    });
  });

  describe('given an accessibility copy of a price on the page', () => {
    it('is not collected in its own right', () => {
      // The hidden copy is read THROUGH its owner, not converted in place.
      // Converting it leaves the visible price in fiat and rewrites the only
      // text a screen reader ever gets.
      const results = walkPriceElements(render(
        '<div class="p"><span class="a-offscreen">$19.99</span>'
          + '<span aria-hidden="true">$19</span></div>',
      ));
      expect(results.filter((r) => r.node.className === 'a-offscreen')).toHaveLength(0);
    });
  });

  describe('given the accessibility copy is the root of the walk', () => {
    it('is still not collected', () => {
      // The observer queues each ADDED element as a root of its own, so a
      // hidden copy that arrives on its own must refuse itself rather than
      // rely on an ancestor having been taken first.
      render('<div><span id="a" class="a-offscreen">$19.99</span></div>');
      expect(walkPriceElements(document.getElementById('a')!)).toEqual([]);
    });
  });

  describe('given a price nested inside another collected element', () => {
    it('is collected once', () => {
      // Once an element is taken, everything under it is covered. Collecting
      // both converts the same price twice.
      const results = walkPriceElements(render('<div><p><span>$19.99</span></p></div>'));
      expect(results).toHaveLength(1);
    });
  });

  describe('given a price inside a shadow root', () => {
    it('is collected', () => {
      // Shadow trees are invisible to getElementsByTagName, so a checkout
      // widget in one converts nothing without a separate walk.
      const host = render('<div id="host"></div>').querySelector('#host')!;
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<span>$19.99</span>';
      expect(walkPriceElements(document.body).map((r) => r.text)).toContain('$19.99');
    });
  });

  describe('given an element holding a plain price', () => {
    it('is collected', () => {
      expect(textsFrom('<span>$19.99</span>')).toEqual(['$19.99']);
    });
  });

  describe('given a price beside one that already converted', () => {
    it('is still collected', () => {
      // The non-price rule rejects anything saying "ZEC" so we never re-read
      // our own output. Applied to raw text it also rejected the element's
      // PAGE-written price: once the $8 in "<p>$10 - <span>$8</span></p>"
      // converted, the $10 beside it could never convert on any later pass.
      const results = walkPriceElements(render(
        `<p>$10 <span class="${SPAN_CLASS}">0.0125 ZEC</span></p>`,
      ));
      expect(results.map((r) => r.text)).toContain('$10');
    });
  });

  describe('given the accessibility layer holds the canonical price', () => {
    it('prefers that text', () => {
      const results = walkPriceElements(render(
        '<div class="p"><span class="a-offscreen">$19.99</span>'
          + '<span aria-hidden="true">$19</span></div>',
      ));
      expect(results.map((r) => r.text)).toContain('$19.99');
    });

    it('does not collect the hidden copy separately', () => {
      // Converting it in place would leave the visible price untouched and
      // rewrite the only text a screen reader gets.
      const results = walkPriceElements(render(
        '<div class="p"><span class="a-offscreen">$19.99</span>'
          + '<span aria-hidden="true">$19</span></div>',
      ));
      expect(results.filter((r) => r.node.className === 'a-offscreen')).toHaveLength(0);
    });
  });

  describe('given an ancestor was already collected', () => {
    it('the descendant is skipped', () => {
      const results = walkPriceElements(render('<div><span>$19.99</span></div>'));
      expect(results).toHaveLength(1);
    });
  });

  describe('given a parent whose direct text holds its own price', () => {
    it("collects the parent's direct text only", () => {
      // "<p>$10 – <span>$8</span></p>" used to lose the $10 entirely.
      const results = walkPriceElements(render('<p>$10 <span>$8</span></p>'));
      const parent = results.find((r) => r.node.tagName === 'P');
      expect(parent?.directTextOnly).toBe(true);
      expect(parent?.text).toBe('$10');
    });

    it('still collects the child', () => {
      const results = walkPriceElements(render('<p>$10 <span>$8</span></p>'));
      expect(results.map((r) => r.text)).toContain('$8');
    });
  });

  describe('given a parent whose only price is in a child', () => {
    it('collects only the child', () => {
      const results = walkPriceElements(render('<p>Now only <span>$8</span></p>'));
      expect(results).toHaveLength(1);
      expect(results[0].node.tagName).toBe('SPAN');
    });
  });

  describe('given text that looks like it lost a separator', () => {
    describe('given no accessible copy resolves it', () => {
      it('refuses to convert', () => {
        // $4999 might be $49.99. Refusing is the only safe answer.
        const results = walkPriceElements(render(
          '<div>$<span aria-hidden="true">49</span><span aria-hidden="true">99</span></div>',
        ));
        expect(results.map((r) => r.text)).not.toContain('$4999');
      });
    });

    describe('given an accessible copy resolves it', () => {
      it('converts from the accessible copy', () => {
        const results = walkPriceElements(render(
          '<div><span class="a-offscreen">$49.99</span>'
            + '<span aria-hidden="true">49</span><span aria-hidden="true">99</span></div>',
        ));
        expect(results.map((r) => r.text)).toContain('$49.99');
      });
    });
  });

  describe('given the same element matches two adapter selectors', () => {
    it('is collected once', () => {
      onHost('www.coolblue.nl');
      const results = walkPriceElements(
        render('<div data-testid="price" class="sales-price">1.349</div>'),
      );
      expect(results).toHaveLength(1);
    });
  });

  describe('given an element whose class is not a plain string', () => {
    it('is still considered', () => {
      // SVG elements report className as an SVGAnimatedString, not a string.
      // Only <svg> itself is a skipped tag, so its children reach the class
      // check and a bare .test() on the object would match nothing useful or
      // throw. happy-dom models SVG className as a plain string, so the shape
      // is imposed here rather than hoped for.
      render('<div id="p">$19.99</div>');
      const element = document.getElementById('p')!;
      Object.defineProperty(element, 'className', {
        value: { baseVal: 'price', animVal: 'price' },
        configurable: true,
      });
      expect(walkPriceElements(document.body).map((r) => r.text)).toContain('$19.99');
    });
  });

  describe('given the accessible copy reads as a bare run of digits too', () => {
    it('still converts from the copy', () => {
      // "$4999" is a real four-figure price as often as it is lost cents. The
      // refusal is for markup we can only read by eye; a copy the page wrote
      // for screen readers has already answered the question, so refusing
      // anyway would drop every genuine price over a thousand.
      const results = walkPriceElements(render(
        '<div class="p"><span class="sr-only">$4999</span>'
          + '<span aria-hidden="true">49</span><span aria-hidden="true">99</span></div>',
      ));
      expect(results.map((r) => r.text)).toContain('$4999');
    });
  });

  describe('given text that is not a price', () => {
    it('is skipped', () => {
      expect(textsFrom('<span>Hello world</span>')).toEqual([]);
      expect(textsFrom('<span>4.5 out of 5 stars</span>')).toEqual([]);
    });

    it('is skipped even when it looks numeric enough to detect', () => {
      // "10K+ bought" trips the quick pattern on the magnitude suffix and has
      // to be rejected by the non-price rules further in.
      expect(textsFrom('<span>10K+ bought</span>')).toEqual([]);
    });
  });

  describe('given an empty element', () => {
    it('is skipped', () => {
      expect(textsFrom('<span></span><span>   </span>')).toEqual([]);
    });
  });

  describe('given the page is enormous', () => {
    it('stops once the pass budget is spent', () => {
      // The per-element cap bounds one string, not the pass. Two hundred
      // elements of 999 characters each is still seconds of frozen main
      // thread, because the number patterns are quadratic on long digit runs.
      const filler = 'x'.repeat(900);
      const cells = Array.from({ length: 400 }, () => `<p>$19.99 ${filler}</p>`).join('');
      expect(walkPriceElements(render(cells)).length).toBeLessThan(400);
    });
  });
});
