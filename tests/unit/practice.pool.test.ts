import { describe, expect, it } from 'vitest';
import type { Anchor } from '../../src/lib/anchors';
import type { Liability } from '../../src/lib/liabilities';
import { buildPool, chooseItem, MAX_RECENT, type PoolSources } from '../../src/lib/practice/pool';
import type { ItemSource, Picker, PracticeItem } from '../../src/lib/practice/types';

// Spec: tests/trees/practice.pool.tree

const item = (id: string, amount = 4, source: ItemSource = 'catalogue'): PracticeItem => ({
  id,
  label: id,
  emoji: '🧪',
  amount,
  currency: 'USD',
  category: 'food',
  source,
});

const anchor = (id: string, over: Partial<Anchor> = {}): Anchor => ({
  id,
  label: 'coffees',
  amount: 5,
  currency: 'USD',
  zecWhenSet: 0.00625,
  ...over,
});

const liability = (id: string, over: Partial<Liability> = {}): Liability => ({
  id,
  label: 'rent',
  amount: 1800,
  currency: 'USD',
  cadence: 'monthly',
  direction: 'out',
  zecWhenSet: 2.25,
  addedAt: 0,
  ...over,
});

const sources = (over: Partial<PoolSources> = {}): PoolSources => ({
  catalogue: [],
  anchors: [],
  liabilities: [],
  seen: [],
  ...over,
});

/** A picker that always lands on the same index, so a draw is a fact. */
const always = (index: number): Picker => () => index;

const ids = (pool: PracticeItem[]): string[] => pool.map((entry) => entry.id);

describe('buildPool', () => {
  it("puts the user's own prices ahead of the catalogue", () => {
    const pool = buildPool(sources({
      catalogue: [item('c1')],
      anchors: [anchor('a1')],
      liabilities: [liability('l1')],
      seen: [item('s1', 9, 'seen')],
    }));

    // A price you actually pay is worth more practice than a generic one, and
    // anything that truncates the pool has to truncate the generic end.
    expect(ids(pool)).toEqual(['anchor:a1', 'liability:l1', 's1', 'c1']);
  });

  it('keeps each source in the order it was given', () => {
    const pool = buildPool(sources({
      catalogue: [item('c1'), item('c2'), item('c3')],
      anchors: [anchor('a1'), anchor('a2')],
    }));

    expect(ids(pool)).toEqual(['anchor:a1', 'anchor:a2', 'c1', 'c2', 'c3']);
  });

  describe('given an anchor', () => {
    it("becomes an item priced in the anchor's own currency", () => {
      const [entry] = buildPool(sources({
        anchors: [anchor('a1', { label: 'a flat white', amount: 4.5, currency: 'EUR' })],
      }));

      // The amount is copied, never converted: the anchor is denominated in the
      // currency the user thinks about it in, and a mode applies the rate.
      expect(entry).toMatchObject({
        label: 'a flat white',
        amount: 4.5,
        currency: 'EUR',
        source: 'anchor',
      });
    });

    it('namespaces the id away from the catalogue', () => {
      // Catalogue ids are hand-written words, so an anchor id of 'coffee' is a
      // real collision — and a collision would drop the user's own item.
      const pool = buildPool(sources({
        catalogue: [item('coffee')],
        anchors: [anchor('coffee')],
      }));

      expect(ids(pool)).toEqual(['anchor:coffee', 'coffee']);
    });

    it('upper-cases the currency', () => {
      // Rates are keyed upper-case; a lower-case record would look unquoted and
      // silently produce no question at all.
      const [entry] = buildPool(sources({ anchors: [anchor('a1', { currency: 'eur' })] }));

      expect(entry.currency).toBe('EUR');
    });
  });

  describe('given a liability', () => {
    it('says the cadence aloud in the label', () => {
      const pool = buildPool(sources({
        liabilities: [
          liability('l1', { cadence: 'monthly' }),
          liability('l2', { cadence: 'weekly' }),
          liability('l3', { cadence: 'yearly' }),
        ],
      }));

      // The amount is one period's worth. Asking "rent" against a weekly figure
      // is a 4x error with nothing on screen to give it away.
      expect(pool.map((entry) => entry.label)).toEqual([
        'a month of rent',
        'a week of rent',
        'a year of rent',
      ]);
    });

    it('marks money coming in differently from money going out', () => {
      const pool = buildPool(sources({
        liabilities: [
          liability('l1', { direction: 'out' }),
          liability('l2', { label: 'salary', direction: 'in' }),
        ],
      }));

      expect(pool[0].emoji).not.toBe(pool[1].emoji);
      expect(pool[1].label).toBe('a month of salary');
    });

    it('namespaces the id away from the catalogue', () => {
      const pool = buildPool(sources({
        catalogue: [item('rent')],
        liabilities: [liability('rent')],
      }));

      expect(ids(pool)).toEqual(['liability:rent', 'rent']);
    });
  });

  describe('given an amount that cannot become a question', () => {
    it('drops an anchor with no positive amount', () => {
      // Both score as null, which reaches the user as a question with no
      // answerable value — worse than one item fewer to practise.
      expect(buildPool(sources({ anchors: [anchor('a1', { amount: 0 })] }))).toEqual([]);
      expect(buildPool(sources({ anchors: [anchor('a1', { amount: -5 })] }))).toEqual([]);
    });

    it('drops a liability with no positive amount', () => {
      expect(buildPool(sources({ liabilities: [liability('l1', { amount: 0 })] }))).toEqual([]);
    });

    it('drops an amount that is not a number', () => {
      expect(buildPool(sources({ catalogue: [item('c1', Number.NaN)] }))).toEqual([]);
    });

    it('drops an amount that is not finite', () => {
      // The one case a positivity check alone lets through.
      expect(buildPool(sources({ catalogue: [item('c1', Number.POSITIVE_INFINITY)] }))).toEqual([]);
    });
  });

  describe('given the same id twice', () => {
    it('keeps the first occurrence', () => {
      const pool = buildPool(sources({ catalogue: [item('c1', 4), item('c1', 9)] }));

      expect(pool).toHaveLength(1);
      expect(pool[0].amount).toBe(4);
    });

    it('keeps a seen price over the catalogue copy', () => {
      const pool = buildPool(sources({
        catalogue: [item('c1', 4)],
        seen: [item('c1', 7, 'seen')],
      }));

      // A price the user actually met beats the typical price of the same thing.
      expect(pool).toHaveLength(1);
      expect(pool[0]).toMatchObject({ amount: 7, source: 'seen' });
    });

    it('lets a usable copy in after an unusable one', () => {
      // A broken record must not reserve the id and shadow the good copy behind
      // it, or one corrupt entry silently deletes an item from practice.
      const pool = buildPool(sources({ catalogue: [item('c1', 0), item('c1', 4)] }));

      expect(pool).toHaveLength(1);
      expect(pool[0].amount).toBe(4);
    });
  });

  describe('given nothing at all', () => {
    it('returns an empty pool', () => {
      expect(buildPool(sources())).toEqual([]);
    });
  });
});

describe('chooseItem', () => {
  const pool = [item('a'), item('b'), item('c')];

  it('returns an item from the pool', () => {
    const chosen = chooseItem(pool, { pick: always(0), recent: [], due: [] });

    expect(chosen?.id).toBe('a');
  });

  it('avoids the ids asked recently', () => {
    const chosen = chooseItem([...pool, item('d')], {
      pick: always(0),
      recent: ['a', 'b', 'c'],
      due: [],
    });

    // The bug this replaces: eleven items, one excluded, a repeat every third
    // or fourth question. Recognising an answer is not recalling it.
    expect(chosen?.id).toBe('d');
  });

  it('honours only the last MAX_RECENT ids', () => {
    const long = Array.from({ length: MAX_RECENT + 2 }, (_, index) => item(`i${index}`));
    // One more than the window: the oldest id falls out and is askable again.
    const recent = long.slice(0, MAX_RECENT + 1).map((entry) => entry.id);

    const chosen = chooseItem(long, { pick: always(0), recent, due: [] });

    // Without the window a full session history would exclude everything and
    // collapse into the fallback, restoring the repetition it exists to stop.
    expect(chosen?.id).toBe('i0');
  });

  describe('given items the user got wrong', () => {
    it('gives them extra draws', () => {
      let bound = 0;
      const chosen = chooseItem(pool, {
        pick: (upperExclusive) => {
          bound = upperExclusive;
          return 3;
        },
        recent: [],
        due: ['c'],
      });

      // Three tickets for the due item on top of one each for the others: a
      // question you nailed teaches nothing the second time.
      expect(bound).toBe(5);
      expect(chosen?.id).toBe('c');
    });

    it('still reaches the items they got right', () => {
      const chosen = chooseItem(pool, { pick: always(0), recent: [], due: ['c'] });

      // Preferred, never exclusive. Practising only your weak spots never
      // re-confirms the rest, which then decays unnoticed.
      expect(chosen?.id).toBe('a');
    });
  });

  describe('given nothing is due', () => {
    it('draws from the whole pool once each', () => {
      let bound = 0;
      chooseItem(pool, {
        pick: (upperExclusive) => {
          bound = upperExclusive;
          return 0;
        },
        recent: [],
        due: [],
      });

      expect(bound).toBe(pool.length);
    });
  });

  describe('given avoiding the recent ids would leave nothing', () => {
    it('falls back to the whole pool', () => {
      const chosen = chooseItem(pool, { pick: always(1), recent: ['a', 'b', 'c'], due: [] });

      // A user with three items must still get questions; refusing to ask is
      // indistinguishable from a broken page.
      expect(chosen?.id).toBe('b');
    });
  });

  describe('given a picker that answers out of range', () => {
    it('still answers for an index past the end', () => {
      // The picker is injected, so its arithmetic is somebody else's. An index
      // past the end would otherwise render as a blank question.
      expect(chooseItem(pool, { pick: always(99), recent: [], due: [] })?.id).toBe('c');
    });

    it('still answers for a negative index', () => {
      expect(chooseItem(pool, { pick: always(-1), recent: [], due: [] })?.id).toBe('a');
    });

    it('still answers for a fractional index', () => {
      expect(chooseItem(pool, { pick: always(1.9), recent: [], due: [] })?.id).toBe('b');
    });
  });

  describe('given an empty pool', () => {
    it('returns null', () => {
      // The only null. Everything else awkward still yields a question.
      expect(chooseItem([], { pick: always(0), recent: [], due: [] })).toBeNull();
    });
  });
});
