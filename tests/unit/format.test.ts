import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPageUnit,
  formatZec,
  formatZecWithSymbol,
  setDisplayLocale,
  setPageUnit,
} from '../../src/lib/conversion/format';

// Spec: tests/trees/format.tree

describe('the initial locale', () => {
  /** LOCALE is read once at import, so each case needs its own module. */
  async function loadWithNavigator(navigator: unknown) {
    vi.stubGlobal('navigator', navigator);
    vi.resetModules();
    return import('../../src/lib/conversion/format');
  }

  afterEach(() => vi.unstubAllGlobals());

  describe('given the browser states a language', () => {
    it('renders in that language', async () => {
      const { formatZec } = await loadWithNavigator({ language: 'de-DE' });
      expect(formatZec(1.234)).toBe('1,234');
    });
  });

  describe('given the browser states none', () => {
    it('falls back to US English', async () => {
      // Service workers and offscreen documents have no navigator.language.
      // Formatting has to keep working there rather than throwing.
      const { formatZec } = await loadWithNavigator({});
      expect(formatZec(1.234)).toBe('1.234');
    });
  });
});

describe('setDisplayLocale', () => {
  afterEach(() => setDisplayLocale('en-US'));

  describe('given a locale', () => {
    it('renders in that locale', () => {
      // A US user on a German shop parses "1.234,56 €" under German rules and
      // would then read the result under US ones — the meaning of "." flipping
      // mid-sentence.
      setDisplayLocale('de-DE');
      expect(formatZec(1.234)).toBe('1,234');
    });
  });

  describe('given no locale', () => {
    it('keeps the one already in use', () => {
      setDisplayLocale('de-DE');
      setDisplayLocale(undefined);
      expect(formatZec(1.234)).toBe('1,234');
    });
  });
});

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

    it('caps the decimals it will show', () => {
      // Past eight decimals there is nothing left to say: a zatoshi is the
      // smallest unit that exists.
      expect(formatZec(0.000000001234)).toBe('0.00000000');
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

  describe('with coarse precision', () => {
    it('shows two significant figures', () => {
      // Coarse says what the rate can actually support. More digits than that
      // is a precision claim the feed cannot back.
      expect(formatZec(0.1204, 'coarse')).toBe('0.12');
      expect(formatZec(4.2314, 'coarse')).toBe('4.2');
    });
  });
});

describe('formatZecWithSymbol', () => {
  afterEach(() => clearPageUnit());

  describe('in ZEC', () => {
    it('appends ZEC suffix for small amounts', () => {
      expect(formatZecWithSymbol(0.4231)).toBe('0.4231 ZEC');
      expect(formatZecWithSymbol(4.2314)).toBe('4.23 ZEC');
    });

    it('groups large amounts instead of compacting them', () => {
      // Compact notation at 4 significant figures silently discards 433 ZEC.
      expect(formatZecWithSymbol(1_234_567)).toBe('1,234,567 ZEC');
    });

    it('shows the digits that matter at each magnitude', () => {
      expect(formatZecWithSymbol(27_150)).toBe('27,150 ZEC');
      expect(formatZecWithSymbol(271.5)).toBe('271.5 ZEC');
      expect(formatZecWithSymbol(0.00423)).toBe('0.00423 ZEC');
    });

    it('honors fixed precision instead of the magnitude default', () => {
      expect(formatZecWithSymbol(1_234.5678, 3)).toBe('1,234.568 ZEC');
    });

    it('never renders a nonzero amount as zero', () => {
      expect(formatZecWithSymbol(0.004, 2)).not.toBe('0.00 ZEC');
    });
  });

  describe('in zats', () => {
    it('switches to zats before decimals stop being scannable', () => {
      expect(formatZecWithSymbol(0.0004231)).toBe('42,310 zats');
    });

    it('respects an explicit zats unit', () => {
      expect(formatZecWithSymbol(5, 'auto', 'zats')).toBe('500,000,000 zats');
    });

    it('respects an explicit ZEC-only unit', () => {
      expect(formatZecWithSymbol(0.0004231, 'auto', 'zec')).toContain('ZEC');
    });

    describe('given an amount below one zatoshi', () => {
      it('keeps two decimals rather than rounding to nothing', () => {
        // Nothing smaller than a zatoshi exists, but a rate can still produce
        // one, and "0 zats" for a real price is a lie the user can act on.
        expect(formatZecWithSymbol(0.000000000045, 'auto', 'zats')).toBe('0 zats');
        expect(formatZecWithSymbol(0.0000000045, 'auto', 'zats')).toBe('0.45 zats');
      });
    });
  });

  describe('in coarse mode', () => {
    it('is honest about what the rate can support', () => {
      expect(formatZecWithSymbol(0.1204, 'coarse')).toBe('≈0.12 ZEC');
      expect(formatZecWithSymbol(4.2314, 'coarse')).toBe('≈4.2 ZEC');
    });
  });

  describe('given a zero amount', () => {
    it('stays in ZEC', () => {
      // Zero zats and zero ZEC are the same number; the ZEC reading is the one
      // that matches every other price on the page.
      expect(formatZecWithSymbol(0)).toContain('ZEC');
    });
  });

  describe('one unit per page', () => {
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
});
