import { beforeEach, describe, expect, it } from 'vitest';
import { resetRateValidation, validateRates } from '../../src/lib/rates/validate';
import type { RatesData } from '../../src/lib/storage/rates';

const now = Date.now();
// ZEC ≈ $800, so ZEC-per-USD ≈ 0.00125.
const previous: RatesData = {
  rates: { USD: 0.00125, EUR: 0.0013 },
  rateUpdatedAt: { USD: now, EUR: now },
  updatedAt: now,
  source: 'coingecko',
};

const incoming = (rates: Record<string, number>): RatesData => ({
  rates,
  updatedAt: now,
  source: 'test',
});

beforeEach(resetRateValidation);

describe('a broken feed cannot rewrite every price on the page', () => {
  it('accepts a normal quote', () => {
    expect(validateRates(incoming({ USD: 0.00127 }), previous).rates).toEqual({ USD: 0.00127 });
  });

  it('rejects a decimal shift', () => {
    // 0.0125 ZEC/USD implies ZEC at $80 — an order of magnitude out.
    expect(validateRates(incoming({ USD: 0.0125 }), previous).rejected).toContain('USD');
  });

  it('rejects values outside any plausible ZEC price', () => {
    for (const bad of [1e9, 1e-9, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      resetRateValidation();
      expect(validateRates(incoming({ USD: bad }), previous).rejected).toContain('USD');
    }
  });

  it('keeps the good currencies when one is bad', () => {
    const result = validateRates(incoming({ USD: 0.00127, EUR: 99999 }), previous);
    expect(result.rates).toEqual({ USD: 0.00127 });
    expect(result.rejected).toEqual(['EUR']);
  });

  it('gives in after three consecutive rejections so a real crash is not locked out', () => {
    const crashed = incoming({ USD: 0.00125 * 1.6 });
    expect(validateRates(crashed, previous).rejected).toContain('USD');
    expect(validateRates(crashed, previous).rejected).toContain('USD');
    // Third time it is the market, not us.
    expect(validateRates(crashed, previous).rates.USD).toBeCloseTo(0.002, 10);
  });

  it('does not apply a delta guard against a stale baseline', () => {
    const old: RatesData = {
      rates: { USD: 0.00125 },
      updatedAt: now - 5 * 86_400_000,
      source: 'x',
    };
    expect(validateRates(incoming({ USD: 0.002 }), old).rates.USD).toBe(0.002);
  });

  it('accepts anything on a first run with no baseline', () => {
    const empty: RatesData = { rates: {}, updatedAt: 0, source: '' };
    expect(validateRates(incoming({ USD: 0.00125 }), empty).rates.USD).toBe(0.00125);
  });
});
