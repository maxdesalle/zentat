/**
 * Recall of the rate itself.
 *
 * Every other mode hangs the number on an object — a coffee, a month of rent —
 * and the object carries the memory. This one takes the object away: there is
 * nothing left to recall but the rate. That makes it the most direct test of
 * whether ZEC has become a unit the user thinks in, and also the mode that most
 * easily turns into a lie.
 *
 * It is defensible ONLY against the held rate, and that is the entire reason it
 * can exist. Spot moves several times a day, so drilling spot would be teaching
 * a number that is wrong by lunchtime — and worse, rewarding the user for
 * recalling it. A confident wrong number is the one thing this product must
 * never produce, and a practice mode that manufactures one on purpose is worse
 * than a page that shows no price at all.
 *
 * The held rate moves only when spot leaves the band (see lib/rates/held.ts),
 * which is exactly what makes it a learnable fact rather than a moving target,
 * and what makes "you got it right" mean something an hour later. So with no
 * held rate, or a held rate that cannot be carried to the user's currency, this
 * mode asks nothing.
 */
import { formatZecWithSymbol } from '../../conversion/format';
import { divergence, heldRateFor } from '../../rates/held';
import {
  type AskContext,
  bandOf,
  type Choice,
  type Mode,
  type Picker,
  type Question,
} from '../types';

/**
 * Three significant figures, because the held rate is honest to ±10% — a fourth
 * digit claims a precision the peg cannot support, and produces a figure nobody
 * can hold in mind, which is the whole job.
 */
const FIGURES = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 });

/**
 * A fiat figure tagged with its code.
 *
 * Deliberately not `Intl` currency style: that throws a RangeError on a code it
 * does not recognise, and `context.currency` is user-set. A practice page must
 * not die on an unusual currency, and "50 USD" loses nothing against "$50".
 */
function fiat(amount: number, code: string): string {
  return `${FIGURES.format(amount)} ${code}`;
}

/**
 * The round fiat amounts worth asking about. The skill being trained is recall,
 * not arithmetic, so the question is never about 137 of anything.
 */
const ROUND_AMOUNTS = [100, 1_000, 10_000, 100_000] as const;

const CHOICE_COUNT = 4;

/**
 * The round amount whose ZEC answer lands nearest 1 ZEC.
 *
 * A hardcoded 100 is a good question in USD and a useless one in JPY, where
 * 100 JPY is around 0.0013 ZEC — a number with no shape, that nobody could
 * either recall or check themselves against. Distance is measured in log terms
 * so being a factor high costs the same as being a factor low; on a linear
 * measure the largest rung would win almost every time.
 */
function roundAmountFor(rate: number): number {
  return ROUND_AMOUNTS.reduce((best, amount) =>
    Math.abs(Math.log10(amount * rate)) < Math.abs(Math.log10(best * rate)) ? amount : best
  );
}

/**
 * How far spot sits from the held rate, said in the direction the user reads.
 *
 * `divergence` reports the gap in ZEC-per-fiat, and the number on screen beside
 * this sentence is its reciprocal. A peg 5% below spot in ZEC-per-fiat means
 * ZEC is worth 5% LESS than "1 ZEC ≈ 50 USD" claims, so repeating the raw sign
 * here would state the movement backwards — a confident wrong number, in the
 * one mode whose entire subject is the number.
 *
 * `1 + gap` cannot be zero: `heldRateFor` only answered because the numeraire
 * is quoted above zero, so the gap is strictly greater than -1.
 */
function driftSentence(gap: number): string {
  const asPrice = -gap / (1 + gap);
  const percent = Math.round(Math.abs(asPrice) * 100);
  // Under a whole percent there is nothing to report, and "0% above that" reads
  // as a defect rather than as agreement.
  if (percent === 0) return 'Spot is in line with that right now.';
  return `ZEC is trading about ${percent}% ${asPrice > 0 ? 'above' : 'below'} that right now.`;
}

/** Everything the shapes need, worked out once so they cannot disagree. */
interface RateFacts {
  code: string;
  /** ZEC per unit of `code`, at the held rate. */
  rate: number;
  /** A round fiat amount worth asking about in this currency. */
  amount: number;
  /** The held rate stated plainly, plus where spot currently sits against it. */
  rateLine: string;
}

/** "Roughly how many ZEC is 100 USD?" */
function zecForRoundAmount(facts: RateFacts): Question {
  const answer = facts.amount * facts.rate;
  const asked = fiat(facts.amount, facts.code);
  return {
    mode: 'rate',
    prompt: `Roughly how many ZEC is ${asked}?`,
    emoji: '⚖️',
    input: 'number',
    answer,
    explain: `${asked} is ${formatZecWithSymbol(answer)}. ${facts.rateLine}`,
    band: bandOf(answer),
  };
}

/** "Roughly how much is 1 ZEC worth, in USD?" */
function fiatForOneZec(facts: RateFacts): Question {
  // The one shape scored against a FIAT figure rather than a ZEC one: the user
  // types "50" meaning 50 USD, and `scoreGuess` compares it to 1/rate. Scoring
  // is on relative error and so is unit-agnostic, which is why that works.
  //
  // `band` is NOT unit-agnostic. `bandOf` reads ZEC, so handing it the fiat
  // answer would file "1 ZEC is worth 50 USD" under 'huge', next to a house
  // deposit, and the per-band progress readout would then tell the user to
  // practise a band they had never been asked about. The ZEC quantity this
  // question is actually about is one ZEC, so that is what it is banded by.
  const answer = 1 / facts.rate;
  return {
    mode: 'rate',
    prompt: `Roughly how much is 1 ZEC worth, in ${facts.code}?`,
    emoji: '🪙',
    input: 'number',
    answer,
    explain: facts.rateLine,
    band: bandOf(1),
  };
}

/** The same question as a four-way pick, for when a number is too slow to give. */
function magnitudeChoice(facts: RateFacts, pick: Picker): Question {
  const truth = facts.amount * facts.rate;
  const asked = fiat(facts.amount, facts.code);
  // Which slot holds the truth is drawn rather than fixed: an answer that is
  // always third teaches the slot, not the rate.
  const correct = pick(CHOICE_COUNT);
  // A clean factor of ten between the options, so this is a magnitude question
  // and nothing else — four rates within 20% of each other would be an
  // arithmetic test wearing a multiple choice. 'coarse' for the same reason:
  // two significant figures is all a ±10% peg supports, and it stops the eye
  // picking an option by comparing digits instead of recalling the rate.
  const choices: Choice[] = Array.from({ length: CHOICE_COUNT }, (_, slot) => ({
    id: `opt-${slot}`,
    label: formatZecWithSymbol(truth * 10 ** (slot - correct), 'coarse'),
  }));
  return {
    mode: 'rate',
    prompt: `Roughly how many ZEC is ${asked}?`,
    emoji: '⚖️',
    input: 'choice',
    choices,
    answer: truth,
    correct: `opt-${correct}`,
    explain: `${asked} is ${formatZecWithSymbol(truth)}. ${facts.rateLine}`,
    band: bandOf(truth),
  };
}

type ShapeBuilder = (facts: RateFacts, pick: Picker) => Question;

const SHAPES: readonly ShapeBuilder[] = [zecForRoundAmount, fiatForOneZec, magnitudeChoice];

export const rateRecall: Mode = {
  id: 'rate',
  title: 'The rate',
  blurb: 'Recall the rate itself, with no price to lean on.',

  ask(context: AskContext): Question | null {
    const held = context.held;
    // Spot is not learnable and drilling it would teach a number wrong by
    // lunchtime. Without the held rate this mode has no honest question.
    if (held === null) return null;

    const rate = heldRateFor(held, context.rates, context.currency);
    // null when the currency has no spot quote to carry the held leg across.
    // Non-finite when a stored peg has been corrupted to Infinity: `heldRateFor`
    // guards `peg > 0`, which Infinity satisfies, and the question would reach
    // the user with a blank or infinite answer behind it.
    if (rate === null || !Number.isFinite(rate)) return null;

    const code = context.currency.toUpperCase();
    // Measured on the numeraire leg because that is the only leg that is pegged;
    // the fiat cross is carried live and so contributes no staleness in any
    // currency. Never null here: `divergence` guards exactly what `heldRateFor`
    // already required — a usable peg and a usable numeraire quote — so a branch
    // on it would be an arm no test could ever reach.
    const gap = divergence(held, context.rates)!;
    const facts: RateFacts = {
      code,
      rate,
      amount: roundAmountFor(rate),
      rateLine: `The held rate is 1 ZEC ≈ ${fiat(1 / rate, code)}. ${driftSentence(gap)}`,
    };

    return SHAPES[context.pick(SHAPES.length)](facts, context.pick);
  },
};
