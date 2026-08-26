// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONVERTED_MARKER, SPAN_CLASS } from '../../src/entrypoints/content/markers';
import { clearPageScale } from '../../src/lib/conversion/format';

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: () => ({
      getValue: async () => null,
      setValue: async () => {},
      watch: () => () => {},
    }),
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
    watch: () => () => {},
  },
}));

import {
  convertPricesInDocument,
  convertPricesInNode,
  installCopyHandler,
  revertConversions,
  revertElement,
} from '../../src/entrypoints/content/converter';
import type { RatesData } from '../../src/lib/storage/rates';
import { DEFAULT_SETTINGS, type Settings } from '../../src/lib/storage/settings';

const RATE = 0.00125; // 1 USD = 0.00125 ZEC (ZEC ≈ $800)

function freshRates(overrides: Partial<RatesData> = {}): RatesData {
  return {
    rates: { USD: RATE, EUR: 0.0013, GBP: 0.0015 },
    updatedAt: Date.now(),
    source: 'test',
    ...overrides,
  };
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

/** happy-dom lets the hostname be set directly; the adapters key off it. */
function onHost(hostname: string) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hostname },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  onHost('example.com');
  // Each test is its own page; the decimal grid must not carry over.
  clearPageScale();
});

describe('convertPricesInNode', () => {
  it('wraps converted prices in marked spans with an accurate tooltip', () => {
    document.body.innerHTML = '<p>Price: <b id="p">$19.99</b> today</p>';
    const count = convertPricesInNode(document.body, freshRates(), settings());
    expect(count).toBeGreaterThan(0);

    const span = document.querySelector(`.${SPAN_CLASS}`);
    expect(span).not.toBeNull();
    expect(span!.getAttribute('title')).toBe('Original: $19.99');
    // Pin the number, not just the unit: $19.99 x 0.00125 = 0.0249875 ZEC.
    expect(span!.textContent).toBe('0.0250 ZEC');
    // The tooltip must show the ORIGINAL fiat price, not the converted value
    expect(span!.getAttribute('title')).toBe('Original: $19.99');
    // Pin the number, not just the unit: $19.99 x 0.00125 = 0.0249875 ZEC.
    expect(span!.textContent).toBe('0.0250 ZEC');
    expect(span!.textContent).toContain('ZEC');
    expect(span!.textContent).not.toContain('$19.99');
    // Surrounding text and structure survive
    expect(document.body.textContent).toContain('Price:');
    expect(document.body.textContent).toContain('today');
  });

  it('reverts precisely, restoring the original text', () => {
    document.body.innerHTML = '<p id="p">Was <b>$19.99</b>!</p>';
    convertPricesInNode(document.body, freshRates(), settings());
    expect(document.body.textContent).not.toContain('$19.99');

    revertConversions();
    expect(document.body.textContent).toContain('$19.99');
    expect(document.querySelector(`.${SPAN_CLASS}`)).toBeNull();
    expect(document.querySelector(`.${CONVERTED_MARKER}`)).toBeNull();
  });

  describe('given append mode', () => {
    it('keeps the original price visible', () => {
      document.body.innerHTML = '<p>$19.99</p>';
      convertPricesInNode(document.body, freshRates(), settings({ displayMode: 'append' }));
      const span = document.querySelector(`.${SPAN_CLASS}`)!;
      expect(span.textContent).toBe('$19.99 (0.0250 ZEC)');
    });
  });

  describe('given a price inside a button', () => {
    it('never rewrites it', () => {
      document.body.innerHTML = '<button>Pay $49.99 now</button><p>$10</p>';
      convertPricesInNode(document.body, freshRates(), settings());
      expect(document.querySelector('button')!.textContent).toBe('Pay $49.99 now');
      // The non-button price still converts
      expect(document.querySelector(`p .${SPAN_CLASS}`)).not.toBeNull();
    });
  });

  describe('given a price split across inline child nodes', () => {
    it('converts it', () => {
      document.body.innerHTML = '<div id="split"><span>$</span><span>99</span></div>';
      const count = convertPricesInNode(document.body, freshRates(), settings());
      expect(count).toBe(1);
      const span = document.querySelector(`#split .${SPAN_CLASS}`)!;
      expect(span.getAttribute('title')).toBe('Original: $99');
      revertConversions();
      expect(document.getElementById('split')!.textContent).toBe('$99');
    });
  });

  describe('given a child also holds a price', () => {
    it("converts a parent's direct text too", () => {
      document.body.innerHTML = '<p id="pair">$10 – <span class="sale">$8</span></p>';
      convertPricesInNode(document.body, freshRates(), settings());
      const spans = document.querySelectorAll(`#pair .${SPAN_CLASS}`);
      // Both the parent's $10 and the child's $8 convert
      expect(spans.length).toBe(2);
      expect(document.body.textContent).not.toContain('$10');
      expect(document.body.textContent).not.toContain('$8');
    });
  });

  describe('given rates that cannot be used', () => {
    it('refuses to convert with empty or stale rates', () => {
      document.body.innerHTML = '<p>$19.99</p>';
      expect(convertPricesInNode(document.body, freshRates({ rates: {} }), settings())).toBe(0);
      expect(
        convertPricesInNode(
          document.body,
          freshRates({ updatedAt: Date.now() - 25 * 60 * 60 * 1000 }),
          settings(),
        ),
      ).toBe(0);
      expect(document.body.textContent).toBe('$19.99');
    });
  });

  describe('given its own output', () => {
    it('never re-processes it', () => {
      document.body.innerHTML = '<p>$19.99</p>';
      convertPricesInNode(document.body, freshRates(), settings());
      const after = document.body.innerHTML;
      convertPricesInNode(document.body, freshRates(), settings());
      expect(document.body.innerHTML).toBe(after);
    });

    describe('given a second pass over an already-converted element', () => {
      it('is skipped', () => {
        // The observer re-runs over roots that may already hold conversions.
        // Re-detecting there would compound the conversion.
        document.body.innerHTML = '<p>Now $800 only</p>';
        convertPricesInNode(document.body, freshRates(), settings());
        const marked = document.querySelector(`.${CONVERTED_MARKER}`)!;
        convertPricesInNode(marked, freshRates(), settings());
        expect(marked.querySelectorAll(`.${SPAN_CLASS}`)).toHaveLength(1);
      });
    });

    describe('given the element itself is marked converted', () => {
      it('is skipped', () => {
        // Narrowed from "any marked ancestor" to the node itself, but the
        // node itself must still be honoured or a whole-replaced container
        // would be converted twice.
        document.body.innerHTML = `<div class="${CONVERTED_MARKER}">$800</div>`;
        convertPricesInNode(document.body, freshRates(), settings());
        expect(document.querySelector('div')!.textContent).toBe('$800');
      });
    });

    describe('given a second pass over one of our own spans', () => {
      it('is skipped', () => {
        document.body.innerHTML = '<p>$800</p>';
        convertPricesInNode(document.body, freshRates(), settings());
        const span = document.querySelector(`.${SPAN_CLASS}`)!;
        span.appendChild(document.createTextNode(' $1,600'));
        convertPricesInNode(span, freshRates(), settings());
        expect(span.textContent).toContain('$1,600');
      });
    });
  });

  describe('given conversion is switched off', () => {
    it('does nothing', () => {
      document.body.innerHTML = '<p>$800</p>';
      expect(convertPricesInNode(document.body, freshRates(), settings({ enabled: false })))
        .toBe(0);
    });
  });

  describe('given no price converts', () => {
    it('leaves the element alone', () => {
      // Every currency on the page is one we have no rate for.
      document.body.innerHTML = '<p>CHF 1299</p>';
      const partial: RatesData = { ...freshRates(), rates: { USD: RATE } };
      convertPricesInNode(document.body, partial, settings({ currencies: ['USD', 'CHF'] }));
      expect(document.body.textContent).toBe('CHF 1299');
    });
  });

  describe('given the same price twice in one element', () => {
    it('converts both from one replacement', () => {
      // "Buy 2 for $19.99 or 1 for $19.99" used to convert only the first.
      document.body.innerHTML = '<p>Buy 2 for $800 or 1 for $800</p>';
      convertPricesInNode(document.body, freshRates(), settings());
      expect(document.querySelectorAll(`.${SPAN_CLASS}`)).toHaveLength(2);
    });
  });

  describe('given a longer price contains a shorter one', () => {
    it('replaces the longer one', () => {
      // Replacing "$8" first would leave "00" stranded in the page.
      // Replacing "$8" first would leave "00" stranded beside the conversion.
      document.body.innerHTML = '<p>$800</p>';
      convertPricesInNode(document.body, freshRates(), settings());
      expect(document.querySelector('p')!.childNodes).toHaveLength(1);
      expect(document.body.textContent).toBe('1.00 ZEC');
    });
  });

  describe('given two different prices in one text node', () => {
    it('replaces the longer of two that start together', () => {
      // "$1,600" and "$1" both begin at the same offset. Replacing the short
      // one first strands ",600" in the page beside a converted "$1".
      document.body.innerHTML = '<p>$1,600 and $1.00</p>';
      convertPricesInNode(document.body, freshRates(), settings());
      expect(document.body.textContent).not.toContain(',600');
    });

    it('replaces them in the order they appear', () => {
      // Replacements are tried longest-first so a longer match wins a tie, but
      // the EARLIER match still has to win overall or the text is rebuilt out
      // of order.
      document.body.innerHTML = '<p>$800 and $1,600</p>';
      convertPricesInNode(document.body, freshRates(), settings());
      expect(document.body.textContent).toBe('1.00 ZEC and 2.00 ZEC');
    });
  });

  describe('given the same price written twice in one text node', () => {
    it('converts both from one replacement', () => {
      // One replacement is built per distinct price text, and it has to keep
      // being applied until the text runs out.
      document.body.innerHTML = '<p>$800 and $800 again</p>';
      convertPricesInNode(document.body, freshRates(), settings());
      expect(document.querySelectorAll(`.${SPAN_CLASS}`)).toHaveLength(2);
    });
  });

  describe("given a price only its container's whole text spells out", () => {
    it('replaces the container', () => {
      // Split across inline children, the price lives in no single text node,
      // so the only place to put the conversion is the element itself.
      document.body.innerHTML = '<div class="p"><span>$</span><span>8</span><span>00</span></div>';
      convertPricesInNode(document.body, freshRates(), settings());
      expect(document.querySelector('.p')!.textContent).toContain('ZEC');
    });

    describe('given the container also holds other text', () => {
      it('is left alone', () => {
        // The whole-element replacement is only safe when the element's text
        // IS the price. Anything else and the surrounding words are destroyed.
        document.body.innerHTML =
          '<div class="p">Now <span>$</span><span>8</span><span>00</span> only</div>';
        convertPricesInNode(document.body, freshRates(), settings());
        expect(document.querySelector('.p')!.textContent).toContain('Now');
        expect(document.querySelector('.p')!.textContent).toContain('only');
      });
    });
  });

  describe('given a converted container gains other content', () => {
    it('the new content IS converted', () => {
      // This asserted the opposite until the marker gate was narrowed to the
      // node itself. Treating a marked ANCESTOR as proof of work meant one
      // wrongly-marked container disabled conversion for everything beneath
      // it — and on a real Amazon page the wrongly-marked container was
      // <body>, so every price the site rendered after the first pass stayed
      // in dollars beside its converted neighbours.
      document.body.innerHTML = `<div class="${CONVERTED_MARKER}">`
        + `<span class="${SPAN_CLASS}">1.00 ZEC</span><em>$1,600</em></div>`;
      convertPricesInNode(document.body, freshRates(), settings());
      expect(document.querySelector('em')!.textContent).toContain('ZEC');
    });
  });

  describe('given one of our spans is left inside an element being converted', () => {
    it('its text is not replaced again', () => {
      // A page that rewrote its own content can leave our span behind with
      // stale text in it. Replacing inside it would nest a conversion.
      document.body.innerHTML = `<p>$800 <span id="left" class="${SPAN_CLASS}">stale</span></p>`;
      convertPricesInNode(document.body, freshRates(), settings());
      expect(document.getElementById('left')!.textContent).toBe('stale');
    });
  });

  describe('given a converted span gains other content', () => {
    it('the new content is not converted inside it', () => {
      document.body.innerHTML = `<span class="${SPAN_CLASS}"><em>$1,600</em></span>`;
      convertPricesInNode(document.body, freshRates(), settings());
      expect(document.querySelector('em')!.textContent).toBe('$1,600');
    });
  });

  describe('given text inside a contenteditable region', () => {
    it('is left alone', () => {
      // Rewriting text under a cursor loses the user's work.
      document.body.innerHTML = '<div contenteditable="true"><p>$800</p></div>';
      convertPricesInNode(document.body, freshRates(), settings());
      expect(document.body.textContent).toBe('$800');
    });

    describe('given it sits under a convertible element', () => {
      it('is still left alone', () => {
        // The element-level check cannot see this: the paragraph is
        // convertible, and only the text walk knows what it contains.
        document.body.innerHTML = '<p>$800 <b contenteditable="true">$1,600</b></p>';
        convertPricesInNode(document.body, freshRates(), settings());
        expect(document.querySelector('b')!.textContent).toBe('$1,600');
      });

      it('does not stop the rest of the element converting', () => {
        // Rejecting one text node must skip that node, not abandon the walk.
        document.body.innerHTML = '<p>$800 <b contenteditable="true">$1,600</b></p>';
        convertPricesInNode(document.body, freshRates(), settings());
        expect(document.querySelector(`.${SPAN_CLASS}`)!.textContent).toBe('1.00 ZEC');
      });

      describe('given the region holds no price of its own', () => {
        it('its text is still skipped', () => {
          // With no price inside it, the region's text is walked along with
          // the paragraph's — so the walk itself has to refuse it.
          document.body.innerHTML = '<p>$800 <b contenteditable="true">note</b></p>';
          convertPricesInNode(document.body, freshRates(), settings());
          expect(document.querySelector('b')!.textContent).toBe('note');
          expect(document.querySelector(`.${SPAN_CLASS}`)!.textContent).toBe('1.00 ZEC');
        });
      });
    });
  });

  describe('given text inside a skipped tag', () => {
    it('is left alone', () => {
      document.body.innerHTML = '<div><textarea>$800</textarea></div>';
      convertPricesInNode(document.body, freshRates(), settings());
      expect(document.querySelector('textarea')!.textContent).toBe('$800');
    });

    describe('given it sits under a convertible element', () => {
      it('is still left alone', () => {
        document.body.innerHTML = '<p>$800 <b><script>var note;</script></b></p>';
        convertPricesInNode(document.body, freshRates(), settings());
        expect(document.querySelector('script')!.textContent).toBe('var note;');
        expect(document.querySelector(`.${SPAN_CLASS}`)).not.toBeNull();
      });
    });
  });

  describe('given text inside a button', () => {
    it('is left alone', () => {
      // A checkout CTA must never show an amount the merchant will not charge.
      document.body.innerHTML = '<div><button>Pay $800 now</button></div>';
      convertPricesInNode(document.body, freshRates(), settings());
      expect(document.querySelector('button')!.textContent).toBe('Pay $800 now');
    });

    describe('given it sits under a convertible element', () => {
      it('is still left alone', () => {
        // Storefronts use role="button" on a div far more often than the
        // element itself, and <button> is already a skipped tag.
        document.body.innerHTML = '<p>$800 <span role="button">Pay $1,600</span></p>';
        convertPricesInNode(document.body, freshRates(), settings());
        expect(document.querySelector('[role="button"]')!.textContent).toBe('Pay $1,600');
      });

      it('does not stop the rest of the element converting', () => {
        document.body.innerHTML = '<p>$800 <span role="button">Pay $1,600</span></p>';
        convertPricesInNode(document.body, freshRates(), settings());
        expect(document.querySelector(`.${SPAN_CLASS}`)!.textContent).toBe('1.00 ZEC');
      });

      describe('given the control holds no price of its own', () => {
        it('its text is still skipped', () => {
          document.body.innerHTML = '<p>$800 <span role="button">Add</span></p>';
          convertPricesInNode(document.body, freshRates(), settings());
          expect(document.querySelector('[role="button"]')!.textContent).toBe('Add');
          expect(document.querySelector(`.${SPAN_CLASS}`)!.textContent).toBe('1.00 ZEC');
        });
      });
    });
  });

  describe('given the settings carry no anchors at all', () => {
    it('converts without a ratio line', () => {
      // Settings written by a version before anchors existed have no field.
      const without = settings();
      delete (without as { anchors?: unknown }).anchors;
      document.body.innerHTML = '<p>$800</p>';
      convertPricesInNode(document.body, freshRates(), without);
      expect(document.querySelector(`.${SPAN_CLASS}`)!.getAttribute('title'))
        .toBe('Original: $800');
    });
  });

  describe('given script or style content', () => {
    it('skips it', () => {
      document.body.innerHTML = '<div><style>.x{content:"$19.99"}</style><p>$5</p></div>';
      convertPricesInNode(document.body, freshRates(), settings());
      expect(document.querySelector('style')!.textContent).toContain('$19.99');
    });
  });
});

describe('anchors turn a price into a quantity', () => {
  it('adds a ratio line to the tooltip', () => {
    document.body.innerHTML = '<p>$700.00</p>';
    const anchors = [
      { id: 'a', label: 'coffees', amount: 5, currency: 'USD', zecWhenSet: 0.00625 },
    ];
    convertPricesInNode(document.body, freshRates(), settings({ anchors }));

    const span = document.querySelector(`.${SPAN_CLASS}`)!;
    expect(span.getAttribute('title')).toBe('Original: $700.00\n≈ 140 coffees');
  });

  describe('given no anchors are set', () => {
    it('leaves the tooltip alone', () => {
      document.body.innerHTML = '<p>$700.00</p>';
      convertPricesInNode(document.body, freshRates(), settings());
      expect(document.querySelector(`.${SPAN_CLASS}`)!.getAttribute('title'))
        .toBe('Original: $700.00');
    });
  });
});

describe('copying a converted price yields the fiat', () => {
  it('swaps ZEC back to the original in clipboard text', () => {
    document.body.innerHTML = '<p id="p">Total: $19.99 today</p>';
    convertPricesInNode(document.body, freshRates(), settings());
    const uninstall = installCopyHandler();

    const range = document.createRange();
    range.selectNodeContents(document.getElementById('p')!);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    let copied: string | null = null;
    const event = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: { setData: (_type: string, data: string) => (copied = data) },
    });
    document.dispatchEvent(event);
    uninstall();

    expect(copied).toBe('Total: $19.99 today');
  });

  /** Dispatch a copy event and report what, if anything, was written. */
  function copyAfter(prepare: () => void): string | null {
    const uninstall = installCopyHandler();
    prepare();
    let copied: string | null = null;
    const event = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: { setData: (_type: string, data: string) => (copied = data) },
    });
    document.dispatchEvent(event);
    uninstall();
    return copied;
  }

  function select(el: Element) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  }

  it('stops the browser writing the ZEC text over the top', () => {
    // Setting the clipboard is only half of it — without preventing the
    // default, the browser's own copy of the ZEC text wins and the whole
    // feature does nothing.
    document.body.innerHTML = '<p id="p">$800</p>';
    convertPricesInNode(document.body, freshRates(), settings());
    const uninstall = installCopyHandler();
    select(document.getElementById('p')!);
    const event = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', { value: { setData: () => {} } });
    document.dispatchEvent(event);
    uninstall();
    expect(event.defaultPrevented).toBe(true);
  });

  it('catches the copy before the page can', () => {
    // Registered on the capture phase: a site that stops the event on its own
    // container would otherwise take the ZEC text to the clipboard.
    document.body.innerHTML = '<div id="wrap"><p id="p">$800</p></div>';
    convertPricesInNode(document.body, freshRates(), settings());
    document.getElementById('wrap')!.addEventListener(
      'copy',
      (e) => e.stopPropagation(),
    );
    expect(copyAfter(() => select(document.getElementById('p')!))).toBe('$800');
  });

  it('stops swapping once the handler is removed', () => {
    document.body.innerHTML = '<p id="p">$800</p>';
    convertPricesInNode(document.body, freshRates(), settings());
    const uninstall = installCopyHandler();
    uninstall();
    let copied: string | null = null;
    select(document.getElementById('p')!);
    const event = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: { setData: (_t: string, d: string) => (copied = d) },
    });
    document.dispatchEvent(event);
    expect(copied).toBeNull();
  });

  describe('given the selection is empty', () => {
    it('leaves the clipboard alone', () => {
      document.body.innerHTML = '<p id="p">$800</p>';
      convertPricesInNode(document.body, freshRates(), settings());
      expect(copyAfter(() => {
        const range = document.createRange();
        range.setStart(document.getElementById('p')!, 0);
        range.collapse(true);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      })).toBeNull();
    });
  });

  describe('given nothing is selected', () => {
    it('leaves the clipboard alone', () => {
      document.body.innerHTML = '<p id="p">$800</p>';
      convertPricesInNode(document.body, freshRates(), settings());
      expect(copyAfter(() => window.getSelection()!.removeAllRanges())).toBeNull();
    });
  });

  describe('given a span the page created', () => {
    it('leaves it alone', () => {
      document.body.innerHTML = `<p id="p"><span class="${SPAN_CLASS}">1 ZEC</span></p>`;
      expect(copyAfter(() => select(document.getElementById('p')!))).toBeNull();
    });
  });

  describe('given a selection with no converted price', () => {
    it('leaves the selection alone', () => {
      document.body.innerHTML = '<p id="p">no prices here</p>';
      const uninstall = installCopyHandler();
      const range = document.createRange();
      range.selectNodeContents(document.getElementById('p')!);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);

      let called = false;
      const event = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', {
        value: { setData: () => (called = true) },
      });
      document.dispatchEvent(event);
      uninstall();

      expect(called).toBe(false);
    });
  });
});

describe('hide-fiat mode', () => {
  it('drops the original from the tooltip but keeps the ratio', () => {
    document.body.innerHTML = '<p>$700.00</p>';
    const anchors = [
      { id: 'a', label: 'coffees', amount: 5, currency: 'USD', zecWhenSet: 0.00625 },
    ];
    convertPricesInNode(document.body, freshRates(), settings({ hideFiat: true, anchors }));
    expect(document.querySelector(`.${SPAN_CLASS}`)!.getAttribute('title')).toBe('≈ 140 coffees');
  });

  it('still gives the fiat back on copy — thinking in ZEC, not unable to pay', () => {
    document.body.innerHTML = '<p id="p">$19.99</p>';
    convertPricesInNode(document.body, freshRates(), settings({ hideFiat: true }));
    const uninstall = installCopyHandler();

    const range = document.createRange();
    range.selectNodeContents(document.getElementById('p')!);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    let copied: string | null = null;
    const event = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: { setData: (_t: string, d: string) => (copied = d) },
    });
    document.dispatchEvent(event);
    uninstall();

    expect(copied).toBe('$19.99');
  });
});

describe('the held rate reaches the page', () => {
  const held = { peg: 0.001, pegged: Date.now() - 2 * 3_600_000 };

  it('converts at the held rate, not spot', () => {
    document.body.innerHTML = '<p>$100.00</p>';
    // Spot is 0.00125; the peg is 0.001, inside the band.
    convertPricesInNode(document.body, freshRates(), settings(), held);
    expect(document.querySelector(`.${SPAN_CLASS}`)!.textContent).toBe('0.100 ZEC');
  });

  it('always discloses the gap from spot, with no fiat figure', () => {
    document.body.innerHTML = '<p>$100.00</p>';
    convertPricesInNode(document.body, freshRates(), settings({ hideFiat: true }), held);
    const title = document.querySelector(`.${SPAN_CLASS}`)!.getAttribute('title')!;
    // Survives hideFiat: a percentage and an age, never a fiat amount.
    expect(title).toContain('Held rate · spot +25.0%');
    expect(title).toContain('2h ago');
    expect(title).not.toContain('$');
  });

  describe('given the user asked for spot', () => {
    it('falls back to spot', () => {
      document.body.innerHTML = '<p>$100.00</p>';
      convertPricesInNode(document.body, freshRates(), settings(), null);
      expect(document.querySelector(`.${SPAN_CLASS}`)!.textContent).toBe('0.125 ZEC');
    });
  });
});

describe('a site adapter that replaces the whole container', () => {
  it('replaces a bol.com price container', () => {
    // The price on screen is aria-hidden fragments; the real one is an
    // absolutely-positioned span holding a sentence. There is nothing in the
    // visible markup for a partial replace to match, so the whole container
    // has to go. This used to be carried by a WeakSet the walker filled; the
    // adapter refactor stopped filling it and no test caught the regression.
    onHost('www.bol.com');
    document.body.innerHTML = '<div class="font-produkt">'
      + '<span aria-hidden="true">149</span><span aria-hidden="true">95</span>'
      + "<span style=\"position: absolute\">'149' euro en '95' cent</span>"
      + '</div>';

    convertPricesInNode(
      document.body,
      freshRates({ rates: { EUR: 0.0013 } }),
      settings({ currencies: ['EUR'] }),
    );

    const container = document.querySelector('.font-produkt')!;
    expect(container.querySelector(`.${SPAN_CLASS}`)).not.toBeNull();
    expect(container.textContent).toContain('ZEC');
    expect(container.textContent).not.toContain('149');
    expect(container.getAttribute('title')).toContain('Original:');
  });

  it('hides that copy from sight', () => {
    // Without the clipping the screen-reader copy renders too, so every
    // whole-replaced price appears on screen twice.
    onHost('www.bol.com');
    document.body.innerHTML = '<div class="font-produkt">'
      + "<span style=\"position: absolute\">'149' euro en '95' cent</span></div>";
    convertPricesInNode(document.body, freshRates(), settings({ currencies: ['EUR'] }));
    const copies = document.querySelectorAll(`.font-produkt .${SPAN_CLASS}`);
    const hidden = Array.from(copies).find((el) =>
      (el as HTMLElement).style.position === 'absolute'
    ) as HTMLElement;
    expect(hidden).toBeDefined();
    expect(hidden.style.clipPath).toContain('inset');
  });

  it('separates two prices in one container', () => {
    // Joined with nothing between them, "1.00 ZEC" and "2.00 ZEC" read as one
    // unparseable number.
    onHost('www.coolblue.nl');
    document.body.innerHTML = '<div data-testid="price">€800 <span>€1,600</span></div>';
    convertPricesInNode(document.body, freshRates(), settings({ currencies: ['EUR'] }));
    expect(document.querySelector('[data-testid="price"]')!.textContent)
      .toContain('1.04 ZEC 2.08 ZEC');
  });

  it('clears the original markup rather than appending to it', () => {
    onHost('www.bol.com');
    document.body.innerHTML = '<div class="font-produkt"><span>149,95</span>'
      + "<span style=\"position: absolute\">'149' euro en '95' cent</span></div>";
    convertPricesInNode(document.body, freshRates(), settings({ currencies: ['EUR'] }));
    expect(document.querySelector('.font-produkt')!.textContent).not.toContain('149,95');
  });

  it('keeps the untrimmed original out of the tooltip', () => {
    onHost('www.bol.com');
    document.body.innerHTML = '<div class="font-produkt">'
      + "<span style=\"position: absolute\">  '149' euro en '95' cent  </span></div>";
    convertPricesInNode(document.body, freshRates(), settings({ currencies: ['EUR'] }));
    const title = document.querySelector('.font-produkt')!.getAttribute('title') ?? '';
    expect(title).toBe(title.trim());
    expect(title).not.toContain('Original:  ');
  });

  describe('given the container had a title of its own', () => {
    it('puts that title back on revert', () => {
      onHost('www.bol.com');
      document.body.innerHTML = '<div class="font-produkt" title="Frito-Lay">'
        + "<span style=\"position: absolute\">'149' euro en '95' cent</span></div>";
      const container = document.querySelector('.font-produkt')!;
      convertPricesInNode(document.body, freshRates(), settings({ currencies: ['EUR'] }));
      revertElement(container);
      expect(container.getAttribute('title')).toBe('Frito-Lay');
    });
  });

  it('leaves an accessible copy behind', () => {
    // Assigning textContent used to delete the only price a screen reader
    // ever saw: sighted users got ZEC, screen-reader users got nothing.
    onHost('www.bol.com');
    document.body.innerHTML = '<div class="font-produkt">'
      + "<span style=\"position: absolute\">'149' euro en '95' cent</span></div>";

    convertPricesInNode(
      document.body,
      freshRates({ rates: { EUR: 0.0013 } }),
      settings({ currencies: ['EUR'] }),
    );

    const container = document.querySelector('.font-produkt')!;
    expect(
      container.querySelector('.sr-only, [class*="a11y"], [aria-hidden="false"]')
        ?? container.querySelector('span:last-child'),
    ).not.toBeNull();
    expect(container.textContent).toContain('ZEC');
  });
});

describe('convertPricesInDocument', () => {
  it('converts the whole page', () => {
    document.body.innerHTML = '<p>$800</p><div><span>$1,600</span></div>';
    expect(convertPricesInDocument(freshRates(), settings())).toBe(2);
  });

  it('gives every price on the page one decimal shape', () => {
    // The whole point of a shared scale: three prices the eye can compare
    // without reading them.
    document.body.innerHTML = '<p>$800</p><p>$16</p><p>$1,600</p>';
    convertPricesInDocument(freshRates(), settings());
    const shapes = Array.from(document.querySelectorAll(`.${SPAN_CLASS}`))
      .map((el) => (el.textContent ?? '').replace(/\d/g, '#'));
    expect(new Set(shapes).size).toBe(1);
  });

  it('starts a fresh scale for each page it is given', () => {
    // Without this the grid a previous page settled on follows the user to
    // the next one, and a page of ordinary prices inherits six decimals.
    document.body.innerHTML = '<p>$0.80</p>';
    convertPricesInDocument(freshRates(), settings());
    document.body.innerHTML = '<p>$800</p>';
    convertPricesInDocument(freshRates(), settings());
    expect(document.querySelector(`.${SPAN_CLASS}`)!.textContent).toBe('1.00 ZEC');
  });

  describe('given conversion is switched off', () => {
    it('does nothing', () => {
      document.body.innerHTML = '<p>$800</p>';
      expect(convertPricesInDocument(freshRates(), settings({ enabled: false }))).toBe(0);
      expect(document.body.textContent).toBe('$800');
    });
  });

  describe('given the rates cannot be used', () => {
    it('does nothing', () => {
      // Converting at a rate nobody has refreshed in a day is worse than
      // leaving the fiat price where it is.
      document.body.innerHTML = '<p>$800</p>';
      const empty: RatesData = { rates: {}, updatedAt: 0, source: '' };
      expect(convertPricesInDocument(empty, settings())).toBe(0);
    });
  });

  describe('given there is no body', () => {
    it('does nothing', () => {
      // API endpoints and XML documents render without one.
      const body = document.body;
      Object.defineProperty(document, 'body', { value: null, configurable: true });
      expect(convertPricesInDocument(freshRates(), settings())).toBe(0);
      Object.defineProperty(document, 'body', { value: body, configurable: true });
    });
  });
});

describe('weaning withdraws the fiat crutch', () => {
  const DAY = 24 * 60 * 60 * 1000;

  function tooltipAfter(daysAgo: number) {
    document.body.innerHTML = '<p>$800</p>';
    convertPricesInNode(
      document.body,
      freshRates(),
      settings({ weanFromFiat: true, weanStartedAt: Date.now() - daysAgo * DAY }),
    );
    return document.querySelector(`.${SPAN_CLASS}`)!.getAttribute('title') ?? '';
  }

  describe('given weaning is switched off entirely', () => {
    it('keeps the original whatever the start date says', () => {
      // A start date left behind from a previous run must not withdraw the
      // fiat price from someone who has turned the feature off.
      document.body.innerHTML = '<p>$800</p>';
      convertPricesInNode(
        document.body,
        freshRates(),
        settings({ weanFromFiat: false, weanStartedAt: Date.now() - 60 * DAY }),
      );
      expect(document.querySelector(`.${SPAN_CLASS}`)!.getAttribute('title'))
        .toContain('Original: $800');
    });
  });

  describe('given weaning has reached the hidden stage', () => {
    it('drops the original from the tooltip', () => {
      expect(tooltipAfter(60)).not.toContain('Original:');
    });
  });

  describe('given weaning is on but has not reached that stage', () => {
    it('keeps the original', () => {
      // The earlier stages are a CSS delay and an Alt-hold peek; only the last
      // one takes the number away entirely.
      expect(tooltipAfter(1)).toContain('Original: $800');
    });
  });
});

describe('the held-rate disclosure states its age', () => {
  const HOUR = 3_600_000;

  function tooltipWithPeg(peg: number, pegged: number) {
    document.body.innerHTML = '<p>$800</p>';
    convertPricesInNode(document.body, freshRates(), settings(), { peg, pegged });
    return document.querySelector(`.${SPAN_CLASS}`)!.getAttribute('title') ?? '';
  }

  it('signs a gap above spot positive', () => {
    // A sign that only ever appears one way teaches nothing about which
    // direction the held rate is lagging.
    expect(tooltipWithPeg(RATE / 2, Date.now())).toContain('+100.0%');
  });

  describe('given the peg was taken exactly an hour ago', () => {
    it('says one hour, not just now', () => {
      expect(tooltipWithPeg(RATE, Date.now() - HOUR)).toContain('1h ago');
    });
  });

  describe('given the peg was taken minutes ago', () => {
    it('says just now', () => {
      expect(tooltipWithPeg(RATE, Date.now() - 10 * 60_000)).toContain('just now');
    });
  });

  describe('given the peg was taken hours ago', () => {
    it('says how many hours', () => {
      expect(tooltipWithPeg(RATE, Date.now() - 5 * HOUR)).toContain('5h ago');
    });
  });

  describe('given the peg was taken a day ago', () => {
    it('says one day', () => {
      expect(tooltipWithPeg(RATE, Date.now() - 24 * HOUR)).toContain('1 day ago');
    });
  });

  describe('given the peg was taken several days ago', () => {
    it('says how many days', () => {
      expect(tooltipWithPeg(RATE, Date.now() - 72 * HOUR)).toContain('3 days ago');
    });
  });

  describe('given spot has fallen below the peg', () => {
    it('signs the gap negative', () => {
      // A sign that only ever appears one way teaches nothing about which
      // direction the held rate is lagging.
      expect(tooltipWithPeg(RATE * 2, Date.now())).toContain('-50.0%');
    });
  });
});

describe('reverting', () => {
  it('puts the original text back in place', () => {
    // Reverting is what makes the extension a guest rather than a squatter:
    // switch it off and the page must be exactly as its author wrote it.
    document.body.innerHTML = '<p id="p">Total: $800 today</p>';
    const before = document.getElementById('p')!.innerHTML;
    convertPricesInNode(document.body, freshRates(), settings());
    revertConversions();
    expect(document.getElementById('p')!.innerHTML).toBe(before);
  });

  it('clears the marker so the element can convert again', () => {
    document.body.innerHTML = '<p>$800</p>';
    convertPricesInNode(document.body, freshRates(), settings());
    revertConversions();
    convertPricesInNode(document.body, freshRates(), settings());
    expect(document.querySelectorAll(`.${SPAN_CLASS}`)).toHaveLength(1);
  });

  it('clears the marker on a partly converted element too', () => {
    // A partly converted element carries a different marker, and leaving it
    // behind means the element is skipped for the rest of the visit.
    document.body.innerHTML = '<p>Now $800 only</p>';
    convertPricesInNode(document.body, freshRates(), settings());
    revertConversions();
    convertPricesInNode(document.body, freshRates(), settings());
    expect(document.querySelectorAll(`.${SPAN_CLASS}`)).toHaveLength(1);
  });

  describe('given a span the page created', () => {
    it('is left alone', () => {
      // A page can put any class it likes on its own markup. Rewriting it from
      // an attribute the page controls is how an extension becomes an XSS
      // primitive.
      document.body.innerHTML = `<span class="${SPAN_CLASS}" title="Original: hacked">x</span>`;
      revertConversions();
      expect(document.querySelector(`.${SPAN_CLASS}`)?.textContent).toBe('x');
    });
  });

  describe('given a container that had no title before', () => {
    it('the title is removed rather than emptied', () => {
      onHost('www.bol.com');
      document.body.innerHTML = '<div class="font-produkt">'
        + "<span style=\"position: absolute\">'149' euro en '95' cent</span></div>";
      const container = document.querySelector('.font-produkt')!;
      convertPricesInNode(document.body, freshRates(), settings({ currencies: ['EUR'] }));
      expect(container.getAttribute('title')).toContain('Original:');
      revertElement(container);
      expect(container.hasAttribute('title')).toBe(false);
    });
  });

  describe('given a container that had its own title', () => {
    it('the title is put back', () => {
      onHost('www.bol.com');
      document.body.innerHTML = '<div class="font-produkt" title="Product name">'
        + "<span style=\"position: absolute\">'149' euro en '95' cent</span></div>";
      const container = document.querySelector('.font-produkt')!;
      convertPricesInNode(document.body, freshRates(), settings({ currencies: ['EUR'] }));
      revertElement(container);
      expect(container.getAttribute('title')).toBe('Product name');
    });
  });
});
