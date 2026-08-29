import { describe, expect, it } from 'vitest';
import { judgement } from '../../src/lib/practice/modes/judgement';
import type { AskContext, Picker, PracticeItem } from '../../src/lib/practice/types';

// Spec: tests/trees/practice.judgement.tree

const item = (over: Partial<PracticeItem> = {}): PracticeItem => ({
  id: 'coffee',
  label: 'a coffee',
  emoji: '☕',
  amount: 4,
  currency: 'USD',
  category: 'drink',
  source: 'catalogue',
  ...over,
});

/**
 * A scripted picker, recording the bounds it was asked for. The bounds are the
 * interesting half: they say which pool the mode actually drew from, which is
 * how the filtering tests below prove an unpriceable item was dropped rather
 * than merely unlucky.
 */
function picker(values: number[], calls: number[] = []): Picker {
  let next = 0;
  return (upperExclusive) => {
    calls.push(upperExclusive);
    return values[next++] ?? 0;
  };
}

// 4 USD at 0.0125 ZEC/USD is 0.05 ZEC — small enough to land in a different
// band from its own doubled offer, which the banding test relies on.
const context = (over: Partial<AskContext> = {}): AskContext => ({
  items: [item()],
  rates: { rates: { USD: 0.0125 }, updatedAt: 0, source: 'test' },
  currency: 'USD',
  held: null,
  liabilities: [],
  pick: picker([0]),
  ...over,
});

describe('ask', () => {
  describe("given no rate for the item's currency", () => {
    it('asks nothing rather than inventing a price', () => {
      const question = judgement.ask(
        context({ rates: { rates: { EUR: 0.02 }, updatedAt: 0, source: 'test' } }),
      );
      expect(question).toBeNull();
    });
  });

  describe('given a held rate that cannot cover the currency', () => {
    it('asks nothing', () => {
      // The held rate carries USD; without a USD spot quote there is no cross
      // to carry it on, so heldRateFor returns null and the mode must stop.
      const question = judgement.ask(context({
        held: { peg: 0.001, pegged: 0 },
        rates: { rates: { EUR: 0.02 }, updatedAt: 0, source: 'test' },
      }));
      expect(question).toBeNull();
    });
  });

  describe('given no items', () => {
    it('asks nothing', () => {
      expect(judgement.ask(context({ items: [] }))).toBeNull();
    });
  });

  describe('given an item that costs nothing', () => {
    it('leaves out an item no offer can be wrong about', () => {
      // Half of nothing and twice nothing are both nothing, so a free item has
      // no cheap or steep — it would present three identical prices.
      const calls: number[] = [];
      const question = judgement.ask(context({
        items: [item({ id: 'free', label: 'a free sample', amount: 0 }), item()],
        pick: picker([0, 1], calls),
      }));
      expect(question!.prompt).toContain('A coffee');
      expect(calls[0]).toBe(1);
    });
  });

  describe('given a mixed-currency pool', () => {
    it('keeps only the items it can price', () => {
      const calls: number[] = [];
      const question = judgement.ask(context({
        items: [item({ id: 'ramen', label: 'ramen', currency: 'JPY', amount: 900 }), item()],
        pick: picker([0, 1], calls),
      }));
      expect(question!.prompt).toContain('A coffee');
      expect(calls[0]).toBe(1);
    });
  });

  describe('given a held rate', () => {
    it('prices at the held rate rather than spot', () => {
      // Pricing at spot while the rest of the extension shows held would train
      // the user against a rate they never see.
      const question = judgement.ask(context({ held: { peg: 0.001, pegged: 0 } }));
      expect(question!.answer).toBeCloseTo(0.004, 12);
    });
  });

  describe('given no held rate', () => {
    it('prices at spot', () => {
      expect(judgement.ask(context())!.answer).toBeCloseTo(0.05, 12);
    });
  });

  describe('when the true price is offered', () => {
    it('marks about right as correct', () => {
      const question = judgement.ask(context({ pick: picker([0, 1]) }))!;
      expect(question.prompt).toBe('A coffee is 0.0500 ZEC. Cheap, about right, or steep?');
      expect(question.correct).toBe('right');
    });
  });

  describe('when a bargain is offered', () => {
    it('halves the real price and marks cheap as correct', () => {
      const question = judgement.ask(context({ pick: picker([0, 0]) }))!;
      expect(question.prompt).toBe('A coffee is 0.0250 ZEC. Cheap, about right, or steep?');
      expect(question.correct).toBe('cheap');
      // The margin, asserted as a number: half is far enough outside a good
      // estimator's own error that a right answer is actually available.
      expect(question.answer).toBeCloseTo(0.05, 12);
    });
  });

  describe('when an overcharge is offered', () => {
    it('doubles the real price and marks steep as correct', () => {
      const question = judgement.ask(context({ pick: picker([0, 2]) }))!;
      expect(question.prompt).toBe('A coffee is 0.100 ZEC. Cheap, about right, or steep?');
      expect(question.correct).toBe('steep');
      expect(question.answer).toBeCloseTo(0.05, 12);
    });
  });

  it('keeps fiat out of the prompt', () => {
    // The whole mode rests on this: with the fiat price on screen the question
    // is arithmetic, and arithmetic is the crutch being removed.
    const question = judgement.ask(context({
      items: [item({ label: 'a wireless mouse', amount: 77 })],
      pick: picker([0, 1]),
    }))!;
    expect(question.prompt).not.toMatch(/77|USD|\$/);
    expect(question.prompt).toContain('ZEC');
    expect(question.input).toBe('choice');
    expect(question.emoji).toBe('☕');
  });

  it('says which item it asked about', () => {
    // Spaced repetition re-asks the ids that were missed; an unattributed miss
    // is one the pool can never resurface.
    const question = judgement.ask(context({
      items: [item(), item({ id: 'book', label: 'a paperback', emoji: '📕', amount: 12 })],
      pick: picker([1, 0]),
    }))!;
    expect(question.itemId).toBe('book');
  });

  it('offers exactly the three judgements, freshly each time', () => {
    const first = judgement.ask(context())!;
    const second = judgement.ask(context())!;
    expect(first.choices).toEqual([
      { id: 'cheap', label: 'Cheap' },
      { id: 'right', label: 'About right' },
      { id: 'steep', label: 'Steep' },
    ]);
    // A UI that sorts or shuffles what it is handed must not be able to reach
    // the shared constant behind every later question.
    expect(first.choices).not.toBe(second.choices);
  });

  it('names the real price in both units afterwards', () => {
    const question = judgement.ask(context({ pick: picker([0, 0]) }))!;
    expect(question.explain).toBe(
      'A coffee is about 4 USD — 0.0500 ZEC at this rate. The offer of 0.0250 ZEC is cheap.',
    );
  });

  it('bands by the real price rather than the offer', () => {
    // 0.05 ZEC is 'small'; the doubled offer of 0.1 would read as 'everyday'.
    // Banding by the offer would file a coffee under the wrong magnitude a
    // third of the time and make per-band progress meaningless.
    expect(judgement.ask(context({ pick: picker([0, 2]) }))!.band).toBe('small');
  });

  it('picks the item first and the offer second', () => {
    const calls: number[] = [];
    const question = judgement.ask(context({
      items: [item(), item({ id: 'book', label: 'a paperback', emoji: '📕', amount: 12 })],
      pick: picker([1, 2], calls),
    }))!;
    expect(calls).toEqual([2, 3]);
    expect(question.emoji).toBe('📕');
    expect(question.correct).toBe('steep');
  });
});

describe('identity', () => {
  it('is the judgement mode', () => {
    expect(judgement.id).toBe('judgement');
    expect(judgement.title).toBe('Cheap or steep?');
    expect(judgement.blurb).toBe('Judge a ZEC price with no fiat to translate from.');
  });
});
