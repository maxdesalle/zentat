import { describe, expect, it } from 'vitest';
import { divergence, HELD_RATE_BAND, updateHeldRate } from '../../src/lib/rates/held';
import type { RatesData } from '../../src/lib/storage/rates';

const spot = (rates: Record<string, number>, at = 1_000): RatesData => ({
  rates,
  updatedAt: at,
  source: 'test',
});

describe('the held rate holds', () => {
  it('pegs on first sight', () => {
    const { held, repegged } = updateHeldRate(null, spot({ USD: 0.00125 }));
    expect(held.rates.USD).toBe(0.00125);
    expect(repegged).toEqual([]);
  });

  it('ignores movement inside the band', () => {
    const first = updateHeldRate(null, spot({ USD: 0.00125 })).held;
    // +8%, inside a 10% band.
    const { held, repegged } = updateHeldRate(first, spot({ USD: 0.00135 }, 2_000));
    expect(held.rates.USD).toBe(0.00125);
    expect(held.pegged).toBe(1_000);
    expect(repegged).toEqual([]);
  });

  it('re-pegs once spot leaves the band', () => {
    const first = updateHeldRate(null, spot({ USD: 0.00125 })).held;
    const { held, repegged } = updateHeldRate(first, spot({ USD: 0.0014 }, 2_000));
    expect(held.rates.USD).toBe(0.0014);
    expect(held.pegged).toBe(2_000);
    expect(repegged).toEqual(['USD']);
  });

  it('re-pegs downward too', () => {
    const first = updateHeldRate(null, spot({ USD: 0.00125 })).held;
    expect(updateHeldRate(first, spot({ USD: 0.001 }, 2_000)).repegged).toEqual(['USD']);
  });

  it('holds each currency independently', () => {
    const first = updateHeldRate(null, spot({ USD: 0.00125, EUR: 0.0013 })).held;
    const { held, repegged } = updateHeldRate(
      first,
      spot({ USD: 0.0014, EUR: 0.00133 }, 2_000),
    );
    expect(repegged).toEqual(['USD']);
    expect(held.rates.EUR).toBe(0.0013);
  });

  it('picks up a currency it has never seen', () => {
    const first = updateHeldRate(null, spot({ USD: 0.00125 })).held;
    const { held } = updateHeldRate(first, spot({ USD: 0.00126, JPY: 0.0000085 }, 2_000));
    expect(held.rates.JPY).toBe(0.0000085);
  });

  it('never drifts further from spot than the disclosed bound', () => {
    // The guarantee the whole design exists to make, and the thing no moving
    // average can promise: a 30d mean on real ZEC data was wrong by up to 309%.
    let held = updateHeldRate(null, spot({ USD: 0.001 })).held;
    let rate = 0.001;

    for (let step = 0; step < 500; step++) {
      // A relentless trend — the case that breaks averages.
      rate *= 1.03;
      const next = spot({ USD: rate }, 1_000 + step);
      held = updateHeldRate(held, next).held;
      expect(Math.abs(divergence(held, next, 'USD')!)).toBeLessThanOrEqual(HELD_RATE_BAND);
    }
  });

  it('ignores a garbage quote rather than pegging to it', () => {
    const first = updateHeldRate(null, spot({ USD: 0.00125 })).held;
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(updateHeldRate(first, spot({ USD: bad }, 2_000)).held.rates.USD).toBe(0.00125);
    }
  });
});

describe('divergence is always reportable', () => {
  it('reports the signed gap from spot', () => {
    const held = updateHeldRate(null, spot({ USD: 0.001 })).held;
    expect(divergence(held, spot({ USD: 0.00105 }), 'USD')).toBeCloseTo(0.05, 10);
    expect(divergence(held, spot({ USD: 0.00095 }), 'USD')).toBeCloseTo(-0.05, 10);
  });

  it('returns null when either side is missing', () => {
    const held = updateHeldRate(null, spot({ USD: 0.001 })).held;
    expect(divergence(held, spot({ USD: 0.001 }), 'JPY')).toBeNull();
  });
});
