import { describe, expect, it } from 'vitest';
import { comparison } from '../../src/lib/practice/modes/comparison';
import type { AskContext, Picker, PracticeItem } from '../../src/lib/practice/types';
import type { RatesData } from '../../src/lib/storage/rates';

// Spec: tests/trees/practice.comparison.tree

const usd: RatesData = { rates: { USD: 0.00125 }, updatedAt: 0, source: 'test' };
const noRates: RatesData = { rates: {}, updatedAt: 0, source: 'test' };

function item(id: string, amount: number, extra: Partial<PracticeItem> = {}): PracticeItem {
  return {
    id,
    label: `a ${id}`,
    emoji: '🧪',
    amount,
    currency: 'USD',
    category: 'home',
    source: 'catalogue',
    ...extra,
  };
}

// At 0.00125 ZEC per USD: a coffee is 0.005 ZEC, a laptop is 2 ZEC.
const coffee = item('coffee', 4, { emoji: '☕' });
const lunch = item('lunch', 15);
const laptop = item('laptop', 1600, { emoji: '💻' });

/** The draws a question takes, in order: shape, first item, then the offset. */
function draws(...values: number[]): Picker {
  let next = 0;
  return () => values[next++];
}

function ask(items: PracticeItem[], picks: number[], extra: Partial<AskContext> = {}) {
  return comparison.ask({
    items,
    rates: usd,
    currency: 'USD',
    held: null,
    liabilities: [],
    pick: draws(...picks),
    ...extra,
  });
}

describe('the mode itself', () => {
  it('is registered under the comparison id', () => {
    // The id is how progress is filed and how the picker addresses the mode; a
    // drifted id silently splits one mode's history into two.
    expect(comparison.id).toBe('comparison');
  });

  it('says what it trains', () => {
    expect(comparison.title).toMatch(/\S/);
    expect(comparison.blurb).toMatch(/\S/);
  });
});

describe('given fewer than two items', () => {
  it('asks nothing', () => {
    // Nothing to compare against is not a hard question, it is no question.
    expect(ask([], [0, 0, 0])).toBeNull();
    expect(ask([coffee], [0, 0, 0])).toBeNull();
  });
});

describe('which is more', () => {
  describe('given two items far enough apart', () => {
    it('offers the ZEC amount against the named item', () => {
      const question = ask([laptop, coffee], [0, 0, 0])!;

      expect(question.mode).toBe('comparison');
      expect(question.input).toBe('choice');
      expect(question.choices!.map((choice) => choice.id)).toEqual(['zec', 'item']);
      expect(question.choices![0].label).toContain('ZEC');
      expect(question.choices![1].label).toBe('a coffee');
      expect(question.answer).toBe(2);
      // The item behind the ZEC figure is never named: naming it turns the
      // question into a memory test for that one price.
      expect(question.prompt).toContain('a coffee');
      expect(question.prompt).not.toContain('a laptop');
      expect(question.emoji).toBe('☕');
      // A factor of two is the edge of knowable, and the edge is included.
      expect(ask([item('big', 10), item('small', 5)], [0, 0, 0])).not.toBeNull();
    });

    it('marks the ZEC side correct when it outweighs the item', () => {
      const question = ask([laptop, coffee], [0, 0, 0])!;
      expect(question.correct).toBe('zec');
      expect(question.explain).toContain('less');
    });

    it('marks the item correct when the item outweighs the ZEC amount', () => {
      const question = ask([coffee, laptop], [0, 0, 0])!;
      expect(question.correct).toBe('item');
      expect(question.explain).toContain('more');
    });

    it('records the named item as what was asked about', () => {
      // A miss is filed against this id and the pool resurfaces it later, so a
      // question that names no item is a miss that can never be re-asked.
      expect(ask([laptop, coffee], [0, 0, 0])!.itemId).toBe('coffee');
      expect(ask([coffee, laptop], [0, 0, 0])!.itemId).toBe('laptop');
    });

    it('files the question under the band of the ZEC amount', () => {
      // The band the user is being tested on is the one on the ZEC side; that
      // is the figure they have to place.
      expect(ask([laptop, coffee], [0, 0, 0])!.band).toBe('large');
      expect(ask([coffee, laptop], [0, 0, 0])!.band).toBe('tiny');
    });
  });

  describe('given a held rate', () => {
    it('prices the ZEC side at the rate the pages are showing', () => {
      // Asking at spot marks the user wrong against a number the product never
      // displayed to them.
      const question = ask([laptop, coffee], [0, 0, 0], {
        held: { peg: 0.002, pegged: 0 },
      })!;
      expect(question.answer).toBe(3.2);
    });
  });

  describe('given two items priced too close together', () => {
    it('asks nothing', () => {
      // Inside a factor of two the answer turns on memorised prices, and the
      // coarse ZEC figure can make it a coin flip we would score as a mistake.
      expect(ask([item('bagel', 5), coffee], [0, 0, 0])).toBeNull();
      expect(ask([item('near', 199), item('far', 100)], [0, 0, 0])).toBeNull();
    });
  });

  describe('given no rate for the ZEC side', () => {
    it('asks nothing', () => {
      expect(ask([item('pint', 6, { currency: 'GBP' }), laptop], [0, 0, 0])).toBeNull();
    });
  });

  describe('given no rate for the item it names', () => {
    it('asks nothing', () => {
      // Without both legs in ZEC there is no way to know which side is bigger,
      // and a guessed answer key is worse than no question.
      expect(ask([laptop, item('pint', 6, { currency: 'GBP' })], [0, 0, 0])).toBeNull();
    });
  });

  describe('given a price that cannot be valued', () => {
    it('asks nothing for a price too large to be real', () => {
      // A 'seen' item's price came off a parsed page, so a runaway magnitude
      // is reachable input; it would otherwise render as "≈∞ ZEC".
      const runaway = item('glitch', Number.POSITIVE_INFINITY, { source: 'seen' });
      expect(ask([runaway, coffee], [0, 0, 0])).toBeNull();
    });

    it('asks nothing for a price of nothing', () => {
      expect(ask([item('free', 0), coffee], [0, 0, 0])).toBeNull();
    });
  });
});

describe('how many of the cheaper', () => {
  describe('given a pair inside the teaching range', () => {
    it('asks for the ratio and answers with it', () => {
      const question = ask([laptop, coffee], [1, 0, 0])!;

      expect(question.mode).toBe('comparison');
      expect(question.input).toBe('number');
      expect(question.answer).toBe(400);
      // A numeric question carries no choices to render and no key to match.
      expect(question.choices).toBeUndefined();
      expect(question.correct).toBeUndefined();
      expect(question.prompt).toContain('a coffee');
      expect(question.prompt).toContain('a laptop');
      expect(question.emoji).toBe('💻');
      // Both edges of the teaching range are included.
      expect(ask([item('big', 8), item('small', 4)], [1, 0, 0])).not.toBeNull();
      expect(ask([item('big', 4000), item('small', 4)], [1, 0, 0])).not.toBeNull();
    });

    it('names the dearer item whichever way the pair was drawn', () => {
      // Draw order is the picker's business; which item is dearer is the
      // prices' business, and swapping them must not invert the question.
      const drawn = ask([laptop, coffee], [1, 0, 0])!;
      const reversed = ask([coffee, laptop], [1, 0, 0])!;
      expect(reversed.prompt).toBe(drawn.prompt);
      expect(reversed.answer).toBe(drawn.answer);
    });

    it('records the dearer item as what was asked about', () => {
      // The cheaper item is the ruler; the dearer one is the price under test,
      // and it is the one worth resurfacing after a miss. Draw order must not
      // decide which is recorded.
      expect(ask([laptop, coffee], [1, 0, 0])!.itemId).toBe('laptop');
      expect(ask([coffee, laptop], [1, 0, 0])!.itemId).toBe('laptop');
    });

    it('explains that the ratio survives a move in the rate', () => {
      // The lesson of this mode is the rate-independence, so it is said out
      // loud rather than left to be inferred from two prices.
      const question = ask([laptop, coffee], [1, 0, 0])!;
      expect(question.explain).toContain('USD');
      expect(question.explain).toContain('400×');
      expect(question.explain).toContain('stays the same when the rate moves');
    });
  });

  describe('given no rate at all', () => {
    it('still asks, because a ratio needs no rate', () => {
      // Both legs convert at the same rate, so it cancels: this is the one
      // question that survives a dead provider or an unquoted currency.
      const question = ask([laptop, coffee], [1, 0, 0], { rates: noRates })!;
      expect(question.answer).toBe(400);
    });

    it('files the question under the everyday band', () => {
      // No rate means no ZEC magnitude to file it under; the middle bucket
      // costs less than declining to ask at all.
      expect(ask([laptop, coffee], [1, 0, 0], { rates: noRates })!.band).toBe('everyday');
    });
  });

  describe('given a rate for the dearer item', () => {
    it('files the question under its band', () => {
      expect(ask([laptop, coffee], [1, 0, 0])!.band).toBe('large');
    });
  });

  describe('given a pair too close to teach anything', () => {
    it('asks nothing', () => {
      // "About 1.3 coffees" is a rounding error wearing a lesson's clothes.
      expect(ask([item('bagel', 5), coffee], [1, 0, 0])).toBeNull();
      expect(ask([item('near', 199), item('far', 100)], [1, 0, 0])).toBeNull();
    });
  });

  describe('given a ratio too large to hold in mind', () => {
    it('asks nothing', () => {
      // Past a thousand nobody estimates the answer, they divide.
      expect(ask([item('yacht', 8000), coffee], [1, 0, 0])).toBeNull();
      expect(ask([item('over', 4004), item('under', 4)], [1, 0, 0])).toBeNull();
    });
  });

  describe('given two items priced in different currencies', () => {
    it('asks nothing', () => {
      // Two currencies only cancel through a fiat cross, and reaching for one
      // reintroduces the rate dependence this shape exists to avoid.
      expect(ask([coffee, item('rent', 1600, { currency: 'EUR' })], [1, 0, 0])).toBeNull();
    });
  });

  describe('given a price that cannot be valued', () => {
    it('asks nothing when the first drawn price is unusable', () => {
      const runaway = item('glitch', Number.POSITIVE_INFINITY, { source: 'seen' });
      expect(ask([runaway, coffee], [1, 0, 0])).toBeNull();
    });

    it('asks nothing when the second drawn price is unusable', () => {
      // A ratio against zero is Infinity, which passes every range check that
      // is written as a comparison.
      expect(ask([coffee, item('free', 0)], [1, 0, 0])).toBeNull();
    });
  });
});

describe('drawing the pair', () => {
  it('never compares an item with itself', () => {
    // "How many times the price of a coffee does a coffee cost?" is the shape
    // a naive second draw produces, and it is unanswerable by construction.
    const pool = [coffee, lunch, laptop];
    for (const first of [0, 1, 2]) {
      for (const offset of [0, 1]) {
        const question = ask(pool, [1, first, offset])!;
        const named = pool.filter((entry) => question.prompt.includes(entry.label));
        expect(named).toHaveLength(2);
      }
    }
  });

  it('draws within the bounds it is given', () => {
    // The second draw must be bounded by the REMAINING items; asking for
    // items.length there would step past the end of the pool.
    const bounds: number[] = [];
    comparison.ask({
      items: [coffee, lunch, laptop],
      rates: usd,
      currency: 'USD',
      held: null,
      liabilities: [],
      pick: (upperExclusive) => {
        bounds.push(upperExclusive);
        return 0;
      },
    });
    expect(bounds).toEqual([2, 3, 2]);
  });
});
