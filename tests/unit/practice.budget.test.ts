import { describe, expect, it } from 'vitest';
import { formatZecWithSymbol } from '../../src/lib/conversion/format';
import type { Cadence, Liability } from '../../src/lib/liabilities';
import { budget } from '../../src/lib/practice/modes/budget';
import type { AskContext, Picker, PracticeItem } from '../../src/lib/practice/types';
import type { RatesData } from '../../src/lib/storage/rates';

// Spec: tests/trees/practice.budget.tree

// ZEC ≈ $800. No JPY anywhere, so a yen obligation is the unpriceable case.
const rates: RatesData = {
  rates: { USD: 0.00125, EUR: 0.0013 },
  updatedAt: 0,
  source: 'test',
};

const liability = (
  label: string,
  amount: number,
  direction: 'in' | 'out',
  cadence: Cadence = 'monthly',
  currency = 'USD',
): Liability => ({
  id: label,
  label,
  amount,
  currency,
  cadence,
  direction,
  zecWhenSet: 0,
  addedAt: 0,
});

const item = (label: string, amount: number, currency = 'USD'): PracticeItem => ({
  // The id is deliberately not the label: itemId must carry the id, and a
  // helper where the two are the same cannot tell the difference.
  id: `item:${label}`,
  label,
  emoji: '💻',
  amount,
  currency,
  category: 'tech',
  source: 'catalogue',
});

/**
 * A picker reading from a script, so every shape is reachable from a test.
 * Falls back to the first option once the script runs out, which keeps a test
 * that only cares about the shape down to one number.
 */
const picks = (...values: number[]): Picker => {
  let next = 0;
  return () => values[next++] ?? 0;
};

const context = (over: Partial<AskContext> = {}): AskContext => ({
  items: [item('a laptop', 1600)],
  rates,
  currency: 'USD',
  held: null,
  liabilities: [],
  pick: picks(),
  ...over,
});

// $4,000 in and $1,800 out: 5 ZEC against 2.25 ZEC, leaving 2.75 ZEC.
const salary = liability('salary', 4000, 'in');
const rent = liability('rent', 1800, 'out');
const yen = liability('tax', 50000, 'out', 'monthly', 'JPY');

const AFFORDABLE = 0;
const MONTHS_OF = 1;
const WHAT_IS_LEFT = 2;

it('names itself budget, because progress is recorded per mode', () => {
  expect(budget.id).toBe('budget');
});

describe('given no liabilities', () => {
  it('asks nothing rather than inventing a salary', () => {
    expect(budget.ask(context({ liabilities: [] }))).toBeNull();
  });
});

describe('when the affordability shape is picked', () => {
  it("asks whether the month's net covers an item", () => {
    const question = budget.ask(context({
      liabilities: [salary, rent],
      pick: picks(AFFORDABLE),
    }));

    expect(question?.prompt).toBe(
      `Your month leaves you ${formatZecWithSymbol(2.75)}.`
        + ` Can you afford a laptop at ${formatZecWithSymbol(2)}?`,
    );
    expect(question?.input).toBe('choice');
    expect(question?.choices?.map((choice) => choice.id)).toEqual(['yes', 'no']);
    expect(question?.correct).toBe('yes');
    expect(question?.answer).toBeCloseTo(2, 10);
    expect(question?.band).toBe('large');
    expect(question?.emoji).toBe('💻');
    // The surplus that survives the purchase, which is the number the user is
    // actually being taught to feel.
    expect(question?.explain).toContain(formatZecWithSymbol(0.75));
  });

  it('counts an item costing exactly the net as affordable', () => {
    // A dyadic rate (1/1024) so every product and the subtraction between them
    // are exact. At 0.00125 the boundary would be decided by a rounding error
    // rather than by the comparison this test exists to pin.
    const exact: RatesData = { rates: { USD: 2 ** -10 }, updatedAt: 0, source: 'test' };
    const question = budget.ask(context({
      rates: exact,
      liabilities: [liability('salary', 4096, 'in'), liability('rent', 2048, 'out')],
      items: [item('a laptop', 2048)],
      pick: picks(AFFORDABLE),
    }));

    expect(question?.correct).toBe('yes');
  });

  it('marks an item the month cannot cover as unaffordable', () => {
    const question = budget.ask(context({
      liabilities: [salary, rent],
      items: [item('a used car', 9000)],
      pick: picks(AFFORDABLE),
    }));

    expect(question?.correct).toBe('no');
    expect(question?.explain).toContain('is more than');
  });

  it('says which item it asked about, so a miss can be re-asked', () => {
    const question = budget.ask(context({
      liabilities: [salary, rent],
      pick: picks(AFFORDABLE),
    }));

    // Progress records the miss against this id and the pool resurfaces exactly
    // those ids, so a question that does not name its item is a miss that can
    // never be re-asked.
    expect(question?.itemId).toBe('item:a laptop');
  });

  describe('given a liability nothing can price', () => {
    it('asks nothing, because the net would be understated', () => {
      expect(budget.ask(context({
        liabilities: [salary, rent, yen],
        pick: picks(AFFORDABLE),
      }))).toBeNull();
    });
  });

  describe('given a month that leaves nothing', () => {
    it('asks nothing', () => {
      expect(budget.ask(context({
        liabilities: [liability('salary', 1000, 'in'), rent],
        pick: picks(AFFORDABLE),
      }))).toBeNull();
    });
  });

  describe('given no item that can be priced', () => {
    const month = { liabilities: [salary, rent], pick: picks(AFFORDABLE) };

    it('asks nothing when the currency has no rate', () => {
      expect(budget.ask(context({ ...month, items: [item('a bento', 900, 'JPY')] }))).toBeNull();
    });

    it('asks nothing when the held rate cannot carry the currency', () => {
      expect(budget.ask(context({
        ...month,
        held: { peg: 0.00125, pegged: 0 },
        items: [item('a bento', 900, 'JPY')],
      }))).toBeNull();
    });

    it('asks nothing when the amount is not positive', () => {
      expect(budget.ask(context({ ...month, items: [item('a freebie', 0)] }))).toBeNull();
    });

    it('asks nothing when the arithmetic overflows', () => {
      // An anchor is user-entered, so a number large enough to overflow to
      // Infinity is reachable. It must not render as "∞ ZEC" and be scored.
      expect(budget.ask(context({
        ...month,
        rates: { rates: { USD: 1e10 }, updatedAt: 0, source: 'test' },
        items: [item('a folly', 1e308)],
      }))).toBeNull();
    });
  });
});

describe('when the months-of shape is picked', () => {
  it('asks how many months of an obligation an item costs', () => {
    const question = budget.ask(context({
      liabilities: [rent],
      pick: picks(MONTHS_OF),
    }));

    expect(question?.prompt).toBe(
      `${formatZecWithSymbol(2)} buys a laptop. How many months of rent is that?`,
    );
    expect(question?.input).toBe('number');
    // 2 ZEC against 2.25 ZEC a month.
    expect(question?.answer).toBeCloseTo(0.888888, 5);
    expect(question?.explain).toContain('0.89 months');
    // The band tracks the ZEC figure, not the ratio: a count of months has no
    // magnitude to practise.
    expect(question?.band).toBe('large');
  });

  it('normalises a yearly obligation to a month', () => {
    // $1,200 a year is 1.5 ZEC a year, so 0.125 ZEC a month. A laptop at 2 ZEC
    // is 16 months of it — and 1.33 if the cadence were ignored.
    const question = budget.ask(context({
      liabilities: [liability('insurance', 1200, 'out', 'yearly')],
      pick: picks(MONTHS_OF),
    }));

    expect(question?.answer).toBeCloseTo(16, 10);
  });

  it('steps over an obligation it cannot price and asks about one it can', () => {
    const question = budget.ask(context({
      liabilities: [yen, rent],
      pick: picks(MONTHS_OF),
    }));

    expect(question?.prompt).toContain('months of rent');
  });

  it('says which item it asked about, so a miss can be re-asked', () => {
    const question = budget.ask(context({
      liabilities: [rent],
      pick: picks(MONTHS_OF),
    }));

    expect(question?.itemId).toBe('item:a laptop');
  });

  describe('given nothing going out', () => {
    it('asks nothing', () => {
      expect(budget.ask(context({ liabilities: [salary], pick: picks(MONTHS_OF) }))).toBeNull();
    });
  });

  describe('given every obligation unpriced', () => {
    it('asks nothing', () => {
      expect(budget.ask(context({ liabilities: [yen], pick: picks(MONTHS_OF) }))).toBeNull();
    });
  });

  describe('given no item that can be priced', () => {
    it('asks nothing', () => {
      expect(budget.ask(context({
        liabilities: [rent],
        items: [],
        pick: picks(MONTHS_OF),
      }))).toBeNull();
    });
  });
});

describe('when the what-is-left shape is picked', () => {
  it('asks for the net and names what takes it', () => {
    const question = budget.ask(context({
      liabilities: [salary, rent, liability('transit', 200, 'out')],
      pick: picks(WHAT_IS_LEFT),
    }));

    expect(question?.prompt).toBe(
      `You take in ${formatZecWithSymbol(5)} a month, and rent and transit take`
        + ` ${formatZecWithSymbol(2.5)}. What is left?`,
    );
    expect(question?.input).toBe('number');
    expect(question?.answer).toBeCloseTo(2.5, 10);
    expect(question?.explain).toContain(formatZecWithSymbol(2.5));
  });

  it('names a single obligation without a list', () => {
    const question = budget.ask(context({
      liabilities: [salary, rent],
      pick: picks(WHAT_IS_LEFT),
    }));

    expect(question?.prompt).toContain('and rent take');
  });

  it('names three obligations and counts the rest', () => {
    // Twelve obligations of thirty-two characters would be a four-line prompt,
    // and the count keeps the sentence from implying the list is complete.
    const question = budget.ask(context({
      liabilities: [
        salary,
        rent,
        liability('transit', 200, 'out'),
        liability('gym', 40, 'out'),
        liability('music', 10, 'out'),
        liability('phone', 30, 'out'),
      ],
      pick: picks(WHAT_IS_LEFT),
    }));

    expect(question?.prompt).toContain('rent, transit, gym and 2 more take');
  });

  it('names no item, because a liability is not something to practise', () => {
    const question = budget.ask(context({
      liabilities: [salary, rent],
      pick: picks(WHAT_IS_LEFT),
    }));

    // An id here would put the user's own rent into the spaced-repetition queue
    // as though it were a price to learn, and there is no item in the question
    // to re-ask them about anyway.
    expect(question?.itemId).toBeUndefined();
  });

  describe('given nothing going out', () => {
    it('asks nothing', () => {
      expect(budget.ask(context({ liabilities: [salary], pick: picks(WHAT_IS_LEFT) }))).toBeNull();
    });
  });

  describe('given obligations bigger than income', () => {
    it('asks nothing, because there is no positive number to score', () => {
      expect(budget.ask(context({
        liabilities: [liability('salary', 1000, 'in'), rent],
        pick: picks(WHAT_IS_LEFT),
      }))).toBeNull();
    });
  });

  describe('given a liability nothing can price', () => {
    it('asks nothing', () => {
      expect(budget.ask(context({
        liabilities: [salary, rent, yen],
        pick: picks(WHAT_IS_LEFT),
      }))).toBeNull();
    });
  });
});

describe('given a held rate', () => {
  // Spot has run 60% since the peg. The held rate is what keeps the month a
  // level the user can hold on to rather than a number that moves nightly.
  const moved: RatesData = { ...rates, rates: { ...rates.rates, USD: 0.002 } };
  const held = { peg: 0.00125, pegged: 0 };

  it('prices the month at the held rate rather than spot', () => {
    const question = budget.ask(context({
      rates: moved,
      held,
      liabilities: [salary, rent],
      pick: picks(WHAT_IS_LEFT),
    }));

    // 2.75 ZEC held, against 4.4 ZEC at spot.
    expect(question?.answer).toBeCloseTo(2.75, 10);
  });

  it('prices the item at the held rate rather than spot', () => {
    const question = budget.ask(context({
      rates: moved,
      held,
      liabilities: [salary, rent],
      pick: picks(AFFORDABLE),
    }));

    // 2 ZEC held, against 3.2 ZEC at spot.
    expect(question?.answer).toBeCloseTo(2, 10);
  });
});
