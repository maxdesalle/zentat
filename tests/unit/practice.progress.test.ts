import { describe, expect, it } from 'vitest';
import {
  bandAccuracy,
  dueItems,
  EMPTY_PRACTICE_PROGRESS,
  MISS_QUEUE_LIMIT,
  modeAccuracy,
  type PracticeAttempt,
  type PracticeProgress,
  record,
  weakestBand,
} from '../../src/lib/practice/progress';
import type { Band, Score } from '../../src/lib/practice/types';

// Spec: tests/trees/practice.progress.tree

function score(points: number, verdict: Score['verdict']): Score {
  // `error` plays no part in progress — only points and the verdict do — so it
  // is fixed here rather than faked into something that looks meaningful.
  return { points, error: 0, verdict };
}

const GOOD = score(100, 'spot on');
const BAD = score(0, 'way off');

function attempt(over: Partial<PracticeAttempt> = {}): PracticeAttempt {
  return { band: 'everyday', mode: 'to-zec', itemId: 'coffee', score: GOOD, ...over };
}

/** Fold the same attempt in `times` times, to get a band past its minimum. */
function repeat(
  progress: PracticeProgress,
  times: number,
  over: Partial<PracticeAttempt>,
): PracticeProgress {
  let next = progress;
  for (let i = 0; i < times; i++) next = record(next, attempt(over));
  return next;
}

/** A band with `times` attempts all worth `points`, so its mean is exactly `points`. */
function band(
  progress: PracticeProgress,
  name: Band,
  times: number,
  points: number,
): PracticeProgress {
  return repeat(progress, times, { band: name, score: score(points, 'in the region') });
}

describe('EMPTY_PRACTICE_PROGRESS', () => {
  it('starts every band and every mode at no attempts', () => {
    // Every key present from the start: a band that appears only on first use
    // is indistinguishable from a band lost to a bad migration.
    expect(Object.keys(EMPTY_PRACTICE_PROGRESS.bands)).toHaveLength(5);
    expect(Object.keys(EMPTY_PRACTICE_PROGRESS.modes)).toHaveLength(6);
    for (const tally of Object.values(EMPTY_PRACTICE_PROGRESS.bands)) {
      expect(tally).toEqual({ attempts: 0, points: 0 });
    }
    for (const tally of Object.values(EMPTY_PRACTICE_PROGRESS.modes)) {
      expect(tally).toEqual({ attempts: 0, points: 0 });
    }
  });

  it('starts with no streak and nothing due', () => {
    expect(EMPTY_PRACTICE_PROGRESS.streak).toBe(0);
    expect(EMPTY_PRACTICE_PROGRESS.bestStreak).toBe(0);
    expect(dueItems(EMPTY_PRACTICE_PROGRESS)).toEqual([]);
  });
});

describe('record', () => {
  it('counts the attempt against both the band and the mode', () => {
    // One answer is evidence about the magnitude AND about the direction it was
    // asked in. Charging it to only one of them loses half the advice.
    const after = record(EMPTY_PRACTICE_PROGRESS, attempt({ band: 'small', mode: 'from-zec' }));
    expect(after.bands.small).toEqual({ attempts: 1, points: 100 });
    expect(after.modes['from-zec']).toEqual({ attempts: 1, points: 100 });
    expect(after.bands.huge).toEqual({ attempts: 0, points: 0 });
    expect(after.modes['to-zec']).toEqual({ attempts: 0, points: 0 });
  });

  describe('given a good answer', () => {
    it('continues the streak, whether spot on or close', () => {
      // 'close' is within a quarter of the answer, which is the skill being
      // trained; refusing it a streak would make the streak measure arithmetic.
      const one = record(EMPTY_PRACTICE_PROGRESS, attempt({ score: score(100, 'spot on') }));
      const two = record(one, attempt({ score: score(80, 'close') }));
      expect(one.streak).toBe(1);
      expect(two.streak).toBe(2);
    });

    it('takes the item off the miss queue', () => {
      // Without this the queue only grows, and an item the user has since
      // learned keeps being resurfaced as though they still cannot place it.
      const missed = record(EMPTY_PRACTICE_PROGRESS, attempt({ itemId: 'rent', score: BAD }));
      const fixed = record(missed, attempt({ itemId: 'rent', score: GOOD }));
      expect(dueItems(missed)).toEqual(['rent']);
      expect(dueItems(fixed)).toEqual([]);
    });
  });

  describe('given a poor answer', () => {
    it('breaks the streak', () => {
      // 'in the region' is up to 60% out. A streak that survives it tells the
      // user they are fluent while they are still out by half.
      const built = repeat(EMPTY_PRACTICE_PROGRESS, 2, {});
      expect(record(built, attempt({ score: score(40, 'in the region') })).streak).toBe(0);
      expect(record(built, attempt({ score: BAD })).streak).toBe(0);
    });

    it('puts the item on the miss queue', () => {
      const after = record(EMPTY_PRACTICE_PROGRESS, attempt({ itemId: 'laptop', score: BAD }));
      expect(dueItems(after)).toEqual(['laptop']);
    });
  });

  it('remembers the best streak reached', () => {
    // The best streak is the one thing here that only ever goes up, so it is
    // what makes a bad session survivable rather than a reset to nothing.
    const built = repeat(EMPTY_PRACTICE_PROGRESS, 3, {});
    const broken = record(built, attempt({ score: BAD }));
    expect(broken.streak).toBe(0);
    expect(broken.bestStreak).toBe(3);
  });

  describe('when the same item is missed twice', () => {
    it('keeps one entry and moves it to the back', () => {
      // A duplicated id would spend two of the queue's twelve slots on one
      // item, and asking it again immediately is drilling rather than spacing.
      let progress = record(EMPTY_PRACTICE_PROGRESS, attempt({ itemId: 'a', score: BAD }));
      progress = record(progress, attempt({ itemId: 'b', score: BAD }));
      progress = record(progress, attempt({ itemId: 'a', score: BAD }));
      expect(dueItems(progress)).toEqual(['b', 'a']);
    });
  });

  describe('when more items are missed than the queue holds', () => {
    it('drops the oldest miss', () => {
      // Unbounded, the queue grows to the whole catalogue and is written out on
      // every save; it also stops reading as a list anyone could finish.
      let progress = EMPTY_PRACTICE_PROGRESS;
      for (let i = 0; i <= MISS_QUEUE_LIMIT; i++) {
        progress = record(progress, attempt({ itemId: `item-${i}`, score: BAD }));
      }
      const due = dueItems(progress);
      expect(due).toHaveLength(MISS_QUEUE_LIMIT);
      expect(due[0]).toBe('item-1');
      expect(due.at(-1)).toBe(`item-${MISS_QUEUE_LIMIT}`);
    });
  });

  it('leaves the progress it was given untouched', () => {
    // The shared empty constant is the one most likely to be edited in place,
    // and once it holds a session's history every later user of it starts dirty.
    record(EMPTY_PRACTICE_PROGRESS, attempt({ band: 'huge', mode: 'rate', score: BAD }));
    expect(EMPTY_PRACTICE_PROGRESS.bands.huge).toEqual({ attempts: 0, points: 0 });
    expect(EMPTY_PRACTICE_PROGRESS.modes.rate).toEqual({ attempts: 0, points: 0 });
    expect(EMPTY_PRACTICE_PROGRESS.misses).toEqual([]);
    expect(EMPTY_PRACTICE_PROGRESS.streak).toBe(0);
  });
});

describe('bandAccuracy', () => {
  it('reports mean points for the band', () => {
    let progress = record(EMPTY_PRACTICE_PROGRESS, attempt({ band: 'large', score: GOOD }));
    progress = record(progress, attempt({ band: 'large', score: score(50, 'in the region') }));
    expect(bandAccuracy(progress, 'large')).toBe(75);
  });

  describe('given no attempts in the band', () => {
    it('reports nothing rather than zero', () => {
      // Zero is a real score meaning "answered and got it badly wrong". Showing
      // it for a band nobody has tried invents a failure the user never had.
      expect(bandAccuracy(EMPTY_PRACTICE_PROGRESS, 'tiny')).toBeNull();
    });
  });
});

describe('modeAccuracy', () => {
  it('reports mean points for the mode', () => {
    let progress = record(EMPTY_PRACTICE_PROGRESS, attempt({ mode: 'budget', score: GOOD }));
    progress = record(progress, attempt({ mode: 'budget', score: score(60, 'in the region') }));
    expect(modeAccuracy(progress, 'budget')).toBe(80);
  });

  describe('given no attempts in the mode', () => {
    it('reports nothing rather than zero', () => {
      expect(modeAccuracy(EMPTY_PRACTICE_PROGRESS, 'comparison')).toBeNull();
    });
  });
});

describe('weakestBand', () => {
  describe('given no attempts at all', () => {
    it('names no band', () => {
      expect(weakestBand(EMPTY_PRACTICE_PROGRESS)).toBeNull();
    });
  });

  describe('given every band short of the attempt minimum', () => {
    it('names no band', () => {
      // Four attempts is not enough to tell a weakness from a bad afternoon.
      const progress = band(EMPTY_PRACTICE_PROGRESS, 'small', 4, 10);
      expect(weakestBand(progress)).toBeNull();
    });
  });

  describe('given two bands past the minimum', () => {
    it('names the one scoring lowest', () => {
      let progress = band(EMPTY_PRACTICE_PROGRESS, 'small', 5, 90);
      progress = band(progress, 'huge', 5, 20);
      expect(weakestBand(progress)).toBe('huge');
    });
  });

  describe('when a band scores badly but is barely attempted', () => {
    it('ignores that band until the minimum is met', () => {
      // One unlucky answer must not brand a whole band as the weakness and
      // send the user off practising the wrong magnitude.
      let progress = band(EMPTY_PRACTICE_PROGRESS, 'tiny', 1, 0);
      progress = band(progress, 'huge', 5, 50);
      expect(weakestBand(progress)).toBe('huge');
    });
  });

  describe('when two bands score the same', () => {
    it('names the smaller band, so the answer does not flicker', () => {
      // Equally weak bands must resolve the same way on every call; an answer
      // that alternates between two of them teaches the user to ignore it.
      let progress = band(EMPTY_PRACTICE_PROGRESS, 'small', 5, 40);
      progress = band(progress, 'large', 5, 40);
      expect(weakestBand(progress)).toBe('small');
      expect(weakestBand(progress)).toBe('small');
    });
  });

  describe('when the caller sets its own minimum', () => {
    it('judges on that many attempts', () => {
      const progress = band(EMPTY_PRACTICE_PROGRESS, 'huge', 2, 10);
      expect(weakestBand(progress)).toBeNull();
      expect(weakestBand(progress, { minAttempts: 2 })).toBe('huge');
    });
  });

  describe('when the caller asks for a minimum of none', () => {
    it('still ignores a band never attempted', () => {
      // At a floor of zero every untouched band divides zero points by zero
      // attempts; naming one would report the band the user has never seen as
      // the one they are worst at.
      expect(weakestBand(EMPTY_PRACTICE_PROGRESS, { minAttempts: 0 })).toBeNull();
    });
  });
});

describe('dueItems', () => {
  it('lists the missed items oldest first', () => {
    // Oldest first is what spaced repetition wants: the miss furthest in the
    // past is the one most due for another look.
    let progress = EMPTY_PRACTICE_PROGRESS;
    for (const id of ['a', 'b', 'c']) {
      progress = record(progress, attempt({ itemId: id, score: BAD }));
    }
    expect(dueItems(progress)).toEqual(['a', 'b', 'c']);
  });

  it('hands back a copy, so a caller cannot edit stored progress', () => {
    // Handing out the live array lets a caller's splice or sort change progress
    // that was never recorded as changing, and the next save writes it out.
    const progress = record(EMPTY_PRACTICE_PROGRESS, attempt({ itemId: 'a', score: BAD }));
    dueItems(progress).splice(0, 1);
    expect(dueItems(progress)).toEqual(['a']);
  });
});
