import { type HeldRate, heldRateFor } from './rates/held';
import type { RatesData } from './storage/rates';

/**
 * Recurring obligations, denominated in ZEC.
 *
 * This is the most load-bearing feature in the product, and the ordering is not
 * a matter of taste. Hayek's adoption sequence runs invoices → wages →
 * contracts → books, with retail price tags LAST — people think in the unit
 * their obligations live in, not the unit their shopping is tagged in. In
 * *Choice in Currency* the mechanism is explicit: what converts an economy is
 * "the willingness to hold different kinds of money" and the tendency of
 * business and capital transactions "to base calculations and accounting on"
 * a trusted unit, while everyday retail keeps using whatever it always did.
 *
 * So converting shop prices is the on-ramp. Until rent, salary and
 * subscriptions exist in ZEC, no amount of converted checkout pages makes it
 * the user's unit.
 */

export type Cadence = 'monthly' | 'yearly' | 'weekly';

export interface Liability {
  id: string;
  label: string;
  /** What it costs, in the currency the obligation is actually denominated in. */
  amount: number;
  currency: string;
  cadence: Cadence;
  /** Positive for money coming in (salary), negative for money going out. */
  direction: 'in' | 'out';
  /** ZEC cost when first entered, so drift is visible over time. */
  zecWhenSet: number;
  addedAt: number;
}

export const MAX_LIABILITIES = 12;

const PER_MONTH: Record<Cadence, number> = {
  weekly: 52 / 12,
  monthly: 1,
  yearly: 1 / 12,
};

/** A liability's cost in ZEC now, at the display rate. */
export function liabilityZec(
  liability: Liability,
  rates: RatesData,
  held?: HeldRate | null,
): number | null {
  const rate = held
    ? heldRateFor(held, rates, liability.currency)
    : rates.rates[liability.currency.toUpperCase()];
  if (!rate || !(rate > 0) || !(liability.amount > 0)) return null;
  const value = liability.amount * rate;
  return Number.isFinite(value) ? value : null;
}

export interface MonthlyPosition {
  incoming: number;
  outgoing: number;
  /** Incoming minus outgoing, in ZEC per month. */
  net: number;
  /** Liabilities that could not be priced, so the total is honest about gaps. */
  unpriced: string[];
}

/**
 * The user's month, in ZEC.
 *
 * Everything is normalised to a monthly figure because that is the period
 * people actually budget in, and because mixing weekly and yearly numbers in
 * one list is the fastest way to make a total meaningless.
 */
export function monthlyPosition(
  liabilities: Liability[],
  rates: RatesData,
  held?: HeldRate | null,
): MonthlyPosition {
  let incoming = 0;
  let outgoing = 0;
  const unpriced: string[] = [];

  for (const liability of liabilities) {
    const zec = liabilityZec(liability, rates, held);
    if (zec === null) {
      unpriced.push(liability.label);
      continue;
    }
    const monthly = zec * PER_MONTH[liability.cadence];
    if (liability.direction === 'in') incoming += monthly;
    else outgoing += monthly;
  }

  return { incoming, outgoing, net: incoming - outgoing, unpriced };
}

export function createLiability(
  label: string,
  amount: number,
  currency: string,
  cadence: Cadence,
  direction: 'in' | 'out',
  rates: RatesData,
  held?: HeldRate | null,
): Liability | null {
  const trimmed = label.trim();
  if (!trimmed || !(amount > 0)) return null;

  const draft = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    label: trimmed.slice(0, 32),
    amount,
    currency: currency.toUpperCase(),
    cadence,
    direction,
    zecWhenSet: 0,
    addedAt: Date.now(),
  };

  const zec = liabilityZec(draft, rates, held);
  if (zec === null) return null;
  return { ...draft, zecWhenSet: zec };
}
