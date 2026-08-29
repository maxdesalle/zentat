/**
 * Judgement — the only mode with no fiat anywhere.
 *
 * Every other mode leaves a translation available: a price in one unit and a
 * request for the other. That is convertible thinking, and it is a different
 * skill from the one this product exists to build. Here the user is handed a
 * ZEC amount and an object, and has to decide whether they match. Nothing on
 * screen can be converted, because there is nothing to convert from — the only
 * way through is to already hold the magnitude.
 *
 * Which is what "unit of account" means, and why this mode is the one that says
 * the user has arrived.
 */
import { formatZecWithSymbol } from '../../conversion/format';
import { heldRateFor } from '../../rates/held';
import { type AskContext, bandOf, type Mode, type Question } from '../types';

/**
 * How far a deliberately wrong offer sits from the truth: a factor of two.
 *
 * The margin has to clear the user's OWN error or the question scores noise
 * instead of skill. `scoreGuess` calls a guess within 25% 'close' and only
 * treats a factor of 4 as worthless, so a competent estimator is routinely a
 * third out. Against a 30% margin that person cannot tell an overcharge from
 * the real price, gets marked wrong for a good estimate, and learns to
 * distrust the intuition this feature is trying to build.
 *
 * Two is the smallest factor clearing that band in both directions (+100% /
 * -50%) while still demanding a real estimate. A factor of ten would be
 * answerable without knowing the price at all, which trains nothing: the
 * exercise has to be losable to be worth winning.
 */
const MARGIN = 2;

/**
 * The three offers, in the order they are shown and picked.
 *
 * Label and multiplier live on the same record deliberately. Held in parallel
 * arrays, a reordering pairs "Cheap" with the doubled price — a bug that looks
 * entirely normal on screen and is only visible in the score.
 */
const OFFERS = [
  { id: 'cheap', label: 'Cheap', multiplier: 1 / MARGIN },
  { id: 'right', label: 'About right', multiplier: 1 },
  { id: 'steep', label: 'Steep', multiplier: MARGIN },
] as const;

const CHOICES = OFFERS.map(({ id, label }) => ({ id, label }));

/**
 * The rate to price an item at: held when the user has one, spot otherwise.
 *
 * Priced at spot while the page displays held, a "steep" offer could be the
 * real price the user just read elsewhere in the extension. The exercise must
 * agree with what the user is being shown or it is teaching a different rate
 * from the one they are learning.
 *
 * Anything unusable — no held coverage, a missing, zero, negative or NaN spot
 * quote — collapses to 0 and is rejected by the single `> 0` guard downstream.
 */
function rateFor(context: AskContext, currency: string): number {
  const code = currency.toUpperCase();
  return (context.held
    ? heldRateFor(context.held, context.rates, code)
    : context.rates.rates[code]) ?? 0;
}

/**
 * The fiat price as digits plus a code, never `Intl`'s currency style.
 *
 * An item can arrive from a page the user visited, carrying a code `Intl` does
 * not recognise, and `style: 'currency'` throws a RangeError on one. A thrown
 * error in the explanation would lose the answer the user has already earned.
 */
function fiat(amount: number, currency: string): string {
  const digits = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(amount);
  return `${digits} ${currency.toUpperCase()}`;
}

/** Labels are written as they are said ("a coffee"), so they start a sentence. */
function sentenceCase(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export const judgement: Mode = {
  id: 'judgement',
  title: 'Cheap or steep?',
  blurb: 'Judge a ZEC price with no fiat to translate from.',

  ask(context: AskContext): Question | null {
    // Price everything first, then keep only what came out as a real amount.
    // One guard covers three ways this can fail — an empty pool, a currency
    // with no usable rate, and an item that costs nothing (no offer can be
    // cheap or steep against zero) — and it fails by asking nothing. A mode
    // that cannot price an item honestly must not invent a plausible number:
    // the user is being trained on these figures.
    const priced = context.items
      .map((item) => ({ item, zec: item.amount * rateFor(context, item.currency) }))
      .filter((candidate) => candidate.zec > 0);
    if (priced.length === 0) return null;

    // Item first, offer second. Two draws rather than one over the product, so
    // that a caller's picker can pin either without controlling both.
    const { item, zec } = priced[context.pick(priced.length)];
    const offer = OFFERS[context.pick(OFFERS.length)];
    const offered = zec * offer.multiplier;
    const shown = formatZecWithSymbol(offered);

    return {
      mode: 'judgement',
      // The fiat price appears nowhere here. That omission IS the exercise:
      // leaking it — even as an aside, even in the item's label — turns the
      // question back into arithmetic and the mode stops testing anything.
      prompt: `${sentenceCase(item.label)} is ${shown}. Cheap, about right, or steep?`,
      emoji: item.emoji,
      // What was asked about, not just what was answered. Progress records a
      // miss against an item id and the pool resurfaces exactly those ids for
      // spaced repetition, so a question that omits this is a miss that can
      // never be re-asked — the repetition loop keeps running and stops
      // teaching anything, silently.
      itemId: item.id,
      input: 'choice',
      // A copy: the UI is free to sort or shuffle what it is handed, and doing
      // that to the shared constant would corrupt every later question.
      choices: [...CHOICES],
      answer: zec,
      correct: offer.id,
      // Now the exercise is over, so both units can be said. Naming the fiat
      // price is what ties the ZEC figure to an anchor the user already has —
      // withholding it here would leave them with a verdict and no lesson.
      explain: `${sentenceCase(item.label)} is about ${fiat(item.amount, item.currency)} — `
        + `${formatZecWithSymbol(zec)} at this rate. `
        + `The offer of ${shown} is ${offer.label.toLowerCase()}.`,
      // Banded by the real price, not the offer. The band records which
      // magnitudes the user handles well; the offer's size is our choice, so
      // banding by it would file a coffee under 'large' a third of the time.
      band: bandOf(zec),
    };
  },
};
