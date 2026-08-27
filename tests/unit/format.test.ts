import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPageScale,
  formatZecWithSymbol,
  setDisplayLocale,
  setPageScale,
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
      const { formatZecWithSymbol } = await loadWithNavigator({ language: 'de-DE' });
      expect(formatZecWithSymbol(1.234)).toBe('1,23 ZEC');
    });
  });

  describe('given there is no navigator at all', () => {
    it('falls back to US English', async () => {
      // A service worker has no navigator object whatsoever. Reading
      // .language off it would throw at module load, taking the worker down
      // before it can fetch a single rate.
      const { formatZecWithSymbol } = await loadWithNavigator(undefined);
      expect(formatZecWithSymbol(1.234)).toBe('1.23 ZEC');
    });
  });

  describe('given the browser states none', () => {
    it('falls back to US English', async () => {
      // Service workers and offscreen documents have no navigator.language.
      // Formatting has to keep working there rather than throwing.
      const { formatZecWithSymbol } = await loadWithNavigator({});
      expect(formatZecWithSymbol(1.234)).toBe('1.23 ZEC');
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
      expect(formatZecWithSymbol(1.234)).toBe('1,23 ZEC');
    });
  });

  describe('given no locale', () => {
    it('keeps the one already in use', () => {
      setDisplayLocale('de-DE');
      setDisplayLocale(undefined);
      expect(formatZecWithSymbol(1.234)).toBe('1,23 ZEC');
    });
  });
});

describe('formatZecWithSymbol', () => {
  afterEach(() => clearPageScale());

  describe('in ZEC', () => {
    it('appends ZEC suffix for small amounts', () => {
      expect(formatZecWithSymbol(0.4231)).toBe('0.423 ZEC');
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

  describe('in zats, only when the user asks for it', () => {
    it('never switches on its own', () => {
      // A magnitude threshold makes the unit a function of the RATE, not the
      // price: the same coffee would read "0.0038 ZEC" today and "384,615
      // zats" after a rally. That is exactly what the held rate exists to
      // prevent, arriving through the back door.
      expect(formatZecWithSymbol(0.0004231)).toContain('ZEC');
      expect(formatZecWithSymbol(0.0000001)).toContain('ZEC');
    });

    it('respects an explicit zats unit', () => {
      expect(formatZecWithSymbol(5, 'auto', 'zats')).toBe('500,000,000 zats');
    });

    it('treats auto and ZEC as the same thing', () => {
      expect(formatZecWithSymbol(0.0004231, 'auto', 'zec'))
        .toBe(formatZecWithSymbol(0.0004231, 'auto', 'auto'));
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

  describe('at a fixed precision', () => {
    it('uses exactly that many decimals', () => {
      expect(formatZecWithSymbol(1.23456789, 4)).toBe('1.2346 ZEC');
    });

    describe('given the amount would round to zero', () => {
      it('expands rather than showing nothing', () => {
        // At ZEC around $780, a $0.99 item is 0.00127 ZEC. "0.00 ZEC" is not
        // a rounded price, it is a wrong one.
        expect(formatZecWithSymbol(0.00127, 2)).not.toMatch(/^0\.00 ZEC$/);
        expect(formatZecWithSymbol(0.00127, 2)).toContain('0.00127');
      });
    });

    describe('given the amount sits exactly on the rounding boundary', () => {
      it('keeps the fixed precision', () => {
        // 0.005 at two decimals rounds to 0.01, not to zero, so the expansion
        // must not fire. One comparison either side of this decides whether a
        // half-cent item reads as a price or as six decimals of noise.
        expect(formatZecWithSymbol(0.005, 2)).toBe('0.01 ZEC');
        expect(formatZecWithSymbol(0.006, 2)).toBe('0.01 ZEC');
      });
    });
  });

  describe('in coarse mode', () => {
    it('is honest about what the rate can support', () => {
      expect(formatZecWithSymbol(0.1204, 'coarse')).toBe('≈0.12 ZEC');
      expect(formatZecWithSymbol(4.2314, 'coarse')).toBe('≈4.2 ZEC');
    });
  });

  describe('given an amount larger than the whole ZEC supply', () => {
    it('abbreviates rather than printing every digit', () => {
      // A finance page quoting the S&P 500 at $61.1 trillion converted to
      // 78,333,333,333 ZEC: right, and about 3,700 times every coin that will
      // ever exist. It is a market capitalisation, not something anyone pays.
      expect(formatZecWithSymbol(78_333_333_333)).toBe('78.3B ZEC');
      expect(formatZecWithSymbol(2_019_230_769)).toBe('2.02B ZEC');
      expect(formatZecWithSymbol(37_334_615)).toBe('37.3M ZEC');
    });

    it('still prints every digit at the supply itself', () => {
      // The bound is what keeps this the one exception to grouped digits:
      // anything a person could transact is under it and renders in full.
      expect(formatZecWithSymbol(21_000_000)).toBe('21,000,000 ZEC');
      expect(formatZecWithSymbol(1_532)).toBe('1,532 ZEC');
    });
  });

  describe('given a zero amount', () => {
    it('stays in ZEC at two decimals', () => {
      // Zero zats and zero ZEC are the same number; the ZEC reading is the one
      // that matches every other price on the page. Asserted exactly, because
      // log10(0) is -Infinity and every decimal rule here would otherwise run
      // away to the eight-decimal cap.
      expect(formatZecWithSymbol(0)).toBe('0.00 ZEC');
    });

    describe('given a page grid', () => {
      it("takes the page's decimals like every other price", () => {
        // github-pricing and linear-pricing recorded this as a defect: a free
        // tier in a column of "0.0128 ZEC" rendered "0.00 ZEC".
        setPageScale([0.0128, 0.0205, 0.0269]);
        expect(formatZecWithSymbol(0)).toBe('0.0000 ZEC');
      });
    });
  });

  describe('one scale per page', () => {
    it('gives every price on the page the same shape', () => {
      // The eye compares three prices of identical form without reading them.
      // A constant prefix stops being read at all; leading zeros are noise
      // only when they vary.
      setPageScale([0.0240897, 0.0006002, 0.0401139]);
      expect(formatZecWithSymbol(0.0240897)).toBe('0.0241 ZEC');
      expect(formatZecWithSymbol(0.0006002)).toBe('0.0006 ZEC');
      expect(formatZecWithSymbol(0.0401139)).toBe('0.0401 ZEC');
    });

    describe('given amounts that are not real prices', () => {
      it('ignores zero and negative amounts', () => {
        // A page can legitimately carry a "$0.00" or a "-$5.00" refund line,
        // and neither says anything about the scale the page is priced at.
        setPageScale([0, -1, 0.0240897]);
        expect(formatZecWithSymbol(0.0240897)).toBe('0.0241 ZEC');
      });

      it('ignores amounts that are not finite', () => {
        // A broken feed reaches this before the plausibility check does, and
        // a NaN in the sample poisons the sort and therefore the whole page.
        setPageScale([Number.NaN, Number.POSITIVE_INFINITY, 0.0240897]);
        expect(formatZecWithSymbol(0.0240897)).toBe('0.0241 ZEC');
      });
    });

    describe('given more prices than it will hold', () => {
      it('stops sampling rather than growing without bound', () => {
        // An infinite-scroll page never stops adding prices, and the median
        // of a few hundred is the median of ten thousand.
        setPageScale(Array.from({ length: 600 }, () => 0.0240897));
        const grid = formatZecWithSymbol(0.0240897);
        setPageScale(Array.from({ length: 600 }, () => 0.0000001));
        expect(formatZecWithSymbol(0.0240897)).toBe(grid);
      });
    });

    it('lets the typical price decide, not the per-unit noise', () => {
      // The bug this replaced: the rule keyed on the SMALLEST amount, and a
      // shopping page is one or two real prices surrounded by per-unit
      // figures and fees. EU and UK unit pricing is mandatory, so one
      // 0.0006 ZEC per-100g figure rendered an $18.79 item as "2,399,683
      // zats" — seven digits nobody can compare or recall.
      setPageScale([0.0240897, 0.0006002, 0.0401139]);
      expect(formatZecWithSymbol(0.0240897)).not.toContain('zats');
      expect(formatZecWithSymbol(0.0240897)).toBe('0.0241 ZEC');
    });

    it('caps significant figures so a large price is not over-precise', () => {
      // A coffee-and-laptop page sets a five-decimal grid, but the held rate
      // is honest to about ten percent — a fifth figure on the laptop would
      // claim precision the quote cannot support.
      setPageScale([0.0038462, 1.5384615]);
      expect(formatZecWithSymbol(0.0038462)).toBe('0.00385 ZEC');
      expect(formatZecWithSymbol(1.5384615)).toBe('1.538 ZEC');
    });

    it('gives a price below the page scale its own decimals', () => {
      // Rendering it as "0.00" would be a wrong price, not a rounded one.
      setPageScale([2.5, 5, 500]);
      expect(formatZecWithSymbol(0.0000045)).not.toMatch(/^0\.0+ ZEC$/);
    });

    it('holds that price to four significant figures', () => {
      // Expanding past the page's grid must not turn into eight decimals of
      // noise. The held rate is honest to about ten percent; a fifth figure
      // is a precision claim nothing supports.
      setPageScale([5]);
      expect(formatZecWithSymbol(0.00123456)).toBe('0.001235 ZEC');
    });

    it('keeps the scale a later batch of prices cannot move', () => {
      // The observer re-runs on every mutation, usually with ONE lazily
      // loaded element. Re-scaling around whatever loaded last would leave
      // the prices already on screen in a different shape.
      setPageScale([0.0240897, 0.0401139]);
      const before = formatZecWithSymbol(0.0240897);
      setPageScale([0.0000001]);
      expect(formatZecWithSymbol(0.0240897)).toBe(before);
    });

    it('scales to the amount itself outside a page', () => {
      // Three significant figures, whatever the magnitude — so a lone
      // conversion in the popup reads the same way a page price does.
      clearPageScale();
      expect(formatZecWithSymbol(0.0038462)).toBe('0.00385 ZEC');
      expect(formatZecWithSymbol(1.5384615)).toBe('1.54 ZEC');
    });
  });
});
