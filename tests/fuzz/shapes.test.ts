// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import { convertPricesInNode } from '../../src/entrypoints/content/converter';
import { clearPageScale } from '../../src/lib/conversion/format';
import type { RatesData } from '../../src/lib/storage/rates';
import { DEFAULT_SETTINGS } from '../../src/lib/storage/settings';
import { readRenderedZec } from '../pages/oracle';
import { MONEY, SHAPES } from './shapes';

const BASE = 1 / 780;
const RATES: RatesData = {
  rates: {
    USD: BASE,
    EUR: BASE * 1.09,
    GBP: BASE * 1.27,
    JPY: BASE * 0.0067,
    CAD: BASE * 0.74,
    AUD: BASE * 0.66,
    BRL: BASE * 0.18,
    MXN: BASE * 0.05,
    INR: BASE * 0.012,
    KRW: BASE * 0.00072,
  },
  updatedAt: Date.now(),
  source: 'fuzz',
};
const SETTINGS = { ...DEFAULT_SETTINGS, currencies: Object.keys(RATES.rates) };

afterEach(() => {
  document.body.innerHTML = '';
});

describe.each(SHAPES.map((s) => [s.name, s] as const))('%s', (_name, shape) => {
  it.each(MONEY.map((m) => [m.written, m] as const))('reads %s', (_written, money) => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, hostname: 'shop.example.com' },
      writable: true,
      configurable: true,
    });
    document.documentElement.lang = money.lang;
    document.body.innerHTML = shape.html(money.written);
    clearPageScale();
    convertPricesInNode(document.body, RATES, SETTINGS);

    const shown = (document.querySelector(shape.selector)?.textContent ?? '').replace(/\s+/g, ' ');

    if (shape.staysFiat) {
      // A checkout button is charged in fiat, so it keeps the merchant's figure.
      expect(shown).toContain(money.written);
      return;
    }

    // The amount put in is the amount that must come out.
    const rendered = readRenderedZec(shown);
    expect(rendered, `nothing converted in ${JSON.stringify(shown)}`).not.toBeNull();
    const expected = money.value * RATES.rates[money.currency];
    expect(
      Math.abs(rendered!.value - expected),
      `${money.written} rendered ${JSON.stringify(shown)}, expected ${expected} ZEC`,
    ).toBeLessThanOrEqual(rendered!.tolerance);
  });
});
