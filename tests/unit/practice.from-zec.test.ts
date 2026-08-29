import { describe, expect, it } from 'vitest';
import { fromZec } from '../../src/lib/practice/modes/from-zec';
import {
  type AskContext,
  bandOf,
  type Picker,
  type PracticeItem,
} from '../../src/lib/practice/types';
import type { RatesData } from '../../src/lib/storage/rates';

// Spec: tests/trees/practice.from-zec.tree

const item = (id: string, amount: number, currency = 'USD'): PracticeItem => ({
  id,
  label: `a ${id}`,
  emoji: '🧪',
  amount,
  currency,
  category: 'home',
  source: 'catalogue',
});

const spot = (rates: Record<string, number>): RatesData => ({
  rates,
  updatedAt: 1_000,
  source: 'test',
});

/**
 * A picker with its answers written down in advance. The mode calls it several
 * times per question — once for the item, then once per distractor, then once
 * per shuffle step — so a queue is what lets a test aim at one branch and let
 * the rest fall to the first candidate.
 */
const picker = (...queue: number[]): Picker => () => queue.shift() ?? 0;

/** Four items an order of magnitude apart, the shape a fair question needs. */
const SPREAD = [item('coffee', 4), item('shirt', 40), item('phone', 400), item('car', 4000)];

const ask = (over: Partial<AskContext> = {}) =>
  fromZec.ask({
    items: SPREAD,
    rates: spot({ USD: 0.001 }),
    currency: 'USD',
    held: null,
    liabilities: [],
    pick: picker(),
    ...over,
  });

describe('fromZec.ask', () => {
  describe('given no items', () => {
    it('asks nothing', () => {
      // pick(0) has no index it could honestly return, so the emptiness has to
      // be caught before the picker rather than by trusting what it hands back.
      expect(ask({ items: [] })).toBeNull();
    });
  });

  describe('given a spot rate', () => {
    it('asks which of four things the amount buys', () => {
      const question = ask()!;
      expect(question.mode).toBe('from-zec');
      expect(question.input).toBe('choice');
      expect(question.choices).toHaveLength(4);
      expect(question.answer).toBeCloseTo(0.004, 12);
      // The prompt carries the ZEC figure and nothing that identifies the item:
      // the item's own emoji here would answer the question it is asking.
      expect(question.prompt).toBe('Which of these costs about 0.00400 ZEC?');
      expect(question.emoji).not.toBe(SPREAD[0].emoji);
    });

    it('marks the real item as the correct choice', () => {
      const question = ask()!;
      expect(question.correct).toBe('coffee');
      expect(question.choices!.map((choice) => choice.id)).toContain('coffee');
      expect(question.choices!.find((choice) => choice.id === 'coffee')!.label)
        .toBe('🧪 a coffee');
    });

    it('moves the answer out of first place', () => {
      // Unshuffled, the right answer is options[0] every single time and the
      // mode would train position rather than value. Every pick here is 0, so
      // an unshuffled build would leave 'coffee' first; it ends up last.
      const question = ask()!;
      expect(question.choices![0].id).not.toBe('coffee');
      expect(question.choices![3].id).toBe('coffee');
    });

    it('says what the thing costs in both units', () => {
      // Both units in one sentence is the pairing being taught. Either number
      // alone teaches nothing: the fiat price the user already knew, and the
      // ZEC figure was the question.
      expect(ask()!.explain).toBe('0.00400 ZEC is a coffee, about 4 USD at the displayed rate.');
    });

    it('records which item it asked about', () => {
      // The id the miss is filed under and the id the pool re-asks. A
      // distractor's id here would file the miss against something the user was
      // never shown as the answer, and the item they fumbled never returns.
      const question = ask()!;
      expect(question.itemId).toBe('coffee');
      expect(question.itemId).toBe(question.correct);
    });

    it('takes the band from the ZEC value', () => {
      const question = ask({ pick: picker(3) })!;
      expect(question.answer).toBeCloseTo(4, 12);
      expect(question.band).toBe(bandOf(4));
      expect(ask()!.band).toBe(bandOf(0.004));
    });
  });

  describe('given a held rate', () => {
    it('prices the question at the held rate', () => {
      // The held rate is the number on the user's pages. Practising against
      // spot would train a rate they are never shown.
      const question = ask({
        held: { peg: 0.002, pegged: 500 },
        rates: spot({ USD: 0.001 }),
      })!;
      expect(question.answer).toBeCloseTo(0.008, 12);
    });

    describe("given the held rate cannot cover the item's currency", () => {
      it('asks nothing', () => {
        // heldRateFor needs a live cross to carry the peg into another
        // currency; without one it returns null, which is worth exactly as
        // much as no rate at all.
        expect(
          ask({
            items: SPREAD.map((entry) => ({ ...entry, currency: 'EUR' })),
            held: { peg: 0.002, pegged: 500 },
            rates: spot({ USD: 0.001 }),
          }),
        ).toBeNull();
      });
    });
  });

  describe("given no rate for the item's currency", () => {
    it('asks nothing', () => {
      expect(ask({ rates: spot({ EUR: 0.002 }) })).toBeNull();
    });
  });

  describe('given a garbage rate', () => {
    it('asks nothing', () => {
      // A wrong price is worse than no price, and every one of these would
      // render as a confident number.
      for (const bad of [0, -0.001, Number.NaN]) {
        expect(ask({ rates: spot({ USD: bad }) })).toBeNull();
      }
    });
  });

  describe('given an item priced at nothing', () => {
    it('asks nothing', () => {
      // "Which of these costs 0 ZEC" has no honest answer even with a perfect
      // rate, and a free tier in the catalogue is enough to reach it.
      expect(ask({ items: [item('free', 0), ...SPREAD] })).toBeNull();
    });
  });

  describe('given items priced in different currencies', () => {
    it('prices the item in its own currency', () => {
      // A pool mixes sources, so the item's currency is not always the one the
      // user thinks in. Pricing this EUR item at the USD rate would be wrong by
      // the whole cross, silently.
      const question = ask({
        items: [item('metro', 20, 'EUR'), ...SPREAD],
        rates: spot({ USD: 0.001, EUR: 0.002 }),
      })!;
      expect(question.correct).toBe('metro');
      expect(question.answer).toBeCloseTo(0.04, 12);
    });

    it('leaves out an item whose currency has no rate', () => {
      // An unpriceable item cannot be shown to sit a fair distance from the
      // answer, so it cannot be offered as a distractor.
      const question = ask({
        items: [...SPREAD, item('pint', 5, 'GBP')],
        rates: spot({ USD: 0.001 }),
      })!;
      expect(question.choices!.map((choice) => choice.id)).not.toContain('pint');
      expect(question.choices).toHaveLength(4);
    });
  });

  describe('given a second entry for the same thing', () => {
    it('offers the thing once', () => {
      // The same coffee can arrive from the catalogue and from a page the user
      // visited. Offering both makes a correct answer scoreable as wrong,
      // because scoring compares ids.
      const question = ask({
        items: [
          SPREAD[0],
          { ...item('coffee', 5000), label: 'a second coffee' },
          ...SPREAD.slice(1),
        ],
      })!;
      const ids = question.choices!.map((choice) => choice.id);
      expect(ids.filter((id) => id === 'coffee')).toHaveLength(1);
      expect(question.choices!.map((choice) => choice.label)).not.toContain('a second coffee');
    });
  });

  describe('given too few items to fill four options', () => {
    it('asks nothing', () => {
      expect(ask({ items: [item('coffee', 4), item('car', 4000)] })).toBeNull();
    });
  });

  describe('given a pool clustered inside the narrow separation', () => {
    it('asks nothing', () => {
      // Four prices within a whisker of each other make the question a raffle
      // ticket: nothing about ZEC judgement decides it.
      expect(
        ask({ items: [item('a', 4), item('b', 5), item('c', 6), item('d', 7)] }),
      ).toBeNull();
    });
  });

  describe('given a pool spanning orders of magnitude', () => {
    it('separates every option by an order of magnitude', () => {
      // 'near' sits 12x from the answer and would pass a test against the
      // answer alone, but only 1.25x from the shirt already taken — two options
      // in the same mental bucket, which is what makes a four-way a coin flip.
      const question = ask({ items: [...SPREAD, item('near', 50)] })!;
      expect(question.choices!.map((choice) => choice.id).sort())
        .toEqual(['car', 'coffee', 'phone', 'shirt']);
    });
  });

  describe('given a pool too tight for an order of magnitude', () => {
    it('falls back to the narrower separation', () => {
      // Insisting on 10x here would silence the mode: no three of these clear
      // it against each other. 3x still leaves every option in a different
      // bucket, which is the property that matters.
      const question = ask({
        items: [item('coffee', 4), item('book', 12), item('shirt', 40), item('shoes', 130)],
      })!;
      expect(question.choices!.map((choice) => choice.id).sort())
        .toEqual(['book', 'coffee', 'shirt', 'shoes']);
    });
  });

  describe('given the picker strands the search', () => {
    // 3/9/27 is a valid set at the narrower separation; 4 is not part of any.
    // Taking 4 first leaves nothing that clears it, which is the dead end the
    // greedy search is allowed to walk into.
    const tricky = [item('unit', 1000), item('three', 3000), item('nine', 9000)];
    const strandable = [...tricky, item('twentyseven', 27_000), item('four', 4000)];
    // One pick for the item, one spent by the failed order-of-magnitude pass,
    // then the narrow pass's first choice.
    const stranding = () => picker(0, 0, 3);

    it('asks nothing rather than backtracking', () => {
      // Backtracking would buy one extra question at the cost of a search whose
      // runtime the caller cannot predict. A skipped question is cheaper.
      expect(ask({ items: strandable, pick: stranding() })).toBeNull();
    });

    it('would have found a set from another starting point', () => {
      // Same pool, first candidate instead of the fourth: proof the null above
      // is the greedy walk dead-ending, not an unsolvable pool.
      const question = ask({ items: strandable, pick: picker(0, 0, 0) })!;
      expect(question.choices!.map((choice) => choice.id).sort())
        .toEqual(['nine', 'three', 'twentyseven', 'unit']);
    });
  });
});
