import { describe, expect, it } from 'vitest';
import {
  createLiability,
  type Liability,
  liabilityZec,
  monthlyPosition,
} from '../../src/lib/liabilities';
import type { RatesData } from '../../src/lib/storage/rates';

// Spec: tests/trees/liabilities.tree

// ZEC ≈ $800.
const rates: RatesData = {
  rates: { USD: 0.00125, EUR: 0.0013 },
  updatedAt: Date.now(),
  source: 'test',
};

const make = (
  label: string,
  amount: number,
  cadence: 'weekly' | 'monthly' | 'yearly',
  direction: 'in' | 'out',
  currency = 'USD',
): Liability => createLiability(label, amount, currency, cadence, direction, rates)!;

describe('liabilityZec', () => {
  describe('given a spot rate', () => {
    it('prices a single obligation', () => {
      // $1,800 rent at 0.00125 ZEC/USD = 2.25 ZEC.
      expect(liabilityZec(make('rent', 1800, 'monthly', 'out'), rates)).toBeCloseTo(2.25, 10);
    });
  });

  describe('given a held rate', () => {
    it('prices against the held rate', () => {
      // Liabilities are the one place a level, rather than a ratio, is what
      // the user is trying to hold on to. The held rate is what keeps it still.
      const held = { peg: 0.00125, pegged: Date.now() };
      const moved: RatesData = { ...rates, rates: { ...rates.rates, USD: 0.002 } };
      expect(liabilityZec(make('rent', 1800, 'monthly', 'out'), moved, held))
        .toBeCloseTo(2.25, 10);
    });

    describe('given the held rate cannot cover the currency', () => {
      it('cannot price it', () => {
        const held = { peg: 0.00125, pegged: Date.now() };
        const yen = { ...make('rent', 1800, 'monthly', 'out'), currency: 'JPY' };
        expect(liabilityZec(yen, rates, held)).toBeNull();
      });
    });
  });

  describe('given a currency with no rate', () => {
    it('cannot price it', () => {
      const yen = { ...make('rent', 1800, 'monthly', 'out'), currency: 'JPY' };
      expect(liabilityZec(yen, rates)).toBeNull();
    });
  });

  describe('given a rate that is not positive', () => {
    it('cannot price it', () => {
      // A negative rate would report the rent as money coming in, and a zero
      // rate as costing nothing at all. Both read as good news.
      const rent = make('rent', 1800, 'monthly', 'out');
      for (const bad of [0, -0.00125]) {
        expect(liabilityZec(rent, { ...rates, rates: { USD: bad } })).toBeNull();
      }
    });
  });

  describe('given a non-positive amount', () => {
    it('cannot price it', () => {
      expect(liabilityZec({ ...make('rent', 1800, 'monthly', 'out'), amount: 0 }, rates))
        .toBeNull();
    });
  });

  describe('given the arithmetic does not produce a usable number', () => {
    it('cannot price it', () => {
      const huge = { ...make('rent', 1800, 'monthly', 'out'), amount: 1e308 };
      expect(liabilityZec(huge, { ...rates, rates: { USD: 1e308 } })).toBeNull();
    });
  });
});

describe('monthlyPosition', () => {
  it('normalises every cadence to a month', () => {
    const weekly = monthlyPosition([make('groceries', 100, 'weekly', 'out')], rates);
    // 100/wk x 52/12 = 433.33/mo -> 0.5417 ZEC
    expect(weekly.outgoing).toBeCloseTo((100 * 52 / 12) * 0.00125, 10);

    const yearly = monthlyPosition([make('insurance', 1200, 'yearly', 'out')], rates);
    expect(yearly.outgoing).toBeCloseTo(100 * 0.00125, 10);
  });

  it('nets income against obligations', () => {
    const position = monthlyPosition([
      make('salary', 6000, 'monthly', 'in'),
      make('rent', 1800, 'monthly', 'out'),
      make('subscriptions', 60, 'monthly', 'out'),
    ], rates);

    expect(position.incoming).toBeCloseTo(7.5, 10);
    expect(position.outgoing).toBeCloseTo(2.325, 10);
    expect(position.net).toBeCloseTo(5.175, 10);
  });

  it('mixes currencies, because obligations do', () => {
    const position = monthlyPosition([
      make('salary', 6000, 'monthly', 'in'),
      make('rent', 1500, 'monthly', 'out', 'EUR'),
    ], rates);
    expect(position.outgoing).toBeCloseTo(1500 * 0.0013, 10);
  });

  it('names what it could not price rather than quietly undercounting', () => {
    // A position that silently omits an obligation reads as healthier than it
    // is, which is the one way this feature can actually hurt someone.
    const yen = { ...make('rent', 1800, 'monthly', 'out'), currency: 'JPY' };
    const position = monthlyPosition([yen, make('salary', 6000, 'monthly', 'in')], rates);
    expect(position.unpriced).toEqual(['rent']);
    expect(position.incoming).toBeCloseTo(7.5, 10);
  });

  describe('given nothing entered', () => {
    it('is empty, not broken', () => {
      expect(monthlyPosition([], rates)).toEqual({
        incoming: 0,
        outgoing: 0,
        net: 0,
        unpriced: [],
      });
    });
  });
});

describe('createLiability', () => {
  it('records what it cost when entered, so drift is visible later', () => {
    expect(make('rent', 1800, 'monthly', 'out').zecWhenSet).toBeCloseTo(2.25, 10);
  });

  it('gives each entry an id nothing downstream has to escape', () => {
    // The id is how a row is found again to edit or delete it. Two rows sharing
    // one would delete the wrong obligation.
    const ids = Array.from({ length: 20 }, () => make('rent', 1800, 'monthly', 'out').id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-z]+-[0-9a-z]*$/);
  });

  it('upper-cases the currency', () => {
    expect(createLiability('rent', 1800, 'usd', 'monthly', 'out', rates)?.currency).toBe('USD');
  });

  it('truncates an over-long label', () => {
    const long = createLiability('a'.repeat(80), 100, 'USD', 'monthly', 'out', rates);
    expect(long!.label.length).toBeLessThanOrEqual(40);
  });

  describe('given input it cannot price', () => {
    it('refuses an empty label', () => {
      expect(createLiability('   ', 100, 'USD', 'monthly', 'out', rates)).toBeNull();
    });

    it('refuses a non-positive amount', () => {
      expect(createLiability('x', 0, 'USD', 'monthly', 'out', rates)).toBeNull();
    });

    it('refuses a currency with no rate', () => {
      expect(createLiability('x', 100, 'XXX', 'monthly', 'out', rates)).toBeNull();
    });
  });
});
