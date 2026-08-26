import { describe, expect, it } from 'vitest';
import { divergence, HELD_RATE_BAND, heldRateFor, updateHeldRate } from '../../src/lib/rates/held';
import type { RatesData } from '../../src/lib/storage/rates';

// Spec: tests/trees/held.tree

const spot = (rates: Record<string, number>, at = 1_000): RatesData => ({
  rates,
  updatedAt: at,
  source: 'test',
});

describe('updateHeldRate', () => {
  describe('given no peg yet', () => {
    it('pegs on first sight', () => {
      const { held, repegged } = updateHeldRate(null, spot({ USD: 0.00125 }));
      expect(held!.peg).toBe(0.00125);
      expect(repegged).toBe(false);
    });
  });

  describe('given spot moves inside the band', () => {
    it('ignores movement inside the band', () => {
      const first = updateHeldRate(null, spot({ USD: 0.00125 })).held;
      const { held, repegged } = updateHeldRate(first, spot({ USD: 0.00135 }, 2_000));
      expect(held!.peg).toBe(0.00125);
      expect(held!.pegged).toBe(1_000);
      expect(repegged).toBe(false);
    });
  });

  describe('given spot leaves the band', () => {
    it('re-pegs once spot leaves the band, in either direction', () => {
      const first = updateHeldRate(null, spot({ USD: 0.00125 })).held;
      expect(updateHeldRate(first, spot({ USD: 0.0014 }, 2_000)).repegged).toBe(true);
      expect(updateHeldRate(first, spot({ USD: 0.001 }, 2_000)).repegged).toBe(true);
    });
  });

  describe('given a relentless trend', () => {
    it('never drifts further from spot than the disclosed bound', () => {
      // The guarantee the design exists to make, and the one no moving average
      // can offer: a 30d mean on real ZEC data was wrong by up to 309%.
      let held = updateHeldRate(null, spot({ USD: 0.001 })).held;
      let rate = 0.001;

      for (let step = 0; step < 500; step++) {
        rate *= 1.03; // a relentless trend — the case that breaks averages
        const next = spot({ USD: rate }, 1_000 + step);
        held = updateHeldRate(held, next).held;
        expect(Math.abs(divergence(held!, next)!)).toBeLessThanOrEqual(HELD_RATE_BAND);
      }
    });
  });

  describe('given a garbage quote', () => {
    it('ignores a garbage quote rather than pegging to it', () => {
      const first = updateHeldRate(null, spot({ USD: 0.00125 })).held;
      for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const { held, repegged } = updateHeldRate(first, spot({ USD: bad }, 2_000));
        expect(held!.peg).toBe(0.00125);
        // Nothing moved, so the re-peg notice must stay quiet: a notice that
        // fires on a bad quote teaches the user to ignore the real ones.
        expect(repegged).toBe(false);
      }
    });
  });

  describe('given the stored peg is itself unusable', () => {
    it('pegs afresh', () => {
      // A peg of zero would make every band comparison a division by zero, so
      // a corrupted record has to be replaced rather than compared against.
      const { held, repegged } = updateHeldRate(
        { peg: 0, pegged: 500 },
        spot({ USD: 0.00125 }, 2_000),
      );
      expect(held).toEqual({ peg: 0.00125, pegged: 2_000 });
      expect(repegged).toBe(false);
    });
  });

  describe('given spot sits exactly one band away', () => {
    it('holds the current peg', () => {
      // The bound we publish is "never more than the band from spot", so a move
      // of exactly the band is still inside what was promised. The peg is a
      // power of two and the band a binary fraction, so this really is the
      // boundary rather than a hair to one side of it.
      const band = 0.125;
      const peg = 0.0009765625;
      const onTheBand = spot({ USD: peg * (1 + band) }, 2_000);
      expect(updateHeldRate({ peg, pegged: 1_000 }, onTheBand, band).repegged).toBe(false);

      const justPast = spot({ USD: peg * (1 + band) * 1.000001 }, 2_000);
      expect(updateHeldRate({ peg, pegged: 1_000 }, justPast, band).repegged).toBe(true);
    });
  });

  describe('when a band is given', () => {
    it('uses that band instead of the default', () => {
      const first = updateHeldRate(null, spot({ USD: 0.00125 })).held;
      // 4% away: inside the default band, outside a 1% one.
      const nudged = spot({ USD: 0.0013 }, 2_000);
      expect(updateHeldRate(first, nudged).repegged).toBe(false);
      expect(updateHeldRate(first, nudged, 0.01).repegged).toBe(true);
    });
  });
});

describe('heldRateFor', () => {
  it('keeps the fiat cross between two prices exact', () => {
    // Independent per-currency bands re-peg at different moments, which makes
    // the cross IMPLIED by two prices on one page wrong — measured at >2% for
    // a third of all hours. A page showing $100 and EUR100 would imply
    // EUR/USD = 1.20 when it is 1.09, breaking the invariant anchors rest on.
    const held = updateHeldRate(null, spot({ USD: 0.00125, EUR: 0.00136 })).held!;

    // ZEC moves 8% (inside the band, so no re-peg) while EUR/USD is unchanged.
    const later = spot({ USD: 0.00135, EUR: 0.0014688 }, 2_000);

    const usd = heldRateFor(held, later, 'USD')!;
    const eur = heldRateFor(held, later, 'EUR')!;

    // The implied cross must match the live one exactly.
    expect(eur / usd).toBeCloseTo(later.rates.EUR / later.rates.USD, 12);
  });

  it('returns the peg itself for the numeraire', () => {
    const held = updateHeldRate(null, spot({ USD: 0.00125 })).held!;
    expect(heldRateFor(held, spot({ USD: 0.0013 }), 'USD')).toBe(0.00125);
  });

  it('is case-insensitive about currency codes', () => {
    const held = updateHeldRate(null, spot({ USD: 0.00125, EUR: 0.0013 })).held!;
    const rates = spot({ USD: 0.00125, EUR: 0.0013 });
    expect(heldRateFor(held, rates, 'eur')).toBe(heldRateFor(held, rates, 'EUR'));
  });

  describe('given a currency with no spot rate', () => {
    it('returns null', () => {
      const held = updateHeldRate(null, spot({ USD: 0.00125 })).held!;
      expect(heldRateFor(held, spot({ USD: 0.00125 }), 'JPY')).toBeNull();
    });
  });

  describe('given the peg is unusable', () => {
    it('returns null', () => {
      expect(heldRateFor({ peg: 0, pegged: 1 }, spot({ USD: 0.00125 }), 'USD')).toBeNull();
    });
  });

  describe('given spot has no rate for the numeraire', () => {
    it('returns null', () => {
      // Without the numeraire there is no cross to carry the peg across, and
      // guessing one would silently misprice every non-USD price on the page.
      expect(heldRateFor({ peg: 0.00125, pegged: 1 }, spot({ EUR: 0.0013 }), 'EUR')).toBeNull();
    });
  });

  describe('given the numeraire is quoted at zero', () => {
    it('returns null', () => {
      // A zero numeraire makes the cross a division by zero, which arrives as
      // an infinite rate rather than an obviously broken one.
      const rates = spot({ USD: 0, EUR: 0.0013 });
      expect(heldRateFor({ peg: 0.00125, pegged: 1 }, rates, 'EUR')).toBeNull();
    });
  });

  describe('given the currency is quoted at zero', () => {
    it('returns null', () => {
      // Zero would price everything on the page at nothing.
      const rates = spot({ USD: 0.00125, EUR: 0 });
      expect(heldRateFor({ peg: 0.00125, pegged: 1 }, rates, 'EUR')).toBeNull();
    });
  });

  describe('given a nonsense numeraire quote', () => {
    it('still answers with the peg itself', () => {
      // The displayed rate is the peg; it does not depend on the current quote.
      // Carrying it across a cross computed from garbage would replace a good
      // rate with a meaningless one.
      const rates = spot({ USD: Number.POSITIVE_INFINITY });
      expect(heldRateFor({ peg: 0.00125, pegged: 1 }, rates, 'USD')).toBe(0.00125);
    });
  });
});

describe('divergence', () => {
  it('reports the signed gap from spot', () => {
    const held = updateHeldRate(null, spot({ USD: 0.001 })).held!;
    expect(divergence(held, spot({ USD: 0.00105 }))).toBeCloseTo(0.05, 10);
    expect(divergence(held, spot({ USD: 0.00095 }))).toBeCloseTo(-0.05, 10);
  });

  describe('given the peg is unusable', () => {
    it('returns null', () => {
      expect(divergence({ peg: 0, pegged: 1 }, spot({ USD: 0.001 }))).toBeNull();
    });
  });

  describe('given spot has no rate for the numeraire', () => {
    it('returns null', () => {
      expect(divergence({ peg: 0.001, pegged: 1 }, spot({ EUR: 0.0013 }))).toBeNull();
    });
  });

  describe('given the numeraire is quoted at zero', () => {
    it('returns null', () => {
      // Reported as -100% otherwise, which would read as a real collapse.
      expect(divergence({ peg: 0.001, pegged: 1 }, spot({ USD: 0 }))).toBeNull();
    });
  });
});
