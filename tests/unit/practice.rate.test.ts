import { describe, expect, it } from 'vitest';
import { rateRecall } from '../../src/lib/practice/modes/rate';
import type { AskContext, Picker, Question } from '../../src/lib/practice/types';
import { scoreAnswer } from '../../src/lib/practice/types';
import type { HeldRate } from '../../src/lib/rates/held';
import type { RatesData } from '../../src/lib/storage/rates';

// Spec: tests/trees/practice.rate.tree

const spot = (rates: Record<string, number>): RatesData => ({
  rates,
  updatedAt: 1_000,
  source: 'test',
});

/** 1 ZEC = 50 USD, which keeps every figure in this file separator-free. */
const HELD: HeldRate = { peg: 0.02, pegged: 1_000 };

/** Hands back the given draws in order, so a shape and a slot can be forced. */
const draws = (...values: number[]): Picker => {
  let next = 0;
  return () => values[next++];
};

const ask = (overrides: Partial<AskContext> = {}): Question | null =>
  rateRecall.ask({
    items: [],
    rates: spot({ USD: 0.02 }),
    currency: 'USD',
    held: HELD,
    liabilities: [],
    pick: draws(0),
    ...overrides,
  });

describe('rateRecall', () => {
  it('identifies itself as the rate mode', () => {
    expect(rateRecall.id).toBe('rate');
    expect(rateRecall.title).toBeTruthy();
    expect(rateRecall.blurb).toBeTruthy();
  });

  it('picks the question shape with the injected picker', () => {
    // The picker is asked for the full range of shapes, and each index really
    // does produce a different question. A mode that drew from a narrower range
    // would silently retire a shape nobody would notice was gone.
    const seen: number[] = [];
    const record: Picker = (upper) => {
      seen.push(upper);
      return 0;
    };
    ask({ pick: record });
    expect(seen[0]).toBe(3);

    // Compared on prompt AND input, because the choice shape deliberately asks
    // the same question as the first one — it is that question made faster to
    // answer, not a different question.
    const shapes = [0, 1, 2].map((shape) => {
      const question = ask({ pick: draws(shape, 0) })!;
      return `${question.input}: ${question.prompt}`;
    });
    expect(new Set(shapes).size).toBe(3);
  });

  it('attaches no item id, since it asks about no item', () => {
    // The documented exception to `Question.itemId`, recorded here rather than
    // assumed. Progress records a miss against an item id and the pool
    // resurfaces exactly those ids for spaced repetition, so any id invented
    // here would push a non-item into that queue and keep resurfacing it.
    // Every shape, not just the default one: the rate is not an item in any of
    // them, and one shape quietly acquiring an id is how this would break.
    for (const shape of [0, 1, 2]) {
      expect(ask({ pick: draws(shape, 0) })!.itemId).toBeUndefined();
    }
  });

  describe('given no held rate', () => {
    it('asks nothing rather than drilling spot', () => {
      // The whole defence of this mode. Spot moves several times a day, so a
      // remembered spot rate is wrong by lunchtime — and the user would have
      // been told they were right.
      expect(ask({ held: null })).toBeNull();
    });
  });

  describe('given the held rate cannot reach the currency', () => {
    it('asks nothing', () => {
      // No GBP quote means no cross to carry the held ZEC leg over, and a
      // fabricated one is the confident wrong number this product must not make.
      expect(ask({ currency: 'GBP' })).toBeNull();
    });
  });

  describe('given a corrupted peg', () => {
    it('asks nothing', () => {
      // Infinity satisfies heldRateFor's `peg > 0` guard and comes straight
      // back out for the numeraire, so this is caught here or not at all.
      expect(ask({ held: { peg: Number.POSITIVE_INFINITY, pegged: 1_000 } })).toBeNull();
    });
  });

  describe('when asking how many ZEC a round amount is', () => {
    it('asks about a round amount, never an arbitrary one', () => {
      expect(ask()!.prompt).toBe('Roughly how many ZEC is 100 USD?');
      expect(ask()!.input).toBe('number');
    });

    it('scales the round amount to the currency', () => {
      // A hardcoded 100 would ask about 100 JPY, which is 0.013 ZEC — a figure
      // with no shape, that nobody can recall or check themselves against.
      const question = ask({
        rates: spot({ USD: 0.02, JPY: 0.00013 }),
        currency: 'jpy',
      })!;
      expect(question.prompt).toMatch(/10.?000 JPY/);
      expect(question.answer).toBeCloseTo(1.3, 9);
    });

    it('answers in ZEC at the held rate', () => {
      // 100 USD at 1 ZEC = 50 USD. Held, not spot: the feed here says otherwise.
      expect(ask({ rates: spot({ USD: 0.0195 }) })!.answer).toBeCloseTo(2, 9);
    });

    it('bands by the ZEC quantity', () => {
      expect(ask()!.band).toBe('large');
      expect(ask({ rates: spot({ USD: 0.5 }), held: { peg: 0.5, pegged: 1_000 } })!.band)
        .toBe('huge');
    });
  });

  describe('when asking what one ZEC is worth', () => {
    it("asks for a figure in the user's currency", () => {
      const question = ask({ pick: draws(1) })!;
      expect(question.prompt).toBe('Roughly how much is 1 ZEC worth, in USD?');
      expect(question.input).toBe('number');
      expect(question.choices).toBeUndefined();
    });

    it('answers with the fiat value of one ZEC', () => {
      expect(ask({ pick: draws(1) })!.answer).toBeCloseTo(50, 9);
    });

    it('bands by the one ZEC being valued, not the fiat figure', () => {
      // Banding the answer would file this under 'huge' beside a house deposit,
      // because 50 is a fiat figure and bandOf reads ZEC. The quantity actually
      // being reasoned about is one ZEC.
      expect(ask({ pick: draws(1) })!.band).toBe('large');
    });
  });

  describe('when offering four rates an order of magnitude apart', () => {
    it('offers four options, each ten times the one before', () => {
      const question = ask({ pick: draws(2, 1) })!;
      expect(question.input).toBe('choice');
      expect(question.choices!.map((choice) => choice.label)).toEqual([
        '≈0.2 ZEC',
        '≈2 ZEC',
        '≈20 ZEC',
        '≈200 ZEC',
      ]);
    });

    it('puts the right answer in the drawn slot', () => {
      // Fixed placement would teach the slot rather than the rate.
      for (const slot of [0, 1, 2, 3]) {
        const question = ask({ pick: draws(2, slot) })!;
        expect(question.correct).toBe(`opt-${slot}`);
        expect(question.choices![slot].label).toBe('≈2 ZEC');
      }
    });

    it('scores against the drawn option', () => {
      const question = ask({ pick: draws(2, 3) })!;
      expect(scoreAnswer(question, question.correct!)!.points).toBe(100);
      expect(scoreAnswer(question, 'opt-0')!.points).toBe(0);
      expect(question.answer).toBeCloseTo(2, 9);
      expect(question.band).toBe('large');
    });
  });

  describe('explaining the answer', () => {
    /** The shape whose explanation is nothing but the rate line. */
    const rateLine = (rates: Record<string, number>): string =>
      ask({ pick: draws(1), rates: spot(rates) })!.explain;

    it('states the held rate', () => {
      expect(rateLine({ USD: 0.02 })).toContain('The held rate is 1 ZEC ≈ 50 USD.');
      // And the other shapes carry it too, after their own answer.
      expect(ask()!.explain).toBe(
        '100 USD is 2.00 ZEC. The held rate is 1 ZEC ≈ 50 USD.'
          + ' Spot is in line with that right now.',
      );
    });

    it('says how far above the held rate spot sits', () => {
      // Spot at 0.019 ZEC per USD is FEWER ZEC per dollar, so ZEC costs more
      // than the held rate says. Echoing divergence's raw sign would print that
      // backwards, in the one mode whose whole subject is the number.
      expect(rateLine({ USD: 0.019 })).toContain('ZEC is trading about 5% above that right now.');
    });

    it('says how far below the held rate spot sits', () => {
      expect(rateLine({ USD: 0.021 })).toContain('ZEC is trading about 5% below that right now.');
    });

    it('reports no movement it cannot round to a whole percent', () => {
      // "0% above that" reads as a defect rather than as agreement.
      expect(rateLine({ USD: 0.02 })).toContain('Spot is in line with that right now.');
      expect(rateLine({ USD: 0.0201 })).toContain('Spot is in line with that right now.');
    });
  });
});
