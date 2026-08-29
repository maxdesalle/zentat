import type { Mode } from '../types';
import { budget } from './budget';
import { comparison } from './comparison';
import { fromZec } from './from-zec';
import { judgement } from './judgement';
import { rateRecall } from './rate';
import { toZec } from './to-zec';

/**
 * Every way to practise, in the order they are offered.
 *
 * The order is a teaching order, not an alphabet. It runs from the mode that
 * leaves a translation available to the one that leaves none:
 *
 * - `to-zec` shows a price and asks for the other unit. Convertible thinking,
 *   and the gentle way in.
 * - `from-zec` reverses it, which is the direction a converted page actually
 *   demands: you read a ZEC figure and have to know what it buys.
 * - `comparison` drops the rate entirely. A ratio between two prices is the
 *   same ratio in either unit, so what it teaches survives ZEC moving 40%.
 * - `budget` puts the unit to work against the user's own obligations.
 * - `judgement` removes fiat from the screen altogether.
 * - `rate` is last because it trains the number rather than the intuition, and
 *   is only honest against a held rate.
 *
 * A mode that cannot ask returns null from `ask`, so an entry here is an offer,
 * never a promise — the caller falls through to the next one.
 */
export const MODES: Mode[] = [toZec, fromZec, comparison, budget, judgement, rateRecall];

export { budget, comparison, fromZec, judgement, rateRecall, toZec };
