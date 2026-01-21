import { describe, it, expect } from 'vitest';
import { formatZec, formatZecWithSymbol } from '../../src/lib/conversion/format';

describe('formatZec', () => {
  describe('with auto precision', () => {
    it('formats whole numbers with 2 decimals minimum', () => {
      expect(formatZec(100)).toBe('100.00');
      // 1 has 1 integer digit, needs 3 more decimal digits for 4 sig figs
      expect(formatZec(1)).toBe('1.000');
      expect(formatZec(0)).toBe('0.00');
    });

    it('formats numbers >= 1 with enough decimals for 4 sig figs', () => {
      expect(formatZec(1.234)).toBe('1.234');
      expect(formatZec(12.34)).toBe('12.34');
      // 123.4 has 4 sig figs, but we always keep at least 2 decimals
      expect(formatZec(123.4)).toBe('123.40');
      expect(formatZec(1234)).toBe('1234.00');
    });

    it('formats small numbers with enough decimals for 4 sig figs', () => {
      expect(formatZec(0.1234)).toBe('0.1234');
      expect(formatZec(0.01234)).toBe('0.01234');
      expect(formatZec(0.001234)).toBe('0.001234');
      expect(formatZec(0.0001234)).toBe('0.0001234');
    });

    it('handles very small numbers', () => {
      expect(formatZec(0.00001)).toBe('0.00001000');
    });
  });

  describe('with fixed precision', () => {
    it('uses exact decimal places', () => {
      expect(formatZec(1.23456789, 2)).toBe('1.23');
      expect(formatZec(1.23456789, 4)).toBe('1.2346');
      expect(formatZec(1.23456789, 8)).toBe('1.23456789');
    });
  });
});

describe('formatZecWithSymbol', () => {
  it('appends ZEC suffix for small amounts', () => {
    expect(formatZecWithSymbol(100)).toBe('100.00 ZEC');
    expect(formatZecWithSymbol(0.001234)).toBe('0.001234 ZEC');
  });

  it('uses million for amounts >= 1M', () => {
    expect(formatZecWithSymbol(1234567)).toBe('1.235 million ZEC');
    expect(formatZecWithSymbol(12345678)).toBe('12.35 million ZEC');
    expect(formatZecWithSymbol(123456789)).toBe('123.5 million ZEC');
  });

  it('uses billion for amounts >= 1B', () => {
    expect(formatZecWithSymbol(1234567890)).toBe('1.235 billion ZEC');
    expect(formatZecWithSymbol(5466000000)).toBe('5.466 billion ZEC');
  });

  it('uses trillion for amounts >= 1T', () => {
    expect(formatZecWithSymbol(1234567890000)).toBe('1.235 trillion ZEC');
    expect(formatZecWithSymbol(2000000000000)).toBe('2.000 trillion ZEC');
  });
});
