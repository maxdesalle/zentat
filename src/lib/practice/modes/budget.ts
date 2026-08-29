import { formatZecWithSymbol } from '../../conversion/format';
import { type Liability, type MonthlyPosition, monthlyPosition } from '../../liabilities';
import { heldRateFor } from '../../rates/held';
import { type AskContext, bandOf, type Mode, type PracticeItem, type Question } from '../types';

/**
 * Budgeting in ZEC.
 *
 * The closest thing to actually living in the unit, and the only mode that asks
 * about the user's own money rather than a catalogue's. lib/liabilities.ts
 * argues the sequence: obligations convert before price tags, because people
 * think in the unit their rent is denominated in. This is the practice that
 * corresponds to that claim.
 *
 * So every question here does its arithmetic INSIDE ZEC — subtracting one ZEC
 * amount from another, dividing a price by a monthly obligation — rather than
 * translating a fiat price out of it. Translation is what the other modes
 * train; a unit of account is what is left when translation stops.
 *
 * Nothing is invented. Every number comes from what the user entered, and a
 * mode that made up a salary in order to have something to ask about would be
 * lying to someone about their own money — worse than staying silent, because
 * the lie is in the one place they would trust us most.
 */

/** A question shape, given the context and the month it implies. */
type Shape = (context: AskContext, position: MonthlyPosition) => Question | null;

/** Obligations named before the list is cut short. */
const MAX_NAMED = 3;

/**
 * Name a few obligations in prose.
 *
 * Cut off, because twelve liabilities of thirty-two characters is a four-line
 * prompt, and a prompt nobody finishes reading is a question nobody answers.
 * The count of the rest still appears, so the sentence never implies the list
 * is complete.
 */
function listLabels(labels: string[]): string {
  const shown = labels.slice(0, MAX_NAMED);
  if (labels.length > shown.length) shown.push(`${labels.length - shown.length} more`);
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/**
 * An item's price in ZEC, or null if it cannot be priced honestly.
 *
 * A held rate answers null for a currency it cannot carry and a spot lookup
 * answers undefined for one nobody quoted; both are worth exactly as much as a
 * rate of zero, so one guard covers all three. The finiteness check catches the
 * other end: an anchor is user-entered, and a large enough amount multiplied by
 * a rate overflows to Infinity, which renders as "∞ ZEC" and would be scored
 * against as though it were a price.
 */
function itemZec(item: PracticeItem, context: AskContext): number | null {
  const rate = (context.held
    ? heldRateFor(context.held, context.rates, item.currency)
    : context.rates.rates[item.currency.toUpperCase()]) ?? 0;
  if (!(rate > 0)) return null;
  const value = item.amount * rate;
  if (!(value > 0) || !Number.isFinite(value)) return null;
  return value;
}

/**
 * One item the question can quote, with its price.
 *
 * Unpriceable items are filtered out BEFORE the pick rather than after, because
 * skipping to a different item is not a lie — the pool is a pool. Liabilities
 * get the opposite treatment below: dropping one of those silently changes the
 * answer to a question about the user's own month.
 */
function pickItem(context: AskContext): { item: PracticeItem; zec: number } | null {
  const priced: { item: PracticeItem; zec: number }[] = [];
  for (const item of context.items) {
    const zec = itemZec(item, context);
    if (zec !== null) priced.push({ item, zec });
  }
  if (priced.length === 0) return null;
  return priced[context.pick(priced.length)];
}

/**
 * What one obligation costs per month, in ZEC.
 *
 * Normalising the cadence here by hand would duplicate the weekly/yearly table
 * in lib/liabilities.ts, and a second copy is how a weekly obligation ends up
 * counted once a month. A one-element position reuses that arithmetic exactly,
 * and carries the same `unpriced` honesty check the totals get.
 */
function monthlyOutgoing(liability: Liability, context: AskContext): number | null {
  const single = monthlyPosition([liability], context.rates, context.held);
  if (single.unpriced.length > 0) return null;
  return single.outgoing;
}

function pricedOutgoings(context: AskContext): { liability: Liability; monthly: number }[] {
  const found: { liability: Liability; monthly: number }[] = [];
  for (const liability of context.liabilities) {
    if (liability.direction !== 'out') continue;
    const monthly = monthlyOutgoing(liability, context);
    if (monthly === null) continue;
    found.push({ liability, monthly });
  }
  return found;
}

/**
 * "Your month leaves you N ZEC. Can you afford this?"
 *
 * The one question in the product where the ZEC figure is a budget rather than
 * a price, which is the whole difference between a currency someone converts
 * and one they hold.
 */
const affordable: Shape = (context, position) => {
  // An unpriced obligation makes the net an understatement of what the month
  // costs, so "leaves you N" would be too generous by exactly the amount we
  // could not see. A question with a wrong premise is worse than no question.
  if (position.unpriced.length > 0) return null;
  // Nothing left over means nothing to ask about, and a negative net has no
  // honest yes/no answer beyond "no, and you knew that".
  if (!(position.net > 0)) return null;

  const chosen = pickItem(context);
  if (chosen === null) return null;

  // Spending the whole surplus is affording it. The user is being asked about
  // arithmetic, not prudence.
  const fits = chosen.zec <= position.net;
  const net = formatZecWithSymbol(position.net);
  const price = formatZecWithSymbol(chosen.zec);

  return {
    mode: 'budget',
    prompt: `Your month leaves you ${net}. Can you afford ${chosen.item.label} at ${price}?`,
    emoji: chosen.item.emoji,
    itemId: chosen.item.id,
    input: 'choice',
    choices: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
    answer: chosen.zec,
    correct: fits ? 'yes' : 'no',
    explain: fits
      ? `${price} out of ${net} leaves ${formatZecWithSymbol(position.net - chosen.zec)}.`
      : `${price} is more than the ${net} your month leaves.`,
    band: bandOf(chosen.zec),
  };
};

/**
 * "How many months of rent is that?"
 *
 * Pricing one obligation in terms of another is what people do natively in
 * their own currency and cannot yet do in ZEC. No fiat figure appears at all.
 */
const monthsOf: Shape = (context) => {
  const outgoings = pricedOutgoings(context);
  // Only obligations that are actually paid out can be a yardstick; a salary
  // measured in months of itself says nothing.
  if (outgoings.length === 0) return null;

  const { liability, monthly } = outgoings[context.pick(outgoings.length)];
  const chosen = pickItem(context);
  if (chosen === null) return null;

  // `answer` is a count of months rather than a ZEC amount, which the field's
  // name does not say. Scoring is relative error and therefore unit-free, so
  // this is sound; the band below still comes from the ZEC figure, because a
  // ratio has no magnitude to practise.
  const months = chosen.zec / monthly;
  const price = formatZecWithSymbol(chosen.zec);
  const each = formatZecWithSymbol(monthly);

  return {
    mode: 'budget',
    prompt: `${price} buys ${chosen.item.label}. How many months of ${liability.label} is that?`,
    emoji: chosen.item.emoji,
    itemId: chosen.item.id,
    input: 'number',
    answer: months,
    // Two significant figures: the rate behind both numbers is honest to ±10%,
    // so "0.88888 months" claims a precision neither side of the ratio has.
    explain: `${liability.label} is ${each} a month, so ${price} is ${
      Number(months.toPrecision(2))
    } months of it.`,
    band: bandOf(chosen.zec),
  };
};

/**
 * "What is left?"
 *
 * The month as a single subtraction, in ZEC on both sides. This is the number
 * a person actually needs to hold in their head to use the unit for anything.
 */
const whatIsLeft: Shape = (context, position) => {
  // Same reason as in `affordable`, and it bites harder here: the net IS the
  // answer, so an obligation we could not price is a wrong answer, not just a
  // wrong premise.
  if (position.unpriced.length > 0) return null;
  // Nothing going out makes this "what is your salary", which asks for recall
  // rather than arithmetic. A net at or below zero cannot be scored at all —
  // scoreGuess refuses a non-positive answer — so it must not be asked.
  if (!(position.outgoing > 0) || !(position.net > 0)) return null;

  // Every liability is priced at this point, so the outgoing labels can be read
  // straight off the list without pricing them a second time.
  const labels = context.liabilities
    .filter((liability) => liability.direction === 'out')
    .map((liability) => liability.label);
  const incoming = formatZecWithSymbol(position.incoming);
  const outgoing = formatZecWithSymbol(position.outgoing);

  return {
    mode: 'budget',
    // Opens with a figure rather than a label so a lower-case obligation name
    // never has to start the sentence.
    prompt: `You take in ${incoming} a month, and ${listLabels(labels)} take ${outgoing}.`
      + ' What is left?',
    // No itemId, deliberately. Progress records a miss against an item id and
    // the pool resurfaces exactly those ids, so an id here would queue the
    // user's own rent as something to practise — and there is no item in this
    // question to re-ask them about.
    emoji: '🧾',
    input: 'number',
    answer: position.net,
    explain: `${incoming} in, ${outgoing} out, ${formatZecWithSymbol(position.net)} left.`,
    band: bandOf(position.net),
  };
};

const SHAPES: Shape[] = [affordable, monthsOf, whatIsLeft];

export const budget: Mode = {
  id: 'budget',
  title: 'Budget',
  blurb: 'Your own month in ZEC: what it leaves, and what that leaves room for.',
  ask(context) {
    // Without obligations there is no month to ask about, and the alternative —
    // a plausible invented salary — would teach the user a budget that is not
    // theirs. Silence is the honest answer.
    if (context.liabilities.length === 0) return null;

    const position = monthlyPosition(context.liabilities, context.rates, context.held);
    // A shape the data cannot support returns null rather than falling through
    // to another: a mode that always finds something to ask drifts back to the
    // easiest shape, and the user practises only that one.
    return SHAPES[context.pick(SHAPES.length)](context, position);
  },
};
