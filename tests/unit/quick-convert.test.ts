import { describe, expect, it, vi } from 'vitest';

// Spec: tests/trees/quick-convert.tree

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

describe('quickConvert', () => {
  describe('given fiat text', () => {
    it('handles a plain selection', () => {
      expect(quickConvert('$19.99', rates, settings)!.output).toBe('0.0250 ZEC');
    });

    it('understands every format the page parser does', () => {
      // Same parser as the page, so a selection converts exactly as the page
      // would have.
      expect(quickConvert('1.234,56 €', rates, settings)).not.toBeNull();
      expect(quickConvert('USD 1,234.56', rates, settings)).not.toBeNull();
      expect(quickConvert("CHF 1'299.00", rates, settings)).not.toBeNull();
    });

    describe('given the currency has no rate', () => {
      it('returns nothing', () => {
        const partial: RatesData = { ...rates, rates: { USD: 0.00125 } };
        expect(quickConvert('€49.99', partial, settings)).toBeNull();
      });
    });
  });

  describe('given a ZEC amount', () => {
    it('converts back the other way', () => {
      expect(quickConvert('1 ZEC', rates, settings)!.output).toBe('800.00 USD');
      expect(quickConvert('0.5 zec', rates, settings)!.output).toBe('400.00 USD');
    });

    it('accepts zats on the way back', () => {
      expect(quickConvert('100000000 zats', rates, settings)!.output).toBe('800.00 USD');
    });

    it('reads an amount with whitespace around it', () => {
      // A double-click selection almost always carries the spaces either side.
      expect(quickConvert('  1 ZEC  ', rates, settings)!.output).toBe('800.00 USD');
    });

    it('reads the unit written straight after the number', () => {
      // What people actually type into the address bar.
      expect(quickConvert('1ZEC', rates, settings)!.output).toBe('800.00 USD');
    });

    it('reads the singular unit names', () => {
      expect(quickConvert('100000000 zat', rates, settings)!.output).toBe('800.00 USD');
      expect(quickConvert('100000000 zatoshi', rates, settings)!.output).toBe('800.00 USD');
    });

    it('reads an amount grouped with spaces', () => {
      // The grouping style of most of Europe, and of anything copied out of a
      // page that formats with a non-breaking space.
      const grouped = quickConvert('1\u00a0000 ZEC', rates, settings);
      expect(grouped!.output).toBe(quickConvert('1000 ZEC', rates, settings)!.output);
    });

    it('always uses spot, never the held rate', () => {
      // The two directions are different questions. "What does this cost" is a
      // browsing question and takes the held rate. "What is my money worth" is
      // about a balance the user actually holds — the one case outside
      // checkout where a held rate could cost them.
      expect(quickConvert('1 ZEC', rates, settings)!.output).toBe('800.00 USD');
    });

    describe('given the amount is negative', () => {
      it('returns nothing', () => {
        expect(quickConvert('-1 ZEC', rates, settings)).toBeNull();
      });
    });

    describe('given the amount does not parse', () => {
      it('returns nothing', () => {
        expect(quickConvert('.. ZEC', rates, settings)).toBeNull();
        // Zats divide by a hundred million, so an unread amount would land on
        // a confident-looking zero instead of nothing at all.
        expect(quickConvert('.. zats', rates, settings)).toBeNull();
      });
    });

    describe('given text that only looks like a ZEC amount', () => {
      it('ignores a phrase holding more than one amount', () => {
        // Answering for the first number in the selection is a wrong price.
        expect(quickConvert('0.5 ZEC fee, 20 ZEC total', rates, settings)).toBeNull();
      });

      it('ignores a word that merely ends in the unit', () => {
        // A slug or a tag is not an amount, and "2021 ZEC" is not an answer.
        expect(quickConvert('2021-zec', rates, settings)).toBeNull();
      });
    });

    describe('given the display currency has no rate', () => {
      it('returns nothing', () => {
        const missing = { ...settings, displayCurrency: 'JPY' };
        expect(quickConvert('1 ZEC', rates, missing)).toBeNull();
        const zero: RatesData = { ...rates, rates: { USD: 0 } };
        expect(quickConvert('1 ZEC', zero, settings)).toBeNull();
      });
    });
  });

  describe('given text with no price in it', () => {
    it('returns nothing', () => {
      expect(quickConvert('hello world', rates, settings)).toBeNull();
    });

    describe('given the text is empty', () => {
      it('returns nothing', () => {
        expect(quickConvert('   ', rates, settings)).toBeNull();
      });
    });
  });
});
