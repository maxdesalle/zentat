import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: () => ({
      getValue: async () => null,
      setValue: async () => {},
      watch: () => () => {},
    }),
  },
}));

import { quickConvert } from '../../src/lib/quick-convert';
import type { RatesData } from '../../src/lib/storage/rates';
import { DEFAULT_SETTINGS } from '../../src/lib/storage/settings';

const rates: RatesData = {
  rates: { USD: 0.00125, EUR: 0.0013, CHF: 0.0014 },
  updatedAt: Date.now(),
  source: 'test',
};
const settings = { ...DEFAULT_SETTINGS, displayCurrency: 'USD' };

describe('converting text that is not attached to a page', () => {
  it('handles a plain selection', () => {
    expect(quickConvert('$19.99', rates, settings)!.output).toBe('0.0250 ZEC');
  });

  it('understands every format the page parser does', () => {
    expect(quickConvert('1.234,56 €', rates, settings)).not.toBeNull();
    expect(quickConvert('USD 1,234.56', rates, settings)).not.toBeNull();
    expect(quickConvert("CHF 1'299.00", rates, settings)).not.toBeNull();
  });

  it('converts back the other way', () => {
    expect(quickConvert('1 ZEC', rates, settings)!.output).toBe('800.00 USD');
    expect(quickConvert('0.5 zec', rates, settings)!.output).toBe('400.00 USD');
  });

  it('accepts zats on the way back', () => {
    expect(quickConvert('100000000 zats', rates, settings)!.output).toBe('800.00 USD');
  });

  it('returns null on text with no price in it', () => {
    expect(quickConvert('hello world', rates, settings)).toBeNull();
    expect(quickConvert('', rates, settings)).toBeNull();
  });
});
