/**
 * What there is to practise, and what to ask next.
 *
 * Two separate jobs, kept apart because they fail differently. Building the
 * pool is about honesty — an item that cannot be priced must never reach a
 * question. Choosing is about pacing — the old training drew uniformly from
 * eleven items and excluded only the one just asked, so a repeat arrived every
 * third or fourth question and the session felt like a loop rather than
 * practice. Recognition is not recall: once the user remembers the answer to
 * "a coffee" from four questions ago, the question stops teaching anything.
 */
import type { Anchor } from '../anchors';
import type { Cadence, Liability } from '../liabilities';
import type { Category, Picker, PracticeItem } from './types';

/**
 * How many recently-asked ids to steer away from.
 *
 * A practice session is a dozen or so questions, so twelve is the span over
 * which a person actually notices repetition — and with any real pool it means
 * every item gets a turn before any item gets a second one. It is a ceiling,
 * not a requirement: `chooseItem` falls back to the whole pool rather than
 * refusing to ask, so a user with five items still gets questions.
 */
export const MAX_RECENT = 12;

/**
 * Extra draws a due item gets on top of its own.
 *
 * Three tickets instead of one, not exclusivity. Practising only what you get
 * wrong turns the session into a punishment loop and never re-confirms the
 * items you had right — which is how a skill quietly decays while the score
 * says it is improving.
 */
const DUE_EXTRA_TICKETS = 2;

/**
 * Anchors and liabilities carry no category, and the list has no "other".
 * `services` is the closest thing to unclassified in a fixed set, so it is used
 * as an admission of ignorance rather than a claim: nothing may present the
 * category of a user-supplied item as a fact about it.
 */
const UNKNOWN_CATEGORY: Category = 'services';

/** How a cadence is said aloud in front of the label. */
const CADENCE_PREFIX: Record<Cadence, string> = {
  weekly: 'a week of',
  monthly: 'a month of',
  yearly: 'a year of',
};

export interface PoolSources {
  /** Generic, typical prices. The fallback when the user has told us nothing. */
  catalogue: PracticeItem[];
  anchors: Anchor[];
  liabilities: Liability[];
  /** Prices the user actually met on a page, already shaped as items. */
  seen: PracticeItem[];
}

export interface ChooseOptions {
  pick: Picker;
  /** Ids asked lately, in the order asked, oldest first. */
  recent: string[];
  /** Ids the user has recently answered badly. */
  due: string[];
}

/**
 * An amount that can honestly become a question.
 *
 * Zero, negative and NaN all come from real records — a half-entered liability,
 * a corrupted anchor — and every one of them scores as `null`, which reaches
 * the user as a question that cannot be answered. The finite check is the one
 * that is not redundant: `Infinity > 0` is true.
 */
function usableAmount(amount: number): boolean {
  return Number.isFinite(amount) && amount > 0;
}

/**
 * Ids are namespaced by source because the id spaces are unrelated: an anchor's
 * id is generated, a catalogue id is a hand-written word like `coffee`, and
 * nothing stops the two from colliding. A collision would silently drop the
 * user's own item in favour of a generic one — the exact opposite of the
 * ordering this module exists to enforce.
 */
function fromAnchor(anchor: Anchor): PracticeItem {
  return {
    id: `anchor:${anchor.id}`,
    label: anchor.label,
    emoji: '⚓',
    amount: anchor.amount,
    // Rates are keyed upper-case; a legacy record stored lower-case would look
    // like a currency nobody quotes and produce no question at all.
    currency: anchor.currency.toUpperCase(),
    category: UNKNOWN_CATEGORY,
    source: 'anchor',
  };
}

/**
 * A liability's amount is one period's worth, so the label has to say which
 * period. "rent" asked against a weekly figure is a 4x error the user has no
 * way to spot, and being wrong by 4x is worse than not asking.
 */
function fromLiability(liability: Liability): PracticeItem {
  return {
    id: `liability:${liability.id}`,
    label: `${CADENCE_PREFIX[liability.cadence]} ${liability.label}`,
    // Money arriving reads differently from money leaving, and the two want
    // different intuitions: what a salary buys, versus what a bill costs.
    emoji: liability.direction === 'in' ? '💰' : '🧾',
    amount: liability.amount,
    currency: liability.currency.toUpperCase(),
    category: UNKNOWN_CATEGORY,
    source: 'liability',
  };
}

/**
 * Everything worth asking about, the user's own prices first.
 *
 * The ordering is the point: a price you actually pay every month teaches more
 * than a generic coffee, because it is already a number you hold in your head.
 * Callers that truncate the pool truncate the catalogue tail, never the user.
 */
export function buildPool(sources: PoolSources): PracticeItem[] {
  const ordered = [
    ...sources.anchors.map(fromAnchor),
    ...sources.liabilities.map(fromLiability),
    ...sources.seen,
    ...sources.catalogue,
  ];

  const pool: PracticeItem[] = [];
  const taken = new Set<string>();
  for (const item of ordered) {
    if (taken.has(item.id)) continue;
    // Checked after the dedup, and deliberately not recorded as taken: a broken
    // copy of an item must not shadow a good one later in the list.
    if (!usableAmount(item.amount)) continue;
    taken.add(item.id);
    pool.push(item);
  }
  return pool;
}

/**
 * The next thing to ask, or null when there is nothing to ask about.
 *
 * Null means an empty pool and nothing else. Every other awkward case — more
 * recent ids than items, a pool that is entirely due, a picker that answers out
 * of range — still yields a question, because a practice page that refuses to
 * ask is indistinguishable from a broken one.
 */
export function chooseItem(pool: PracticeItem[], options: ChooseOptions): PracticeItem | null {
  if (pool.length === 0) return null;

  // Only the tail is honoured. A caller that hands over the whole session
  // history would otherwise exclude every item and fall back to the full pool,
  // quietly restoring the repetition this is here to prevent.
  const avoid = new Set(options.recent.slice(-MAX_RECENT));
  const fresh = pool.filter((item) => !avoid.has(item.id));
  const candidates = fresh.length > 0 ? fresh : pool;

  const due = new Set(options.due);
  const weighted = [...candidates];
  for (const item of candidates) {
    if (!due.has(item.id)) continue;
    for (let ticket = 0; ticket < DUE_EXTRA_TICKETS; ticket += 1) weighted.push(item);
  }

  // The picker is injected, so its arithmetic is somebody else's. Clamping is
  // what keeps the "null only for an empty pool" promise true: an index past
  // the end would hand back `undefined` and render as a blank question.
  const index = Math.min(
    Math.max(Math.trunc(options.pick(weighted.length)), 0),
    weighted.length - 1,
  );
  return weighted[index];
}
