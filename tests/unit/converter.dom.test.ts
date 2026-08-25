// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONVERTED_MARKER, SPAN_CLASS } from '../../src/entrypoints/content/markers';

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
  convertPricesInNode,
  installCopyHandler,
  revertConversions,
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

beforeEach(() => {
  document.body.innerHTML = '';
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

  it('append mode keeps the original price visible', () => {
    document.body.innerHTML = '<p>$19.99</p>';
    convertPricesInNode(document.body, freshRates(), settings({ displayMode: 'append' }));
    const span = document.querySelector(`.${SPAN_CLASS}`)!;
    expect(span.textContent).toBe('$19.99 (0.0250 ZEC)');
  });

  it('never rewrites prices inside buttons', () => {
    document.body.innerHTML = '<button>Pay $49.99 now</button><p>$10</p>';
    convertPricesInNode(document.body, freshRates(), settings());
    expect(document.querySelector('button')!.textContent).toBe('Pay $49.99 now');
    // The non-button price still converts
    expect(document.querySelector(`p .${SPAN_CLASS}`)).not.toBeNull();
  });

  it('converts prices split across inline child nodes', () => {
    document.body.innerHTML = '<div id="split"><span>$</span><span>99</span></div>';
    const count = convertPricesInNode(document.body, freshRates(), settings());
    expect(count).toBe(1);
    const span = document.querySelector(`#split .${SPAN_CLASS}`)!;
    expect(span.getAttribute('title')).toBe('Original: $99');
    revertConversions();
    expect(document.getElementById('split')!.textContent).toBe('$99');
  });

  it("converts a parent's direct text even when a child also holds a price", () => {
    document.body.innerHTML = '<p id="pair">$10 – <span class="sale">$8</span></p>';
    convertPricesInNode(document.body, freshRates(), settings());
    const spans = document.querySelectorAll(`#pair .${SPAN_CLASS}`);
    // Both the parent's $10 and the child's $8 convert
    expect(spans.length).toBe(2);
    expect(document.body.textContent).not.toContain('$10');
    expect(document.body.textContent).not.toContain('$8');
  });

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

  it('never re-processes its own output', () => {
    document.body.innerHTML = '<p>$19.99</p>';
    convertPricesInNode(document.body, freshRates(), settings());
    const after = document.body.innerHTML;
    convertPricesInNode(document.body, freshRates(), settings());
    expect(document.body.innerHTML).toBe(after);
  });

  it('skips script/style content', () => {
    document.body.innerHTML = '<div><style>.x{content:"$19.99"}</style><p>$5</p></div>';
    convertPricesInNode(document.body, freshRates(), settings());
    expect(document.querySelector('style')!.textContent).toContain('$19.99');
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

  it('leaves the tooltip alone when no anchors are set', () => {
    document.body.innerHTML = '<p>$700.00</p>';
    convertPricesInNode(document.body, freshRates(), settings());
    expect(document.querySelector(`.${SPAN_CLASS}`)!.getAttribute('title'))
      .toBe('Original: $700.00');
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

  it('leaves a selection with no converted price alone', () => {
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
    expect(document.querySelector(`.${SPAN_CLASS}`)!.textContent).toBe('0.1000 ZEC');
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

  it('falls back to spot when the user asked for it', () => {
    document.body.innerHTML = '<p>$100.00</p>';
    convertPricesInNode(document.body, freshRates(), settings(), null);
    expect(document.querySelector(`.${SPAN_CLASS}`)!.textContent).toBe('0.1250 ZEC');
  });
});

describe('a site adapter that replaces the whole container', () => {
  /** happy-dom lets the hostname be set directly; the adapters key off it. */
  function onHost(hostname: string) {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, hostname },
      writable: true,
      configurable: true,
    });
  }

  it('replaces a bol.com price container', () => {
    // The price on screen is aria-hidden fragments; the real one is an
    // absolutely-positioned span holding a sentence. There is nothing in the
    // visible markup for a partial replace to match, so the whole container
    // has to go. This used to be carried by a WeakSet the walker filled; the
    // adapter refactor stopped filling it and no test caught the regression.
    onHost('www.bol.com');
    document.body.innerHTML = '<div class="font-produkt">'
      + '<span aria-hidden="true">149</span><span aria-hidden="true">95</span>'
      + '<span style="position: absolute">\'149\' euro en \'95\' cent</span>'
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

  it('leaves an accessible copy behind', () => {
    // Assigning textContent used to delete the only price a screen reader
    // ever saw: sighted users got ZEC, screen-reader users got nothing.
    onHost('www.bol.com');
    document.body.innerHTML = '<div class="font-produkt">'
      + '<span style="position: absolute">\'149\' euro en \'95\' cent</span></div>';

    convertPricesInNode(
      document.body,
      freshRates({ rates: { EUR: 0.0013 } }),
      settings({ currencies: ['EUR'] }),
    );

    const container = document.querySelector('.font-produkt')!;
    expect(container.querySelector('.sr-only, [class*="a11y"], [aria-hidden="false"]')
      ?? container.querySelector('span:last-child')).not.toBeNull();
    expect(container.textContent).toContain('ZEC');
  });
});
