/**
 * The reverse direction, and the reason the exercise exists.
 *
 * Asking for the ZEC figure behind a fiat price trains arithmetic, and it
 * trains the direction a user almost never needs: the page has already done
 * that conversion for them. What a converted page actually demands is this
 * one. You read "0.8 ZEC" and have to know, without a calculator and without
 * converting back, whether that is a coffee or a laptop. Until that is
 * automatic, ZEC is a label on a price rather than a unit anyone thinks in.
 *
 * So the question is a recognition question, not a sum: here is a quantity of
 * ZEC, which of these four things is it? That is only worth asking if the four
 * are far enough apart that eliminating three is a judgement rather than a
 * guess, which is what most of the code below is about.
 */
import { formatZecWithSymbol } from '../../conversion/format';
import { heldRateFor } from '../../rates/held';
import {
  type AskContext,
  bandOf,
  type Mode,
  type Picker,
  type PracticeItem,
  type Question,
} from '../types';

/** Three wrong options beside the right one. */
const DISTRACTORS = 3;

/**
 * How far apart two options must be, as a ratio of their ZEC values.
 *
 * An order of magnitude is what the mode is actually teaching — the skill is
 * "is this a coffee or a laptop", not "is this £4 or £5" — so that is what we
 * try for first. Insisting on it would silence the mode on most pools: four
 * mutually 10x-separated items need a catalogue spanning a thousandfold, and a
 * pool of everyday things spans far less. The looser tier keeps the question
 * askable while still leaving every option distinguishable on magnitude alone;
 * below it, two options round to the same mental bucket and the user is picking
 * a raffle ticket.
 */
const WIDE_SEPARATION = 10;
const NARROW_SEPARATION = 3;

/**
 * The prompt cannot wear the item's emoji: it IS the answer. A coffee cup
 * beside "which of these costs 0.02 ZEC" gives the game away and turns a
 * recall exercise into a matching one.
 */
const NEUTRAL_EMOJI = '🤔';

interface Priced {
  item: PracticeItem;
  zec: number;
}

/**
 * An item's value in ZEC at the rate the user is actually shown.
 *
 * Priced in the item's OWN currency, not the reference one. A pool mixes
 * sources — a catalogue in USD, a liability the user entered in EUR — and
 * converting a EUR amount at the USD rate is the class of mistake this project
 * treats as unshippable, silently wrong by whatever the cross happens to be.
 *
 * Every unusable rate collapses to zero here rather than being classified:
 * a held rate that cannot cover the currency comes back null, a missing feed
 * comes back undefined, and a negative or NaN quote is worth no more than
 * either. The single `> 0` test at each call site rejects all of them.
 */
function zecOf(item: PracticeItem, context: AskContext): number {
  const rate = (context.held
    ? heldRateFor(context.held, context.rates, item.currency)
    : context.rates.rates[item.currency.toUpperCase()]) ?? 0;
  return item.amount * rate;
}

/** Whether two ZEC values differ by at least `factor`, in either direction. */
function apart(a: number, b: number, factor: number): boolean {
  return Math.max(a, b) / Math.min(a, b) >= factor;
}

/**
 * Pick wrong options that are wrong by a visible margin.
 *
 * Each candidate must clear `factor` against the answer AND against every
 * option already taken. Separation from the answer alone is not enough: three
 * distractors clustered together read as one option repeated, so the question
 * degrades to a coin flip between that cluster and the odd one out.
 *
 * An already-taken option fails its own separation test — a value is never a
 * factor away from itself — so the pool needs no filtering as we go, and an
 * item that happens to share a value with a taken one is excluded for free.
 *
 * Greedy, and allowed to dead-end. A picker's early choice can strand the
 * search short of three even when some other combination would have worked;
 * returning null there costs one skipped question, where backtracking would
 * cost a search whose runtime the caller cannot predict.
 */
function pickDistractors(
  pool: Priced[],
  answer: number,
  factor: number,
  pick: Picker,
): Priced[] | null {
  const chosen: Priced[] = [];
  while (chosen.length < DISTRACTORS) {
    const eligible = pool.filter((candidate) =>
      apart(candidate.zec, answer, factor)
      && chosen.every((taken) => apart(candidate.zec, taken.zec, factor))
    );
    if (eligible.length === 0) return null;
    chosen.push(eligible[pick(eligible.length)]);
  }
  return chosen;
}

/** "1,600 USD" — the code trails the number, as everywhere else in the UI. */
function fiat(item: PracticeItem): string {
  const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
    .format(item.amount);
  return `${amount} ${item.currency.toUpperCase()}`;
}

export const fromZec: Mode = {
  id: 'from-zec',
  title: 'What does it buy?',
  blurb: 'Reads you a ZEC amount and asks what it is worth — the direction a page demands.',

  ask(context: AskContext): Question | null {
    const { items, pick } = context;
    // Nothing to ask about. Reached before the picker, because pick(0) has no
    // valid answer to give and would hand back an undefined item.
    if (items.length === 0) return null;

    const item = items[pick(items.length)];
    const zec = zecOf(item, context);
    // Covers a missing, zero, negative or NaN rate, and an item priced at zero
    // or below. Either way there is no honest question here: a mode that
    // cannot ask honestly asks nothing rather than inventing a plausible
    // number, because a wrong price is worse than no price.
    if (!(zec > 0)) return null;

    const pool: Priced[] = [];
    for (const other of items) {
      // Two entries can carry one id — the same thing seen on a page and also
      // sitting in the catalogue. Offering both makes a correct choice
      // scoreable as wrong, since scoring compares ids.
      if (other.id === item.id) continue;
      const otherZec = zecOf(other, context);
      // An item whose currency has no rate cannot be placed on the same scale
      // as the answer, so it cannot be shown to be a fair distance from it.
      if (otherZec > 0) pool.push({ item: other, zec: otherZec });
    }

    const chosen = pickDistractors(pool, zec, WIDE_SEPARATION, pick)
      ?? pickDistractors(pool, zec, NARROW_SEPARATION, pick);
    // Too few items, or too clustered to separate. Both arrive here as null.
    if (chosen === null) return null;

    // Shuffled, or the answer is always first and the mode trains position
    // instead of value.
    const options = [{ item, zec }, ...chosen];
    for (let i = options.length - 1; i > 0; i--) {
      const j = pick(i + 1);
      [options[i], options[j]] = [options[j], options[i]];
    }

    const zecText = formatZecWithSymbol(zec);
    return {
      mode: 'from-zec',
      prompt: `Which of these costs about ${zecText}?`,
      emoji: NEUTRAL_EMOJI,
      input: 'choice',
      choices: options.map((option) => ({
        id: option.item.id,
        label: `${option.item.emoji} ${option.item.label}`,
      })),
      answer: zec,
      correct: item.id,
      // Equal to `correct` here only because this mode's subject IS its
      // answer; they are different questions ("which option was right" vs
      // "what was this about") and a distractor's id would answer neither.
      // Progress records a miss against this id and the pool resurfaces it
      // for spaced repetition, so omitting it makes a miss unrepeatable and
      // the whole loop quietly does nothing.
      itemId: item.id,
      // Both units in one sentence, because the pairing is the thing being
      // learned. Naming the fiat price alone teaches nothing the user did not
      // already know, and the ZEC figure alone is the question again.
      explain: `${zecText} is ${item.label}, about ${fiat(item)} at the displayed rate.`,
      band: bandOf(zec),
    };
  },
};
