import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRateValidation, validateRates } from '../../src/lib/rates/validate';
import type { RatesData } from '../../src/lib/storage/rates';

// Spec: tests/trees/validate.tree

const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;
// ZEC ≈ $800, so ZEC-per-USD ≈ 0.00125.
const previous: RatesData = {
  rates: { USD: 0.00125, EUR: 0.0013 },
  rateUpdatedAt: { USD: now, EUR: now },
  updatedAt: now,
  source: 'coingecko',
};

// updatedAt 0 is the sentinel for a store that has never been written, so
// every quote measured against it is a first quote.
const noBaseline: RatesData = { rates: {}, updatedAt: 0, source: '' };

const incoming = (rates: Record<string, number>): RatesData => ({
  rates,
  updatedAt: now,
  source: 'test',
});

// A 60% jump: far outside anything the delta guard lets through unchallenged.
const outlier = incoming({ USD: 0.002 });

beforeEach(resetRateValidation);
afterEach(() => {
  vi.useRealTimers();
});

describe('validateRates', () => {
  describe('given a quote inside the plausible range', () => {
    it('accepts a normal quote', () => {
      expect(validateRates(incoming({ USD: 0.00127 }), previous).rates).toEqual({ USD: 0.00127 });
    });

    it('accepts a quote at the cheap end of the range', () => {
      // One ZEC to the fiat unit: the cheapest ZEC we will believe. The bound
      // includes it, because rejecting the edge freezes the page on a rate we
      // already know is out of date.
      expect(validateRates(incoming({ USD: 1 }), noBaseline).rates.USD).toBe(1);
    });

    it('accepts a quote at the dear end of the range', () => {
      // ZEC at a hundred thousand to the unit. Also inclusive: a real run to
      // six figures must not be thrown away as a decimal shift.
      expect(validateRates(incoming({ USD: 0.00001 }), noBaseline).rates.USD).toBe(0.00001);
    });
  });

  describe('given a quote outside the plausible range', () => {
    it('rejects values outside any plausible ZEC price', () => {
      // Nothing else stands between a garbage quote and every price on the
      // page, so the range check has to hold on its own.
      for (const bad of [1e9, 1e-9, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        resetRateValidation();
        expect(validateRates(incoming({ USD: bad }), previous).rejected).toContain('USD');
      }
    });

    it('rejects a decimal shift', () => {
      // 0.0125 ZEC/USD implies ZEC at $80 — an order of magnitude out.
      expect(validateRates(incoming({ USD: 0.0125 }), previous).rejected).toContain('USD');
    });

    it('rejects a quote that puts ZEC under a single fiat unit', () => {
      // What a feed quoting cents rather than units looks like from here.
      expect(validateRates(incoming({ USD: 2 }), noBaseline).rejected).toContain('USD');
    });

    it('rejects a quote that puts ZEC over a hundred thousand', () => {
      // And what a feed quoting a wrong-asset or satoshi-scale price looks
      // like: 111,111 to the unit, a 100x error on the page.
      expect(validateRates(incoming({ USD: 0.000009 }), noBaseline).rejected).toContain('USD');
    });

    it('rejects a quote that is not a number', () => {
      // The rate arrives as JSON, where the type is a claim rather than a
      // fact. A numeric string compares against the bounds as if it were fine.
      const stringified = { USD: '0.00125' as unknown as number };
      expect(validateRates(incoming(stringified), noBaseline).rejected).toContain('USD');
    });
  });

  describe('given one currency is bad', () => {
    it('keeps the good currencies', () => {
      const result = validateRates(incoming({ USD: 0.00127, EUR: 99999 }), previous);
      expect(result.rates).toEqual({ USD: 0.00127 });
      expect(result.rejected).toEqual(['EUR']);
    });
  });

  describe('given the same rejection keeps arriving', () => {
    it('gives in after three consecutive rejections so a real crash is not locked out', () => {
      const crashed = incoming({ USD: 0.00125 * 1.6 });
      expect(validateRates(crashed, previous).rejected).toContain('USD');
      expect(validateRates(crashed, previous).rejected).toContain('USD');
      // Third time it is the market, not us.
      expect(validateRates(crashed, previous).rates.USD).toBeCloseTo(0.002, 10);
    });
  });

  describe('given a good quote arrives between outliers', () => {
    it('starts the count of rejections again', () => {
      validateRates(outlier, previous);
      validateRates(outlier, previous);
      expect(validateRates(incoming({ USD: 0.00127 }), previous).rates.USD).toBe(0.00127);
      // Two strikes from before the good quote must not let the next outlier
      // through on its first showing: three in a row means the market moved,
      // and these are not in a row.
      expect(validateRates(outlier, previous).rejected).toContain('USD');
      expect(validateRates(outlier, previous).rejected).toContain('USD');
    });
  });

  describe('given a move of exactly the largest allowed size', () => {
    it('accepts it', () => {
      // 25% is the limit, not the first value refused. Values picked so the
      // move lands on 0.25 exactly in binary floating point.
      const baseline: RatesData = {
        rates: { USD: 0.0009765625 },
        rateUpdatedAt: { USD: now },
        updatedAt: now,
        source: 'coingecko',
      };
      const edge = 0.001220703125;
      expect(validateRates(incoming({ USD: edge }), baseline).rates.USD).toBe(edge);
    });
  });

  describe('given the baseline is stale', () => {
    it('does not apply a delta guard against it', () => {
      const old: RatesData = {
        rates: { USD: 0.00125 },
        updatedAt: now - 5 * 86_400_000,
        source: 'x',
      };
      expect(validateRates(incoming({ USD: 0.002 }), old).rates.USD).toBe(0.002);
    });
  });

  describe('given the baseline is exactly a day old', () => {
    it('still holds a big move against it', () => {
      // The window is a day, and a day old is still inside it. Shrink this
      // window by accident and the delta guard stops guarding anything: every
      // baseline reads as stale and every quote is taken on trust.
      vi.useFakeTimers();
      vi.setSystemTime(now);
      const dayOld: RatesData = {
        rates: { USD: 0.00125 },
        rateUpdatedAt: { USD: now - DAY },
        updatedAt: now,
        source: 'coingecko',
      };
      expect(validateRates(outlier, dayOld).rejected).toContain('USD');
    });
  });

  describe('given the store has never been written', () => {
    it('holds nothing against the rates it carries', () => {
      // A per-currency timestamp cannot make a baseline out of a store that
      // was never successfully written.
      const unwritten: RatesData = {
        rates: { USD: 0.00125 },
        rateUpdatedAt: { USD: now },
        updatedAt: 0,
        source: '',
      };
      expect(validateRates(outlier, unwritten).rates.USD).toBe(0.002);
    });
  });

  describe('given the currency carries no timestamp of its own', () => {
    it('falls back to when the store was last written', () => {
      // Caches written by older versions have no per-currency stamps. Reading
      // that as an unknown age would drop the delta guard for all of them.
      const legacy: RatesData = {
        rates: { USD: 0.00125 },
        updatedAt: now,
        source: 'coingecko',
      };
      expect(validateRates(outlier, legacy).rejected).toContain('USD');
    });
  });

  describe('given the last fetch did not refresh this currency', () => {
    it('ages the currency by its own timestamp', () => {
      // Kraken quotes only ZEC/USD and ZEC/EUR, so a fallback fetch leaves the
      // other currencies at week-old values while the store-wide time says
      // seconds. Guarding against those is guarding against the wrong number.
      const partial: RatesData = {
        rates: { USD: 0.00125 },
        rateUpdatedAt: { USD: now - 2 * DAY },
        updatedAt: now,
        source: 'kraken',
      };
      expect(validateRates(outlier, partial).rates.USD).toBe(0.002);
    });
  });

  describe('given there is no baseline', () => {
    it('accepts anything on a first run', () => {
      expect(validateRates(incoming({ USD: 0.00125 }), noBaseline).rates.USD).toBe(0.00125);
    });
  });
});

describe('resetRateValidation', () => {
  describe('given outliers have been held twice', () => {
    it('forgets the run so the next one is held again', () => {
      validateRates(outlier, previous);
      validateRates(outlier, previous);
      resetRateValidation();
      // Otherwise the count would reach three and the outlier would be taken
      // as the new truth.
      expect(validateRates(outlier, previous).rejected).toContain('USD');
    });
  });
});
