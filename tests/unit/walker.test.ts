// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
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
      for (const tag of ['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'CANVAS']) {
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
  });

  describe('given a rating', () => {
    it('rejects an out-of-five score', () => {
      expect(isNonPriceText('4.5 out of 5 stars')).toBe(true);
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
  });

  describe('given a bare number', () => {
    it('rejects it', () => {
      expect(isNonPriceText('4.5')).toBe(true);
      expect(isNonPriceText('42')).toBe(true);
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
});

describe('looksConcatenated', () => {
  describe('given a single child', () => {
    it('is not concatenated', () => {
      render('<div id="p"><span>$19.99</span></div>');
      expect(looksConcatenated(document.getElementById('p')!, '$19.99')).toBe(false);
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
});

describe('accessiblePriceText', () => {
  describe('given an aria-label holding a price', () => {
    it('uses the label', () => {
      render('<div id="p" aria-label="$19.99"><span>19</span><span>99</span></div>');
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

  describe('given no accessible copy', () => {
    it('reports nothing', () => {
      render('<div id="p">$19.99</div>');
      expect(accessiblePriceText(document.getElementById('p')!)).toBeNull();
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
        + '<span style="position: absolute">\'149\' euro en \'95\' cent</span></div>',
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

    describe('given the container text is too long', () => {
      it('is skipped', () => {
        const long = `${'a'.repeat(1001)} 1.349`;
        const results = walkPriceElements(render(`<div data-testid="price">${long}</div>`));
        expect(results.filter((r) => r.inPriceContainer)).toHaveLength(0);
      });
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
      // SVG elements report className as an SVGAnimatedString. Only <svg>
      // itself is a skipped tag, so its children reach the class check.
      render('<svg><text id="p" class="price">$19.99</text></svg>');
      expect(() => walkPriceElements(document.body)).not.toThrow();
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
