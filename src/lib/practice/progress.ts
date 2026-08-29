/**
 * What the user is good at, and what they should practise next.
 *
 * A single accuracy number tells someone only that they are mediocre on
 * average. It cannot be acted on: there is no drill for "be 12% better". Per
 * band and per mode it becomes advice — "you place coffees well and hotel
 * nights badly" names the thing to go and practise, which is why `Band` exists
 * in the contract at all.
 *
 * This is local, and it exists so the user can see their own improvement. It is
 * never a metric: nothing here leaves the device, nothing is aggregated, and no
 * number in it is worth flattering. A progress display that overstates how well
 * someone reads ZEC prices is the same failure as a wrong rate — it sends them
 * out to spend money on an intuition they do not have.
 *
 * Every function here is pure. `record` returns a new object rather than
 * editing the one it was given, so the caller can hold the previous state and
 * so `EMPTY_PRACTICE_PROGRESS` cannot quietly accumulate one session's history.
 */
import type { Band, ModeId, Score } from './types';

/** Attempts, and the points they earned. Mean points is the only number derived from it. */
export interface Tally {
  attempts: number;
  points: number;
}

export interface PracticeProgress {
  /**
   * Every band and every mode is present from the start, never added on first
   * use. A partial record forces every reader to decide what a missing key
   * means, and the two honest answers ("no attempts" and "corrupt") are
   * indistinguishable once written to storage.
   */
  bands: Record<Band, Tally>;
  modes: Record<ModeId, Tally>;
  /** Consecutive answers scoring 'close' or better. */
  streak: number;
  bestStreak: number;
  /** Ids of items recently answered badly, oldest first. */
  misses: string[];
}

export interface PracticeAttempt {
  band: Band;
  mode: ModeId;
  /** The item asked about, so a missed one can be resurfaced. */
  itemId: string;
  score: Score;
}

export interface WeakestBandOptions {
  /** Attempts a band needs before it may be named. Defaults to `MIN_ATTEMPTS_TO_JUDGE`. */
  minAttempts?: number;
}

/**
 * How many attempts a band needs before it can be called weak.
 *
 * Scores run 0-100, and one bad answer among n attempts moves the mean by up to
 * 100/n points. At five attempts that influence is capped at 20 points, which
 * is smaller than the gap between a band someone genuinely cannot read and one
 * they can. Below that, a single unlucky answer is enough to brand a whole
 * band as the user's weakness and send them off practising the wrong thing.
 */
export const MIN_ATTEMPTS_TO_JUDGE = 5;

/**
 * How many missed items the queue holds.
 *
 * The queue is a to-do list, so it has to be a list someone can finish: a
 * practice session runs on the order of ten questions, and a backlog that can
 * never be worked down in one sitting stops reading as "practise these" and
 * starts reading as a permanent scolding. It is also persisted, so it needs a
 * bound regardless — an unbounded queue grows to the size of the whole
 * catalogue and every write carries it.
 */
export const MISS_QUEUE_LIMIT = 12;

/**
 * Verdicts that count as getting it right.
 *
 * 'in the region' is deliberately excluded. It means within 60% of the answer,
 * which is close enough to be encouraging and much too loose to be the thing a
 * streak celebrates — a streak built on it would tell the user they are fluent
 * while they are still out by half.
 */
const GOOD_VERDICTS: ReadonlyArray<Score['verdict']> = ['spot on', 'close'];

/**
 * Bands in magnitude order.
 *
 * The order is also the tie-break in `weakestBand`, which is why it is written
 * down once rather than relying on object key order.
 */
const BANDS: readonly Band[] = ['tiny', 'small', 'everyday', 'large', 'huge'];

/** A fresh tally per slot, so no two slots ever share one object. */
function emptyTally(): Tally {
  return { attempts: 0, points: 0 };
}

export const EMPTY_PRACTICE_PROGRESS: PracticeProgress = {
  // Written out rather than built from `BANDS` so the type checker fails here
  // when a band or mode is added to the contract, instead of the gap surfacing
  // as an undefined tally at runtime.
  bands: {
    tiny: emptyTally(),
    small: emptyTally(),
    everyday: emptyTally(),
    large: emptyTally(),
    huge: emptyTally(),
  },
  modes: {
    'to-zec': emptyTally(),
    'from-zec': emptyTally(),
    judgement: emptyTally(),
    comparison: emptyTally(),
    budget: emptyTally(),
    rate: emptyTally(),
  },
  streak: 0,
  bestStreak: 0,
  misses: [],
};

function scored(tally: Tally, points: number): Tally {
  return { attempts: tally.attempts + 1, points: tally.points + points };
}

/**
 * Fold one answer into the progress.
 *
 * An answer that could not be scored is not an attempt and must not be passed
 * here: counting it would charge the user for our own inability to grade.
 */
export function record(progress: PracticeProgress, attempt: PracticeAttempt): PracticeProgress {
  const { band, mode, itemId, score } = attempt;
  const good = GOOD_VERDICTS.includes(score.verdict);
  const streak = good ? progress.streak + 1 : 0;

  // Dropping the item first does double duty: a good answer takes it off the
  // queue, and a repeated miss moves to the back rather than staying where it
  // was. Re-asking an item the moment it is missed is drilling, not spacing,
  // and the queue exists to space repetitions out.
  const misses = progress.misses.filter((id) => id !== itemId);
  if (!good) misses.push(itemId);

  return {
    bands: { ...progress.bands, [band]: scored(progress.bands[band], score.points) },
    modes: { ...progress.modes, [mode]: scored(progress.modes[mode], score.points) },
    streak,
    bestStreak: Math.max(progress.bestStreak, streak),
    // Keeping the tail drops the oldest miss when the queue is full. The newest
    // miss is the one the user just got wrong, so it is the one worth keeping.
    misses: misses.slice(-MISS_QUEUE_LIMIT),
  };
}

/**
 * Mean points per attempt, or null when there is nothing to average.
 *
 * Null rather than zero, everywhere. Zero is a real score meaning "answered and
 * got it badly wrong"; showing it for a band nobody has attempted invents a
 * failure the user never had.
 */
function meanPoints(tally: Tally): number | null {
  if (tally.attempts === 0) return null;
  return tally.points / tally.attempts;
}

export function bandAccuracy(progress: PracticeProgress, band: Band): number | null {
  return meanPoints(progress.bands[band]);
}

export function modeAccuracy(progress: PracticeProgress, mode: ModeId): number | null {
  return meanPoints(progress.modes[mode]);
}

/**
 * The band most worth practising, or null while no band has been attempted
 * enough to say.
 */
export function weakestBand(
  progress: PracticeProgress,
  options: WeakestBandOptions = {},
): Band | null {
  // A band with no attempts is unknown, not weak, so the floor stays at one
  // however low the caller sets the minimum — otherwise `minAttempts: 0` names
  // the band the user has never once practised as the one they are worst at.
  const floor = Math.max(1, options.minAttempts ?? MIN_ATTEMPTS_TO_JUDGE);

  let weakest: Band | null = null;
  let lowest = Infinity;
  for (const band of BANDS) {
    const tally = progress.bands[band];
    if (tally.attempts < floor) continue;
    const mean = tally.points / tally.attempts;
    // Strictly lower, walking bands in magnitude order, so a tie resolves to
    // the smaller band and always resolves the same way. A weakest band that
    // flips between two equally weak ones on every render reads as noise and
    // teaches the user to ignore the advice.
    if (mean < lowest) {
      lowest = mean;
      weakest = band;
    }
  }
  return weakest;
}

/**
 * Items to resurface, oldest miss first.
 *
 * A copy, not the stored array: handing out the live one lets a caller's
 * `splice` or `sort` edit progress that was never recorded as changing, and the
 * next save writes the damage out.
 */
export function dueItems(progress: PracticeProgress): string[] {
  return [...progress.misses];
}
