import { formatZecWithSymbol } from '../../conversion/format';
import { heldRateFor } from '../../rates/held';
import { type AskContext, bandOf, type ItemSource, type Mode, type Question } from '../types';

/**
 * "How many ZEC is that?" — the direction a converted page already shows.
 *
 * There are two shapes here, because the obvious one trains the wrong thing.
 * Showing the item AND its price — "a coffee — $4.00" — leaves nothing to
 * recall: the user multiplies a number in front of them by a rate they were
 * just told, which is arithmetic practice wearing a unit-of-account costume.
 * It is kept anyway, and kept first, because it is the gentle way in: someone
 * who has never held a ZEC price in their head needs one occasion where the
 * only unknown is the mapping itself.
 *
 * The second shape withholds the price. "a coffee. How many ZEC?" forces the
 * user to recall what a coffee costs and THEN place it, which is exactly what
 * reading a converted page demands of them — the page never hands over the
 * fiat figure, it replaces it. Two lookups chained, no crutch. That is the
 * skill; the first shape is the ramp.
 */

/**
 * Whether the fiat price may be withheld.
 *
 * The withheld shape is only fair when the user can be expected to produce the
 * price from memory. A `seen` item is a price they happened to walk past on
 * some page — $47.31 for one specific thing on one specific day. Asking them to
 * recall it is not a harder question, it is an unanswerable one, and an
 * unanswerable question scores as ignorance rather than as a missing fact.
 *
 * Every other source is a price the user can produce unaided: a catalogue entry
 * is the typical price of an everyday thing, an anchor is one they chose
 * themselves, and a liability is one they pay every month. The last two are not
 * *widely* known, which does not matter — what the exercise needs is that the
 * one person being asked knows it, and about their own rent they know it better
 * than any catalogue average.
 */
function priceIsRecallable(source: ItemSource): boolean {
  return source !== 'seen';
}

/**
 * The rate to convert an item at, or 0 when there is no rate we can vouch for.
 *
 * The item's OWN currency, not the currency the user thinks in. A liability
 * denominated in EUR converted at the USD rate is a confidently wrong number,
 * and the whole product rests on never producing one of those.
 */
function rateFor(context: AskContext, currency: string): number {
  // A held rate answers null for a currency it cannot carry, and a spot lookup
  // answers undefined for one nobody quoted. `?? 0` folds both into the single
  // positivity check at the call site, which also catches a zero, negative or
  // NaN feed. A rate we cannot vouch for must produce no question at all,
  // never a plausible-looking wrong one.
  return (context.held
    ? heldRateFor(context.held, context.rates, currency)
    : context.rates.rates[currency.toUpperCase()]) ?? 0;
}

/**
 * The item's price as its own currency would write it. Locale is left to the
 * runtime rather than pinned, so a German user reads "4,00 $" and not a decimal
 * point they would parse as a thousands separator.
 */
function formatFiat(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount);
}

export const toZec: Mode = {
  id: 'to-zec',
  title: 'Fiat → ZEC',
  blurb: 'Put a ZEC number on an everyday thing before you are shown one.',

  ask(context: AskContext): Question | null {
    // An item priced at zero (or at no number at all) yields an answer of zero,
    // and scoreGuess refuses a non-positive answer — the question would not be
    // hard, it would be unscoreable. Drop those before the draw so one broken
    // item costs the user a turn instead of the whole pool.
    const pool = context.items.filter((item) => item.amount > 0);
    if (pool.length === 0) return null;

    const item = pool[context.pick(pool.length)];

    const rate = rateFor(context, item.currency);
    if (!(rate > 0)) return null;

    const answer = item.amount * rate;
    const fiat = formatFiat(item.amount, item.currency);
    // Short-circuit deliberately: an item whose price cannot be recalled never
    // spends a draw on a coin flip whose outcome is already decided.
    const withhold = priceIsRecallable(item.source) && context.pick(2) === 1;

    return {
      mode: 'to-zec',
      // Progress records a miss against an item id and the pool resurfaces
      // exactly those ids later. A question that will not say what it asked
      // about is a miss that can never be re-asked, which turns the spaced
      // repetition loop into an expensive no-op.
      itemId: item.id,
      // The emoji rides in its own field, so it is not repeated in the prompt —
      // the UI renders both and would otherwise show the coffee cup twice.
      prompt: withhold
        ? `${item.label}. How many ZEC?`
        : `${item.label} — ${fiat}. How many ZEC?`,
      emoji: item.emoji,
      input: 'number',
      answer,
      // Both units, always — including in the withheld shape, where the fiat
      // figure is itself part of the answer the user was reaching for.
      explain: `${item.label} at ${fiat} is ${formatZecWithSymbol(answer)}.`,
      band: bandOf(answer),
    };
  },
};
