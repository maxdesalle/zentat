import { describe, expect, it } from 'vitest';
import { divergence, HELD_RATE_BAND, heldRateFor, updateHeldRate } from '../../src/lib/rates/held';
import type { RatesData } from '../../src/lib/storage/rates';

const spot = (rates: Record<string, number>, at = 1_000): RatesData => ({
  rates,
  updatedAt: at,
  source: 'test',
});

describe('the held rate holds', () => {
  it('pegs on first sight', () => {
    const { held, repegged } = updateHeldRate(null, spot({ USD: 0.00125 }));
    expect(held!.peg).toBe(0.00125);
    expect(repegged).toBe(false);
  });

  it('ignores movement inside the band', () => {
    const first = updateHeldRate(null, spot({ USD: 0.00125 })).held;
    const { held, repegged } = updateHeldRate(first, spot({ USD: 0.00135 }, 2_000));
    expect(held!.peg).toBe(0.00125);
    expect(held!.pegged).toBe(1_000);
    expect(repegged).toBe(false);
  });

  it('re-pegs once spot leaves the band, in either direction', () => {
    const first = updateHeldRate(null, spot({ USD: 0.00125 })).held;
    expect(updateHeldRate(first, spot({ USD: 0.0014 }, 2_000)).repegged).toBe(true);
    expect(updateHeldRate(first, spot({ USD: 0.001 }, 2_000)).repegged).toBe(true);
  });

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

  it('ignores a garbage quote rather than pegging to it', () => {
    const first = updateHeldRate(null, spot({ USD: 0.00125 })).held;
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(updateHeldRate(first, spot({ USD: bad }, 2_000)).held!.peg).toBe(0.00125);
    }
  });
});

describe('one peg, live fiat crosses', () => {
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

  it('returns null for a currency with no spot rate', () => {
    const held = updateHeldRate(null, spot({ USD: 0.00125 })).held!;
    expect(heldRateFor(held, spot({ USD: 0.00125 }), 'JPY')).toBeNull();
  });
});

describe('divergence is always reportable', () => {
  it('reports the signed gap from spot', () => {
    const held = updateHeldRate(null, spot({ USD: 0.001 })).held!;
    expect(divergence(held, spot({ USD: 0.00105 }))).toBeCloseTo(0.05, 10);
    expect(divergence(held, spot({ USD: 0.00095 }))).toBeCloseTo(-0.05, 10);
  });
});
