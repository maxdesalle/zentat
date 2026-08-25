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

import { convertPricesInNode, revertConversions } from '../../src/entrypoints/content/converter';
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
    expect(span!.textContent).toBe('0.02499 ZEC');
    // The tooltip must show the ORIGINAL fiat price, not the converted value
    expect(span!.getAttribute('title')).toBe('Original: $19.99');
    // Pin the number, not just the unit: $19.99 x 0.00125 = 0.0249875 ZEC.
    expect(span!.textContent).toBe('0.02499 ZEC');
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
    expect(span.textContent).toBe('$19.99 (0.02499 ZEC)');
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
