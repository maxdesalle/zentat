/**
 * Wrong answers.
 *
 * Multiple choice is what makes practice fast enough to do a hundred
 * repetitions in a sitting — typing a number is a keyboard round-trip, tapping
 * one of four is not. But a choice question is worth exactly as much as its
 * distractors: three options nobody would pick is a question with one option,
 * and it trains nothing while reporting 100% accuracy.
 *
 * So the wrong answers here sit at MULTIPLICATIVE offsets from the truth (x10,
 * /10, x100), never additive ones. The skill being trained is order-of-
 * magnitude judgement — the same reason `scoreGuess` scores on a log scale.
 * A distractor 15% off the truth asks whether the user can do arithmetic,
 * which nobody needs and which a phone does better. The mistake actually worth
 * training out is the 100x one: the user who reads "0.04 ZEC" as a week's
 * groceries. Put that error on the screen as an option and picking it becomes
 * a thing they notice themselves doing.
 */
import type { Choice, Picker } from './types';

export interface ChoiceSet {
  choices: Choice[];
  correct: string;
}

export interface NumericChoiceOptions {
  pick: Picker;
  /** How many options in total, the truth included. */
  count?: number;
  /** The multiplicative step between neighbouring options. */
  spread?: number;
  /**
   * How an option renders. ZEC and fiat callers want different grammars and
   * this module has no business choosing between them; it only needs the
   * strings to compare them for collisions.
   */
  format?: (value: number) => string;
}

const DEFAULT_COUNT = 4;
const DEFAULT_SPREAD = 10;

/**
 * How far out the offsets are allowed to run. Past eight steps the distractor
 * is absurd on its face — nobody hesitates over "0.004 ZEC or 400,000 ZEC" —
 * so it is a filler option rather than a real one, and it also bounds the loop
 * against a caller asking for a hundred choices.
 */
const MAX_STEPS = 8;

/**
 * A refusal: no options and nothing marked correct.
 *
 * Fresh each time rather than a shared constant, because a caller that pushes
 * into `choices` would otherwise poison every later refusal in the session.
 *
 * `scoreAnswer` already declines to score a question with no `correct`, so an
 * empty set travels safely all the way to the scorer. That is the point — a
 * mode handed nonsense asks nothing, it does not ask something plausible.
 */
function none(): ChoiceSet {
  return { choices: [], correct: '' };
}

/** Twelve significant figures, which strips float dust like 0.37000000000000005. */
function plain(value: number): string {
  return String(Number(value.toPrecision(12)));
}

/**
 * A picker's answer, forced into range.
 *
 * A picker handing back a fraction, a negative, or NaN would index past the
 * array and swap in `undefined`, which does not throw — it silently deletes an
 * option and renders a blank button. Clamping turns a bad picker into a boring
 * shuffle instead of a broken question.
 */
function boundedIndex(raw: number, upperExclusive: number): number {
  return Number.isFinite(raw) ? Math.min(upperExclusive - 1, Math.max(0, Math.floor(raw))) : 0;
}

/**
 * Fisher-Yates over a copy, using the injected picker.
 *
 * Without this the correct answer sits in the slot its generation order put it
 * in, and users learn the slot rather than the unit — they will score well and
 * have learned nothing, which is the failure mode hardest to detect from the
 * progress numbers.
 */
export function shuffle<T>(items: T[], pick: Picker): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = boundedIndex(pick(i + 1), i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** An option under construction: its rendered text, and whether it is the answer. */
interface Candidate {
  label: string;
  truth: boolean;
}

/**
 * Turn shuffled candidates into choices.
 *
 * Ids are assigned by FINAL position, after the shuffle, so that neither the
 * slot nor the id gives the answer away. Assigning them during generation
 * would leave the truth as `c0` forever — invisible on screen, obvious to
 * anyone who opens the inspector, and a habit that survives into the version
 * where the ids are rendered.
 */
function assemble(ordered: Candidate[]): ChoiceSet {
  const choices: Choice[] = [];
  let correct = '';
  ordered.forEach((candidate, index) => {
    const id = `c${index}`;
    choices.push({ id, label: candidate.label });
    if (candidate.truth) correct = id;
  });
  return { choices, correct };
}

/**
 * A question's worth of numbers, one of them right.
 *
 * Returns fewer than `count` options when the offsets collide once formatted —
 * a coarse ZEC format renders 0.0001 and 0.00001 the same way — and refuses
 * outright rather than asking a question with a single option.
 */
export function numericChoices(truth: number, options: NumericChoiceOptions): ChoiceSet {
  const { pick, count = DEFAULT_COUNT, spread = DEFAULT_SPREAD, format = plain } = options;

  // A price of zero, a negative, or a NaN from a rate we could not fetch. There
  // is no honest set of distractors around a truth we do not have, and inventing
  // one would put a confident wrong number in front of someone about to spend.
  if (!(truth > 0) || !Number.isFinite(truth)) return none();
  // A single option is not a question, and a fractional count is a caller bug
  // that should surface as no question rather than as a guessed intent.
  if (!Number.isInteger(count) || count < 2) return none();

  // A step of 1 or less would generate the truth again, or values on the wrong
  // side of it; either way the offsets stop being offsets.
  const step = Number.isFinite(spread) && spread > 1 ? spread : DEFAULT_SPREAD;

  const taken: Candidate[] = [];
  const seen = new Set<string>();

  // Collisions are checked on the RENDERED text, not the value: two options
  // that read identically are one option no matter how far apart their numbers
  // are, and if the truth is one of them the user is marked wrong for picking
  // the right words.
  const add = (value: number, truthy: boolean): void => {
    // Overflow to Infinity at the top of the range, underflow to zero at the
    // bottom. Both would render as an option nobody can pick honestly.
    if (!(value > 0) || !Number.isFinite(value)) return;
    const label = format(value);
    if (seen.has(label)) return;
    seen.add(label);
    taken.push({ label, truth: truthy });
  };

  add(truth, true);

  // Which direction goes first is drawn, because a fixed order makes the
  // truth's RANK predictable even after shuffling: with four options and "up"
  // always first, the answer is forever the second-smallest on screen. Sorting
  // the options by eye then beats knowing the unit.
  const upFirst = boundedIndex(pick(2), 2) === 0;

  for (let n = 1; n <= MAX_STEPS && taken.length < count; n++) {
    const factor = step ** n;
    const pair = upFirst ? [truth * factor, truth / factor] : [truth / factor, truth * factor];
    for (const value of pair) {
      if (taken.length >= count) break;
      add(value, false);
    }
  }

  // Everything collapsed into the truth's own label. Better to ask nothing than
  // to show one button and call it a test.
  if (taken.length < 2) return none();

  return assemble(shuffle(taken, pick));
}

/**
 * A question's worth of names, one of them right — for the modes that ask
 * "which of these costs about 0.5 ZEC?" rather than for a number.
 */
export function labelledChoices(labels: string[], correctIndex: number, pick: Picker): ChoiceSet {
  // An index nobody can point at means no correct answer exists, and defaulting
  // to zero would mark the right answer wrong. Covers the empty list too, since
  // no index is in range there.
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= labels.length) {
    return none();
  }

  // Identical labels are the same answer to anyone reading them, so the first
  // occurrence carries the credit and the rest are dropped. Keeping both would
  // let a user pick the right words off the screen and be scored wrong, which
  // is the worst thing a choice question can do to someone.
  const correctLabel = labels[correctIndex];
  const unique: string[] = [];
  for (const label of labels) {
    if (!unique.includes(label)) unique.push(label);
  }

  if (unique.length < 2) return none();

  const candidates = unique.map((label) => ({ label, truth: label === correctLabel }));
  return assemble(shuffle(candidates, pick));
}
