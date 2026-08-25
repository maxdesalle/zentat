import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPageUnit,
  formatZec,
  formatZecWithSymbol,
  setPageUnit,
} from '../../src/lib/conversion/format';

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

    it('falls back to significant figures when fixed precision would show zero', () => {
      // At ZEC ≈ $800, $0.99 ≈ 0.00124 ZEC — "0.00" carries no information
      expect(formatZec(0.00124, 2)).toBe('0.001240');
      expect(formatZec(0.00124, 0)).toBe('0.001240');
      // But a genuine zero still renders as zero
      expect(formatZec(0, 2)).toBe('0.00');
    });
  });
});

describe('formatZecWithSymbol', () => {
  it('appends ZEC suffix for small amounts', () => {
    expect(formatZecWithSymbol(100)).toBe('100.0 ZEC');
    expect(formatZecWithSymbol(0.001234)).toBe('0.00123 ZEC');
  });

  it('uses compact notation for large amounts', () => {
    // Grouped digits, not compact notation — no currency prices as "27.15K".
    expect(formatZecWithSymbol(27150)).toBe('27,150 ZEC');
    expect(formatZecWithSymbol(1234567)).toBe('1,234,567 ZEC');
    expect(formatZecWithSymbol(1234567890)).toBe('1,234,567,890 ZEC');
    expect(formatZecWithSymbol(1234567890000)).toBe('1,234,567,890,000 ZEC');
  });

  it('promotes across unit boundaries after rounding', () => {
    // 999,999,999 must round to "1B", never "1000M"
    expect(formatZecWithSymbol(999_999_999)).toBe('999,999,999 ZEC');
  });

  it('honors fixed precision for large amounts instead of compact units', () => {
    expect(formatZecWithSymbol(27150, 0)).toBe('27,150 ZEC');
    expect(formatZecWithSymbol(27150.5, 2)).toBe('27,150.50 ZEC');
  });

  it('renders tiny amounts in zats in auto unit mode', () => {
    // 0.00005 ZEC = 5,000 zats
    expect(formatZecWithSymbol(0.00005)).toBe('5,000 zats');
  });

  it('respects an explicit ZEC-only unit', () => {
    expect(formatZecWithSymbol(0.00005, 'auto', 'zec')).toBe('0.00005 ZEC');
  });

  it('respects an explicit zats unit', () => {
    expect(formatZecWithSymbol(0.5, 'auto', 'zats')).toBe('50,000,000 zats');
  });
});

describe('the display grammar reads like money', () => {
  it('groups large amounts instead of compacting them', () => {
    // Compact notation at 4 significant figures silently discards 433 ZEC here.
    expect(formatZecWithSymbol(1_234_567)).toBe('1,234,567 ZEC');
  });

  it('shows the digits that matter at each magnitude', () => {
    expect(formatZecWithSymbol(27_150)).toBe('27,150 ZEC');
    expect(formatZecWithSymbol(271.5)).toBe('271.5 ZEC');
    expect(formatZecWithSymbol(4.2314)).toBe('4.23 ZEC');
    expect(formatZecWithSymbol(0.4231)).toBe('0.4231 ZEC');
    expect(formatZecWithSymbol(0.00423)).toBe('0.00423 ZEC');
  });

  it('switches to zats before decimals stop being scannable', () => {
    expect(formatZecWithSymbol(0.0004231)).toBe('42,310 zats');
  });

  it('coarse mode is honest about what the rate can support', () => {
    expect(formatZecWithSymbol(0.1204, 'coarse')).toBe('≈0.12 ZEC');
    expect(formatZecWithSymbol(4.2314, 'coarse')).toBe('≈4.2 ZEC');
  });

  it('never renders a nonzero amount as zero', () => {
    expect(formatZecWithSymbol(0.004, 2)).not.toBe('0.00 ZEC');
  });
});

describe('one unit per page', () => {
  afterEach(() => clearPageUnit());

  it('keeps every price on the same scale', () => {
    // Without this, a page with a cheap and an expensive item renders one in
    // zats and one in ZEC — two scales the eye cannot compare.
    setPageUnit([0.0004, 5]);
    expect(formatZecWithSymbol(0.0004)).toContain('zats');
    expect(formatZecWithSymbol(5)).toContain('zats');
  });

  it('lets the smallest amount decide, because it goes unreadable first', () => {
    setPageUnit([0.0004, 5]);
    // 0.0004 ZEC is six decimals of noise; 500,000,000 zats is merely large.
    expect(formatZecWithSymbol(0.0004)).toBe('40,000 zats');
  });

  it('stays in ZEC when nothing on the page is tiny', () => {
    setPageUnit([0.5, 5, 500]);
    expect(formatZecWithSymbol(0.5)).toContain('ZEC');
  });

  it('falls back to per-amount choice outside a page', () => {
    clearPageUnit();
    expect(formatZecWithSymbol(0.0004)).toContain('zats');
    expect(formatZecWithSymbol(5)).toContain('ZEC');
  });
});
