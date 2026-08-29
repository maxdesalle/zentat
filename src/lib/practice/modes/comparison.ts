import { formatCount } from '../../anchors';
import { formatZecWithSymbol } from '../../conversion/format';
import { heldRateFor } from '../../rates/held';
import { type AskContext, bandOf, type Mode, type PracticeItem, type Question } from '../types';

/**
 * Ratio and comparison — the only thing here that keeps its value.
 *
 * A remembered level ("a coffee is 0.005 ZEC") is worth exactly as much as the
 * rate it was learned at, and this unit moves 8% overnight. A ratio does not
 * move at all: every price converts at the SAME rate, so the rate cancels and
 * "a laptop is about four tanks of fuel" is as true after a 40% swing as
 * before. That is the same invariant the anchors feature rests on, asked as a
 * question instead of rendered on a page.
 *
 * Two shapes, because they train opposite directions. "Which is more, this ZEC
 * amount or a tank of fuel?" makes the user place a ZEC figure against
 * something they already price, which is what a converted page demands of them.
 * "How many coffees is a laptop?" drops the rate entirely and drills the
 * ratio itself.
 */

/**
 * How far apart two prices must be before "which is more" has a knowable
 * answer. Inside a factor of two the question stops testing magnitude
 * judgement and starts testing whether the user has memorised two catalogue
 * prices to the pound — and since the ZEC side is rendered coarse (two
 * significant figures), a near-tie can be a genuine coin flip that we would
 * then score as a mistake. A wrong price is worse than no price; a rigged
 * question is worse than no question.
 */
const MIN_CHOICE_RATIO = 2;

/**
 * The range in which a ratio teaches something.
 *
 * Below two, "about 1.3 coffees" is a rounding error wearing a lesson's
 * clothes. Above a thousand the answer stops being a felt ratio and becomes
 * long division — nobody holds "2,250 coffees" as a quantity, they compute it.
 * (Rendering such a count is a lighter task than producing one from memory,
 * which is why anchors.ts tolerates up to 5,000 and this does not.)
 */
const MIN_TEACHING_RATIO = 2;
const MAX_TEACHING_RATIO = 1000;

/** A price we can actually do arithmetic with. */
function usable(amount: number): boolean {
  return Number.isFinite(amount) && amount > 0;
}

/**
 * An item's price in ZEC, valued in its OWN currency rather than the user's:
 * a pool can mix a catalogue item priced in USD with one seen on a EUR page,
 * and converting both through one code would silently misprice the pair by the
 * fiat cross.
 */
function zecValue(item: PracticeItem, context: AskContext): number | null {
  // The pages are showing the held rate, so a question asked at spot would be
  // marking the user wrong against a number the product never displayed. A
  // held rate answers null for a currency it cannot carry and the spot map
  // answers undefined for one nobody quoted; both land on 0 and fail below.
  const rate = (context.held
    ? heldRateFor(context.held, context.rates, item.currency)
    : context.rates.rates[item.currency.toUpperCase()]) ?? 0;
  if (!(rate > 0)) return null;

  const value = item.amount * rate;
  // A 'seen' item's price was parsed off a page, so a runaway magnitude is
  // reachable input rather than a hypothetical — and Infinity would render as
  // a real-looking question with no answer.
  return usable(value) ? value : null;
}

/** "≈0.42 ZEC" — coarse on purpose; the mode asks for judgement, not digits. */
function zec(amount: number): string {
  return formatZecWithSymbol(amount, 'coarse');
}

/**
 * "Which is more: ≈2 ZEC, or a coffee?"
 *
 * The item behind the ZEC figure is never named — naming it would turn the
 * question into a memory test for that one price.
 */
function askWhichIsMore(
  hidden: PracticeItem,
  named: PracticeItem,
  context: AskContext,
): Question | null {
  const hiddenZec = zecValue(hidden, context);
  const namedZec = zecValue(named, context);
  // Unlike the ratio shape, this one genuinely needs a rate: there is no ZEC
  // amount to show without one, and inventing a plausible figure is the exact
  // failure this product refuses.
  if (hiddenZec === null || namedZec === null) return null;

  const ratio = Math.max(hiddenZec, namedZec) / Math.min(hiddenZec, namedZec);
  // Refuse rather than redraw. Redrawing inside the mode burns the caller's
  // draws in a loop it cannot see, and spins forever on a pool where every
  // pair is close; the caller already handles null by asking again.
  if (ratio < MIN_CHOICE_RATIO) return null;

  const zecWins = hiddenZec > namedZec;
  return {
    mode: 'comparison',
    prompt: `Which is more: ${zec(hiddenZec)}, or ${named.label}?`,
    emoji: named.emoji,
    input: 'choice',
    choices: [
      { id: 'zec', label: zec(hiddenZec) },
      { id: 'item', label: named.label },
    ],
    // Unused by choice scoring, but the band and any later review read it, and
    // a zero here would look like a free item rather than an absent number.
    answer: hiddenZec,
    // The NAMED item, not the hidden one: what the user was actually asked to
    // price is the thing on the page, and that is the id spaced repetition has
    // to bring back after a miss.
    itemId: named.id,
    correct: zecWins ? 'zec' : 'item',
    explain: `${named.label} is ${zec(namedZec)} at today's rate, ${
      zecWins ? 'less' : 'more'
    } than ${zec(hiddenZec)}.`,
    band: bandOf(hiddenZec),
  };
}

/**
 * "How many times the price of a coffee does a laptop cost?"
 *
 * No rate is consulted anywhere in here, and that is the point rather than an
 * economy: the ratio of two fiat prices IS the ratio of their ZEC prices,
 * because both legs convert at the same rate and it cancels. So this shape
 * keeps asking through a dead provider, a stale cache, or a currency nobody
 * quotes — the one question that is always answerable is also the one whose
 * answer does not expire.
 */
function askHowMany(a: PracticeItem, b: PracticeItem, context: AskContext): Question | null {
  // Two currencies only cancel against each other through a fiat cross, and
  // reaching for one would reintroduce precisely the rate dependence that
  // makes this shape worth asking.
  if (a.currency.toUpperCase() !== b.currency.toUpperCase()) return null;
  if (!usable(a.amount) || !usable(b.amount)) return null;

  const [dear, cheap] = a.amount >= b.amount ? [a, b] : [b, a];
  const ratio = dear.amount / cheap.amount;
  if (ratio < MIN_TEACHING_RATIO || ratio > MAX_TEACHING_RATIO) return null;

  const code = dear.currency.toUpperCase();
  const dearZec = zecValue(dear, context);
  return {
    mode: 'comparison',
    // The labels carry their own article ("a coffee", "a month of rent"), so
    // "how many coffees" cannot be built without pluralising them, and naive
    // pluralisation turns "a month of rent" into "month of rents". Phrase the
    // question around the article instead of fighting it.
    prompt: `How many times the price of ${cheap.label} does ${dear.label} cost?`,
    emoji: dear.emoji,
    input: 'number',
    answer: ratio,
    // The dearer item is the price under test — the cheaper one is the ruler,
    // and re-asking someone about the ruler is not the practice they missed.
    itemId: dear.id,
    explain: `${dear.label} is ${formatCount(dear.amount)} ${code} and ${cheap.label} is `
      + `${formatCount(cheap.amount)} ${code}, so about ${formatCount(ratio)}×. `
      + `That ratio is the same in ZEC, and stays the same when the rate moves.`,
    // Bands exist to say WHICH magnitudes the user is weak at, which needs a
    // ZEC figure. Without a rate there is none, so the question goes in the
    // middle bucket: mis-filing a few ratio questions costs less than
    // declining to ask the only questions a dead rate still permits.
    band: dearZec === null ? 'everyday' : bandOf(dearZec),
  };
}

export const comparison: Mode = {
  id: 'comparison',
  title: 'Comparison',
  blurb: 'Price things against each other — the part that survives a move in the rate.',

  ask(context: AskContext): Question | null {
    const { items, pick } = context;
    if (items.length < 2) return null;

    const shape = pick(2);
    const first = pick(items.length);
    // Draw the second from the remaining items and step over the first, so the
    // two are never the same item. Rejecting a collision and redrawing instead
    // would loop unboundedly on a two-item pool.
    const offset = pick(items.length - 1);
    const a = items[first];
    const b = items[offset >= first ? offset + 1 : offset];

    return shape === 0 ? askWhichIsMore(a, b, context) : askHowMany(a, b, context);
  },
};
