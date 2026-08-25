import { describe, expect, it } from 'vitest';
import {
  createLiability,
  type Liability,
  liabilityZec,
  monthlyPosition,
} from '../../src/lib/liabilities';
import type { RatesData } from '../../src/lib/storage/rates';

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

describe('a month, in ZEC', () => {
  it('prices a single obligation', () => {
    // $1,800 rent at 0.00125 ZEC/USD = 2.25 ZEC.
    expect(liabilityZec(make('rent', 1800, 'monthly', 'out'), rates)).toBeCloseTo(2.25, 10);
  });

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
    const yen = { ...make('rent', 1800, 'monthly', 'out'), currency: 'JPY' };
    const position = monthlyPosition([yen, make('salary', 6000, 'monthly', 'in')], rates);
    expect(position.unpriced).toEqual(['rent']);
    expect(position.incoming).toBeCloseTo(7.5, 10);
  });

  it('records what it cost when entered, so drift is visible later', () => {
    expect(make('rent', 1800, 'monthly', 'out').zecWhenSet).toBeCloseTo(2.25, 10);
  });

  it('refuses input it cannot price', () => {
    expect(createLiability('', 100, 'USD', 'monthly', 'out', rates)).toBeNull();
    expect(createLiability('x', 0, 'USD', 'monthly', 'out', rates)).toBeNull();
    expect(createLiability('x', 100, 'XXX', 'monthly', 'out', rates)).toBeNull();
  });

  it('is empty, not broken, with nothing entered', () => {
    expect(monthlyPosition([], rates)).toEqual({
      incoming: 0,
      outgoing: 0,
      net: 0,
      unpriced: [],
    });
  });
});
