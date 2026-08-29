import { describe, expect, it } from 'vitest';
import { toZec } from '../../src/lib/practice/modes/to-zec';
import type { AskContext, Picker, PracticeItem } from '../../src/lib/practice/types';
import type { HeldRate } from '../../src/lib/rates/held';
import type { RatesData } from '../../src/lib/storage/rates';

// Spec: tests/trees/practice.to-zec.tree

const rates: RatesData = {
  rates: { USD: 0.0025, EUR: 0.005 },
  updatedAt: 1,
  source: 'test',
};

function item(over: Partial<PracticeItem> = {}): PracticeItem {
  return {
    id: 'coffee',
    label: 'a coffee',
    emoji: '☕',
    amount: 4,
    currency: 'USD',
    category: 'drink',
    source: 'catalogue',
    ...over,
  };
}

/**
 * A picker handing out a fixed sequence, so every branch that depends on a
 * draw is reachable — the reason `pick` is injected in the first place.
 *
 * A draw at or above the bound would index past the pool and hand the mode an
 * undefined item, which would surface as an unrelated crash somewhere below.
 * Fail on it here, where the cause is still visible.
 */
function draws(...queue: number[]): Picker {
  let next = 0;
  return (upperExclusive) => {
    const value = queue[next++] ?? 0;
    expect(value).toBeLessThan(upperExclusive);
    return value;
  };
}

function context(over: Partial<AskContext> = {}): AskContext {
  return {
    items: [item()],
    rates,
    currency: 'USD',
    held: null,
    liabilities: [],
    // Draw the first item, then lose the coin flip: the shown-price shape.
    pick: draws(0, 0),
    ...over,
  };
}

/**
 * The expected fiat rendering, recomputed rather than written out as "$4.00".
 * A hardcoded string pins the suite to whichever locale the machine running it
 * happens to have, and the mode deliberately follows the runtime's.
 */
function fiat(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
}

describe('toZec', () => {
  it('announces itself to the picker with an id, a title and a blurb', () => {
    expect(toZec.id).toBe('to-zec');
    expect(toZec.title).toMatch(/\S/);
    expect(toZec.blurb).toMatch(/\S/);
  });

  it('says which item it asked about, so a miss can be re-asked', () => {
    // Spaced repetition keys on this id. Without it a wrong answer is recorded
    // against nothing and the item never comes back around.
    const items = [item({ id: 'rent' }), item({ id: 'laptop' })];

    expect(toZec.ask(context({ items, pick: draws(1, 0) }))!.itemId).toBe('laptop');
  });

  describe('given a price the user could recall unaided', () => {
    it('can show the price, leaving the mapping as the only unknown', () => {
      const question = toZec.ask(context({ pick: draws(0, 0) }));

      expect(question!.prompt).toBe(`a coffee — ${fiat(4, 'USD')}. How many ZEC?`);
      expect(question!.emoji).toBe('☕');
      expect(question!.input).toBe('number');
      // A number question carries no choices and no correct id; a UI that saw
      // either would render radio buttons for a free-text answer.
      expect(question!.choices).toBeUndefined();
      expect(question!.correct).toBeUndefined();
    });

    it('can withhold the price, which is the skill being trained', () => {
      // Catalogue, anchor and liability prices are all ones the user can
      // produce from memory: a typical price, one they chose, one they pay.
      for (const source of ['catalogue', 'anchor', 'liability'] as const) {
        const question = toZec.ask(
          context({ items: [item({ source })], pick: draws(0, 1) }),
        );

        expect(question!.prompt).toBe('a coffee. How many ZEC?');
        // The whole point of the shape: the figure to be recalled is absent.
        expect(question!.prompt).not.toContain(fiat(4, 'USD'));
      }
    });

    it("answers with the item's value in ZEC either way", () => {
      // Same question underneath — only the crutch differs, so the answer the
      // user is scored against must not move with the shape.
      expect(toZec.ask(context({ pick: draws(0, 0) }))!.answer).toBeCloseTo(0.01, 12);
      expect(toZec.ask(context({ pick: draws(0, 1) }))!.answer).toBeCloseTo(0.01, 12);
    });
  });

  describe('given a price the user merely walked past', () => {
    it('always shows the price, because nobody could recall it', () => {
      // The draw that would withhold the price for a catalogue item. A `seen`
      // price is one specific figure on one page; asking for it back would
      // score a missing fact as ignorance.
      const question = toZec.ask(
        context({ items: [item({ source: 'seen', amount: 47.31 })], pick: draws(0, 1) }),
      );

      expect(question!.prompt).toBe(`a coffee — ${fiat(47.31, 'USD')}. How many ZEC?`);
    });
  });

  describe("given items in a currency other than the user's", () => {
    it('prices each item in its own currency', () => {
      // Converting a EUR price at the USD rate is a confidently wrong number,
      // which is worse than no question at all.
      const question = toZec.ask(
        context({ items: [item({ currency: 'EUR' })], currency: 'USD' }),
      );

      expect(question!.answer).toBeCloseTo(0.02, 12);
      expect(question!.prompt).toContain(fiat(4, 'EUR'));
      expect(question!.prompt).not.toContain(fiat(4, 'USD'));
    });
  });

  describe('when the currency is written in lower case', () => {
    it('still finds the rate', () => {
      const question = toZec.ask(context({ items: [item({ currency: 'usd' })] }));

      expect(question!.answer).toBeCloseTo(0.01, 12);
      expect(question!.prompt).toContain(fiat(4, 'USD'));
    });
  });

  describe('given a held rate', () => {
    it('asks at the rate the pages are showing', () => {
      // The user is learning the number on the page, not the number on an
      // exchange; scoring them against spot would mark that learning wrong.
      const held: HeldRate = { peg: 0.005, pegged: 1 };

      expect(toZec.ask(context({ held }))!.answer).toBeCloseTo(0.02, 12);
    });
  });

  describe('given a held rate that cannot cover the currency', () => {
    it('asks nothing', () => {
      const held: HeldRate = { peg: 0.005, pegged: 1 };
      const question = toZec.ask(
        context({ items: [item({ currency: 'GBP' })], held }),
      );

      expect(question).toBeNull();
    });
  });

  describe('given no rate for the currency', () => {
    it('asks nothing', () => {
      expect(toZec.ask(context({ items: [item({ currency: 'GBP' })] }))).toBeNull();
    });
  });

  describe('given a rate that is not a positive number', () => {
    it('asks nothing', () => {
      for (const bad of [0, -0.0025, NaN]) {
        const broken: RatesData = { ...rates, rates: { USD: bad } };

        expect(toZec.ask(context({ rates: broken }))).toBeNull();
      }
    });
  });

  describe('given an item carrying no real price', () => {
    it('never draws it', () => {
      // Zero and NaN both answer zero ZEC, which scoreGuess refuses — the
      // question would be unscoreable rather than hard. Draw 0 lands on the
      // first survivor, proving the bad entries left the pool rather than
      // merely being tolerated.
      const items = [item({ id: 'free', amount: 0 }), item({ id: 'junk', amount: NaN }), item()];
      const question = toZec.ask(context({ items, pick: draws(0, 0) }));

      expect(question!.answer).toBeCloseTo(0.01, 12);
    });
  });

  describe('given nothing to ask about', () => {
    it('asks nothing', () => {
      const pick: Picker = () => {
        throw new Error('drew from an empty pool');
      };

      expect(toZec.ask(context({ items: [], pick }))).toBeNull();
    });
  });

  it('explains the answer in both units', () => {
    // Both units, or the explanation teaches only that the number was wrong.
    const question = toZec.ask(context({ pick: draws(0, 1) }));

    expect(question!.explain).toContain(fiat(4, 'USD'));
    expect(question!.explain).toContain('ZEC');
    expect(question!.explain).toContain('a coffee');
  });

  it('bands the answer by magnitude', () => {
    // Progress is tracked per band, so a misbanded question credits practice
    // on coffees to the user's record on rent.
    const at = (rate: number) =>
      toZec.ask(context({ rates: { ...rates, rates: { USD: rate } } }))!.band;

    expect(at(0.001)).toBe('tiny');
    expect(at(0.0025)).toBe('small');
    expect(at(0.05)).toBe('everyday');
    expect(at(0.5)).toBe('large');
    expect(at(5)).toBe('huge');
  });
});
