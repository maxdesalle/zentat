/**
 * The contract every practice mode is written against.
 *
 * Passive exposure to converted prices does not teach a unit — it is a subtitle
 * track. What builds the intuition is being asked for a number BEFORE one is
 * shown, and being asked in more than one direction: reading "0.8 ZEC" and
 * knowing what it buys is a different skill from converting a price you can
 * already see, and it is the one a converted page actually demands.
 *
 * So a mode is a question factory, and every mode produces the SAME shape of
 * question. That is what lets the training page render any of them without
 * knowing which it has, and what lets a new mode arrive without touching the UI.
 */
import type { Liability } from '../liabilities';
import type { HeldRate } from '../rates/held';
import type { RatesData } from '../storage/rates';
import { type Score, scoreGuess } from '../training';

export type { Score };
export { scoreGuess };

/**
 * Where an item came from. Kept on the item because it changes what may be
 * said about it: a catalogue price is a typical price, an anchor is one the
 * user chose, and a liability is one they actually pay.
 */
export type ItemSource = 'catalogue' | 'anchor' | 'liability' | 'seen';

export type Category =
  | 'drink'
  | 'food'
  | 'transport'
  | 'clothing'
  | 'tech'
  | 'home'
  | 'leisure'
  | 'services'
  | 'housing'
  | 'health'
  | 'travel'
  | 'education';

export interface PracticeItem {
  id: string;
  /** As it would be said aloud: "a coffee", "a month of rent". */
  label: string;
  emoji: string;
  /** A typical price, in `currency`. */
  amount: number;
  currency: string;
  category: Category;
  source: ItemSource;
}

/**
 * Magnitude bands, in ZEC.
 *
 * Progress is tracked per band because that is what is actually actionable:
 * "you place coffees well and hotel nights badly" tells someone what to
 * practise, where a single accuracy score tells them only that they are
 * mediocre on average.
 */
export type Band = 'tiny' | 'small' | 'everyday' | 'large' | 'huge';

export function bandOf(zec: number): Band {
  if (zec < 0.01) return 'tiny';
  if (zec < 0.1) return 'small';
  if (zec < 1) return 'everyday';
  if (zec < 10) return 'large';
  return 'huge';
}

/**
 * Chooses an index below `upperExclusive`.
 *
 * Injected rather than reached for, so a mode is a pure function of its inputs.
 * `Math.random()` inside a mode makes the interesting branches unreachable from
 * a test, and this suite holds every branch to being exercised.
 */
export type Picker = (upperExclusive: number) => number;

export interface AskContext {
  /** Everything worth asking about, already pooled and ordered by the caller. */
  items: PracticeItem[];
  rates: RatesData;
  /** The currency the user thinks in. */
  currency: string;
  held: HeldRate | null;
  liabilities: Liability[];
  pick: Picker;
}

export type ModeId = 'to-zec' | 'from-zec' | 'judgement' | 'comparison' | 'budget' | 'rate';

export type InputKind = 'number' | 'choice';

export interface Choice {
  id: string;
  label: string;
}

export interface Question {
  mode: ModeId;
  /** What the user is asked, in full. */
  prompt: string;
  emoji: string;
  input: InputKind;
  /** Present exactly when `input` is 'choice'. */
  choices?: Choice[];
  /** The ZEC value a numeric answer is scored against. */
  answer: number;
  /** The id of the right choice, present exactly when `input` is 'choice'. */
  correct?: string;
  /** Shown after answering: what the answer was, and why. */
  explain: string;
  band: Band;
  /**
   * The item the question was about, when it was about one.
   *
   * Without it the spaced repetition cannot close: progress records a miss
   * against an item id, and the pool resurfaces exactly those ids — so a
   * question that does not say what it asked about is a miss that can never be
   * re-asked. Absent only for modes that ask about no item at all, which today
   * is rate recall.
   */
  itemId?: string;
}

export interface Mode {
  id: ModeId;
  /** Names the mode in the picker. */
  title: string;
  /** One line saying what it trains. */
  blurb: string;
  /**
   * A question, or null when the context cannot support one — no rate for the
   * currency, too few items to compare, no obligations to budget against. A
   * mode that cannot ask honestly asks nothing; it never invents a plausible
   * wrong number.
   */
  ask(context: AskContext): Question | null;
}

/**
 * Score one answer.
 *
 * Numeric answers are scored on relative error on a log scale, so "twice as
 * much" and "half as much" cost the same — a linear scale would punish
 * overestimates far harder, which is an artifact of the arithmetic rather than
 * a real difference in skill. A choice is right or it is not; there is no
 * partial credit in picking one of four.
 */
export function scoreAnswer(question: Question, response: number | string): Score | null {
  if (question.input === 'choice') {
    // A question with no correct answer recorded cannot be scored, and scoring
    // it as wrong would blame the user for our own omission.
    if (question.correct === undefined) return null;
    const right = response === question.correct;
    return { points: right ? 100 : 0, error: 0, verdict: right ? 'spot on' : 'way off' };
  }
  return scoreGuess(Number(response), question.answer);
}
