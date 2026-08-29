import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../../src/lib/practice/catalogue';
import { type Band, bandOf, type Category } from '../../src/lib/practice/types';

// Spec: tests/trees/practice.catalogue.tree

// These assert the SHAPE of the catalogue, never its contents. A test that
// pinned "a coffee costs $4" would fail every time someone re-priced an entry,
// which trains people to edit the test until it passes — and the invariants
// below are the ones that actually decide whether practice works.

// The Category union, written out, because types are erased at runtime and a
// misfiled category would otherwise only surface as a mode that silently
// returns nothing.
const CATEGORIES: Category[] = [
  'drink',
  'food',
  'transport',
  'clothing',
  'tech',
  'home',
  'leisure',
  'services',
  'housing',
  'health',
  'travel',
  'education',
];

// A rate in the range ZEC has actually traded in. Bands are defined in ZEC, so
// reachability can only be checked against some rate; picking a realistic one
// makes the claim "every band is reachable" mean something to a real user
// rather than being satisfied by an absurd rate.
const USD_PER_ZEC = 780;

// One pictographic character, optionally with the variation selector that
// forces emoji rather than text presentation. Rejects an empty string, a stray
// letter, and a ZWJ sequence — the last of those renders as two glyphs on
// several platforms, which reads as a bug in the question itself.
const SINGLE_EMOJI = /^\p{Extended_Pictographic}\uFE0F?$/u;

// Ids key stored per-item progress. Anything outside this shape is a rename
// waiting to happen, and a renamed id silently discards a user's history.
const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const amounts = CATALOGUE.map((item) => item.amount);

it('holds at least 300 items', () => {
  // A session draws without replacement to avoid repeats. Too small a pool and
  // the user starts recalling the last answer instead of estimating a new one,
  // which measures memory rather than the intuition being trained.
  expect(CATALOGUE.length).toBeGreaterThanOrEqual(300);
});

describe('every entry', () => {
  it('has an id that is unique across the catalogue', () => {
    // A duplicate id makes two different items share one progress record, so
    // the per-band report the user acts on is quietly wrong.
    expect(new Set(CATALOGUE.map((item) => item.id)).size).toBe(CATALOGUE.length);
  });

  it('has a kebab-case id', () => {
    expect(CATALOGUE.filter((item) => !KEBAB_CASE.test(item.id))).toEqual([]);
  });

  it('has a label that is not empty', () => {
    expect(CATALOGUE.filter((item) => item.label.trim() === '')).toEqual([]);
  });

  it('starts the label with a lowercase letter', () => {
    // Labels are spliced mid-sentence ("how many ZEC is a haircut?"), so a
    // capitalised one reads as a typo everywhere it appears.
    expect(CATALOGUE.filter((item) => !/^[a-z]/.test(item.label))).toEqual([]);
  });

  it('carries a single emoji', () => {
    expect(CATALOGUE.filter((item) => !SINGLE_EMOJI.test(item.emoji))).toEqual([]);
  });

  it('is priced with a finite amount above zero', () => {
    // A zero or NaN price produces a question whose answer is 0 ZEC or NaN and
    // scores every honest guess as "way off".
    expect(CATALOGUE.filter((item) => !(Number.isFinite(item.amount) && item.amount > 0)))
      .toEqual([]);
  });

  it('is priced in USD', () => {
    // The rate lookup is by currency code. One entry in another currency would
    // be converted with the wrong rate and rendered as a confident wrong price.
    expect(CATALOGUE.filter((item) => item.currency !== 'USD')).toEqual([]);
  });

  it('declares one of the twelve categories', () => {
    expect(CATALOGUE.filter((item) => !CATEGORIES.includes(item.category))).toEqual([]);
  });

  it('declares itself a catalogue item', () => {
    // Source governs what may be said about a price: a catalogue price is a
    // typical price, not one the user actually pays. Mislabelling one as an
    // anchor or a liability would let the UI claim it as the user's own.
    expect(CATALOGUE.filter((item) => item.source !== 'catalogue')).toEqual([]);
  });
});

describe('coverage of the categories', () => {
  const byCategory = new Map<Category, number>(
    CATEGORIES.map((category) => [
      category,
      CATALOGUE.filter((item) => item.category === category).length,
    ]),
  );

  it('uses every category in the union', () => {
    expect([...byCategory].filter(([, count]) => count === 0)).toEqual([]);
  });

  it('gives every category enough items to draw from', () => {
    // A category with a handful of entries repeats them within one session,
    // which turns a category filter into a memory test.
    expect([...byCategory].filter(([, count]) => count < 12)).toEqual([]);
  });
});

describe('coverage of the magnitude range', () => {
  it('reaches every ZEC band at a plausible rate', () => {
    // The whole point of banding progress is that placing a coffee and placing
    // a year of rent are different skills. A band with no items is a skill the
    // user can never practise, and the report would show it as untested rather
    // than as unavailable.
    const reached = new Set<Band>(CATALOGUE.map((item) => bandOf(item.amount / USD_PER_ZEC)));
    const expected: Band[] = ['tiny', 'small', 'everyday', 'large', 'huge'];
    expect(expected.filter((band) => !reached.has(band))).toEqual([]);
  });

  it('fills every order of magnitude from a dollar upwards', () => {
    // Reaching a band is not the same as covering it. A catalogue clumped at
    // $10-100 satisfies every band via a couple of outliers while training
    // almost nothing, so each decade has to carry real weight of its own.
    const thin = [0, 1, 2, 3, 4].filter(
      (decade) => amounts.filter((amount) => Math.floor(Math.log10(amount)) === decade).length < 20,
    );
    expect(thin).toEqual([]);
  });

  it('starts around a dollar', () => {
    expect(Math.min(...amounts)).toBeLessThanOrEqual(1);
  });

  it('reaches the price of a car', () => {
    expect(Math.max(...amounts)).toBeGreaterThanOrEqual(30000);
  });
});
