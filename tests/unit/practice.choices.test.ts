import { describe, expect, it } from 'vitest';
import { labelledChoices, numericChoices, shuffle } from '../../src/lib/practice/choices';
import type { Picker } from '../../src/lib/practice/types';

// Spec: tests/trees/practice.choices.tree

/** Always the first slot: a shuffle that provably moves everything. */
const zero: Picker = () => 0;

/** Always the current slot: the identity shuffle, so ordering stays readable. */
const last: Picker = (upperExclusive) => upperExclusive - 1;

/** A scripted picker, for driving the clamp with values no sane picker returns. */
const feed = (...values: number[]): Picker => {
  let next = 0;
  return () => values[next++];
};

const texts = (set: { choices: Array<{ label: string }> }): string[] =>
  set.choices.map((choice) => choice.label);

/** The label the correct id points at — what the user actually has to pick. */
const answerText = (set: { choices: Array<{ id: string; label: string }>; correct: string }) =>
  set.choices.find((choice) => choice.id === set.correct)?.label;

describe('shuffle', () => {
  it('moves items with a picker that says so', () => {
    // i=2 swaps slot 2 with slot 0, then i=1 swaps slot 1 with slot 0.
    expect(shuffle([1, 2, 3], zero)).toEqual([2, 3, 1]);
  });

  it('keeps every item exactly once', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const out = shuffle(items, feed(3, 0, 7, 2, 4, 1, 0, 2, 1));
    expect([...out].sort((a, b) => a - b)).toEqual(items);
  });

  it('leaves the input untouched', () => {
    // The caller's array is often the pool a mode is still drawing from; a
    // shuffle in place would quietly reorder it under them.
    const items = ['a', 'b', 'c'];
    shuffle(items, zero);
    expect(items).toEqual(['a', 'b', 'c']);
  });

  describe('given a single item', () => {
    it('returns it unchanged', () => {
      expect(shuffle([7], zero)).toEqual([7]);
    });
  });

  describe('given an empty list', () => {
    it('returns an empty list', () => {
      expect(shuffle([], zero)).toEqual([]);
    });
  });

  describe('given a picker that returns nonsense', () => {
    it('never drops an item', () => {
      // NaN, a negative, past the end, and a fraction. Each would index off the
      // array and swap in `undefined`, which renders as a blank button rather
      // than throwing — a broken question nobody notices.
      const out = shuffle(['a', 'b', 'c', 'd', 'e'], feed(Number.NaN, -5, 99, 1.7));
      expect(out).toHaveLength(5);
      expect([...out].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    });
  });
});

describe('numericChoices', () => {
  it('returns the requested number of options', () => {
    expect(numericChoices(0.5, { pick: zero, count: 3 }).choices).toHaveLength(3);
    expect(numericChoices(0.5, { pick: zero }).choices).toHaveLength(4);
  });

  it('includes the truth exactly once', () => {
    const set = numericChoices(0.5, { pick: zero });
    expect(texts(set).filter((label) => label === '0.5')).toEqual(['0.5']);
    expect(answerText(set)).toBe('0.5');
  });

  it('spaces distractors multiplicatively', () => {
    // The point of the module: every neighbour is a factor of ten away, so the
    // question asks which magnitude is right rather than which arithmetic is.
    const values = texts(numericChoices(0.5, { pick: zero })).map(Number).sort((a, b) => a - b);
    expect(values).toEqual([0.05, 0.5, 5, 50]);
  });

  it('never renders two options identically', () => {
    // Two options reading the same is one option, and if the truth is one of
    // them the user picks the right words and is marked wrong.
    for (const truth of [0.004, 0.5, 7, 1234.5]) {
      const labels = texts(numericChoices(truth, { pick: last, count: 5 }));
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it('never offers a zero or negative option', () => {
    for (const truth of [0.004, 0.5, 7, 1234.5]) {
      for (const label of texts(numericChoices(truth, { pick: zero, count: 6 }))) {
        expect(Number(label)).toBeGreaterThan(0);
      }
    }
  });

  it('puts the correct answer in different slots for different draws', () => {
    // If the answer sits in the same slot every time, users learn the slot and
    // score well having learned nothing about the unit.
    expect(numericChoices(0.5, { pick: zero }).correct).toBe('c3');
    expect(numericChoices(0.5, { pick: last }).correct).toBe('c0');
  });

  it('numbers ids by final position', () => {
    // Assigned after the shuffle, so the inspector does not give the answer
    // away the way a generation-order id would.
    expect(numericChoices(0.5, { pick: zero }).choices.map((choice) => choice.id))
      .toEqual(['c0', 'c1', 'c2', 'c3']);
  });

  describe('when a format is given', () => {
    it('renders every option through it', () => {
      const set = numericChoices(0.5, {
        pick: zero,
        format: (value) => `${value.toFixed(2)} ZEC`,
      });
      expect(texts(set)).toEqual(['5.00 ZEC', '0.05 ZEC', '50.00 ZEC', '0.50 ZEC']);
      expect(answerText(set)).toBe('0.50 ZEC');
    });
  });

  describe('when a spread is given', () => {
    it('steps by that factor instead', () => {
      const values = texts(numericChoices(1, { pick: zero, spread: 4 }))
        .map(Number)
        .sort((a, b) => a - b);
      expect(values).toEqual([0.25, 1, 4, 16]);
    });
  });

  describe('given a nonsense spread', () => {
    it('falls back to the default step', () => {
      // A step of one or less generates the truth again or lands on the wrong
      // side of it; either way the offsets stop being offsets.
      const expected = ['5', '0.05', '50', '0.5'];
      expect(texts(numericChoices(0.5, { pick: zero, spread: 1 }))).toEqual(expected);
      expect(texts(numericChoices(0.5, { pick: zero, spread: Number.NaN }))).toEqual(expected);
    });
  });

  describe('given the draw picks the other direction first', () => {
    it('offers the smaller distractor first', () => {
      // With "up" always first the truth is forever the second-smallest on
      // screen, so sorting by eye beats knowing the unit. `last` draws down.
      expect(texts(numericChoices(0.5, { pick: last }))).toEqual(['0.5', '0.05', '5', '0.005']);
    });
  });

  describe('given a truth of zero or less', () => {
    it('refuses rather than inventing options', () => {
      for (const truth of [0, -1, Number.NaN]) {
        expect(numericChoices(truth, { pick: zero })).toEqual({ choices: [], correct: '' });
      }
    });
  });

  describe('given a truth that is not finite', () => {
    it('refuses', () => {
      expect(numericChoices(Number.POSITIVE_INFINITY, { pick: zero }))
        .toEqual({ choices: [], correct: '' });
    });
  });

  describe('given a count below two', () => {
    it('refuses', () => {
      for (const count of [1, 0, -3]) {
        expect(numericChoices(0.5, { pick: zero, count })).toEqual({ choices: [], correct: '' });
      }
    });
  });

  describe('given a count that is not a whole number', () => {
    it('refuses', () => {
      expect(numericChoices(0.5, { pick: zero, count: 3.5 }))
        .toEqual({ choices: [], correct: '' });
    });
  });

  describe('given more options than can be generated', () => {
    it('returns every distinct one that exists', () => {
      // Eight steps either side of the truth, plus the truth.
      const set = numericChoices(0.5, { pick: zero, count: 100 });
      expect(set.choices).toHaveLength(17);
      expect(answerText(set)).toBe('0.5');
    });
  });

  describe('given a count that fills mid-pair', () => {
    it('stops rather than overshooting', () => {
      const set = numericChoices(0.5, { pick: zero, count: 2 });
      expect(texts(set)).toEqual(['5', '0.5']);
    });
  });

  describe('given offsets that overflow', () => {
    it('drops them', () => {
      // Everything above the truth runs past Number.MAX_VALUE, so the set fills
      // from below instead of offering an Infinity nobody can pick.
      const set = numericChoices(1e308, { pick: last, count: 4 });
      expect(texts(set)).toEqual(['1e+308', '1e+307', '1e+306', '1e+305']);
    });
  });

  describe('given offsets that underflow to zero', () => {
    it('drops them', () => {
      // The mirror case: below the smallest denormal every division rounds to
      // zero, which would render an unpickable "0" option.
      const set = numericChoices(Number.MIN_VALUE, { pick: last, count: 4 });
      expect(texts(set)).toEqual(['5e-324', '5e-323', '4.94e-322', '4.94e-321']);
    });
  });

  describe('given a format that collapses every option', () => {
    it('refuses rather than asking a one-option question', () => {
      // A coarse ZEC format does this for real at the bottom of the range,
      // rendering 0.0001 and 0.00001 the same way.
      expect(numericChoices(0.5, { pick: zero, format: () => 'about nothing' }))
        .toEqual({ choices: [], correct: '' });
    });
  });
});

describe('labelledChoices', () => {
  it('offers every label once, with the correct id', () => {
    const set = labelledChoices(['a coffee', 'a laptop', 'a car'], 1, last);
    expect(texts(set)).toEqual(['a coffee', 'a laptop', 'a car']);
    expect(answerText(set)).toBe('a laptop');
  });

  it('shuffles the labels', () => {
    const set = labelledChoices(['a coffee', 'a laptop', 'a car'], 0, zero);
    expect(texts(set)).toEqual(['a laptop', 'a car', 'a coffee']);
    expect(set.correct).toBe('c2');
  });

  describe('given duplicate labels', () => {
    it('keeps the first and drops the rest', () => {
      const set = labelledChoices(['a', 'b', 'a', 'b', 'c'], 4, last);
      expect(texts(set)).toEqual(['a', 'b', 'c']);
      expect(answerText(set)).toBe('c');
    });
  });

  describe('given the correct label is itself a duplicate', () => {
    it('credits the surviving copy', () => {
      // Two options reading "a" are one answer to the person reading them, so
      // the survivor has to carry the credit or the right pick scores wrong.
      const set = labelledChoices(['a', 'b', 'a'], 2, last);
      expect(texts(set)).toEqual(['a', 'b']);
      expect(answerText(set)).toBe('a');
    });
  });

  describe('given a correct index past the end', () => {
    it('refuses', () => {
      expect(labelledChoices(['a', 'b', 'c'], 3, last)).toEqual({ choices: [], correct: '' });
    });
  });

  describe('given a negative correct index', () => {
    it('refuses', () => {
      expect(labelledChoices(['a', 'b', 'c'], -1, last)).toEqual({ choices: [], correct: '' });
    });
  });

  describe('given a correct index that is not a whole number', () => {
    it('refuses', () => {
      expect(labelledChoices(['a', 'b', 'c'], 1.5, last)).toEqual({ choices: [], correct: '' });
    });
  });

  describe('given no labels', () => {
    it('refuses', () => {
      expect(labelledChoices([], 0, last)).toEqual({ choices: [], correct: '' });
    });
  });

  describe('given only one distinct label', () => {
    it('refuses', () => {
      // One button is not a question.
      expect(labelledChoices(['a', 'a'], 1, last)).toEqual({ choices: [], correct: '' });
    });
  });
});
