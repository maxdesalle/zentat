import type { Category, PracticeItem } from './types';

/**
 * Prices the user has actually met, and nothing about where they met them.
 *
 * Practising against a catalogue teaches the catalogue. What builds a unit is
 * placing the prices already in your week — your usual order, your groceries,
 * the thing you nearly bought — so this keeps the prices the extension has
 * converted for you and feeds them back as practice material.
 *
 * Built carelessly that is a browsing history, sitting on disk, on a machine
 * belonging to someone with a real threat model, written by an extension that
 * runs on every page they open. The safeguard here is the SHAPE of the record
 * rather than a promise about how it is used: an entry has room for a label, an
 * amount and a currency, and there is no field a hostname, a URL, a page title
 * or a clock reading could be written into, so a later caller cannot add one
 * without changing this type and reading this comment. Anything whose label
 * reads like a locator rather than a name is refused outright, and the store
 * stops at {@link MAX_SEEN} entries. Nothing here records time at any
 * resolution, which is what makes "when did they browse" unanswerable from the
 * file rather than merely impolite to ask.
 *
 * One residual, stated because PRIVACY.md has to be literally true of the code:
 * array order says which of two prices was met first. It survives because a
 * ring buffer needs an order to evict by. It is blunted where it can be — a
 * price met again is not re-appended, so revisiting does not refresh its
 * position — and it carries no time, no site and no count, which is the
 * distance between "these two were met in this order" and a history.
 *
 * The feature is opt-in and off unless the user turns it on; the toggle and the
 * storage live outside this module, which is pure.
 */
export interface SeenPrice {
  /** How the user would say it: "flat white", "the blue mug". Never a locator. */
  label: string;
  amount: number;
  /** An ISO 4217 code, upper-case. */
  currency: string;
}

/**
 * The hard ceiling on the store.
 *
 * Small enough that the file stays a handful of prices rather than a record of
 * what someone shops for, large enough that practice does not repeat. An
 * uncapped store would grow for years and become exactly the artifact this
 * module is written to not create.
 */
export const MAX_SEEN = 200;

/** What is kept of a label. Longer than this is a sentence, not a name. */
const MAX_LABEL = 40;

/**
 * What is even considered. A string this long is a page title or a description
 * of the user, and truncating it would silently keep the first
 * {@link MAX_LABEL} characters of one. Refusing is the only safe reading.
 */
const MAX_RAW_LABEL = 120;

/**
 * Shapes that mean the caller handed us a locator, not a name.
 *
 * Each rule is here because the corresponding mistake writes the user's
 * browsing into the store: a caller that reaches for `document.title`, an `alt`
 * text holding a CDN path, a receipt line carrying an order number. The bias is
 * deliberately toward refusing — a wrongly refused label costs one practice
 * question, a wrongly kept one costs the user the thing this extension exists
 * to protect.
 */
const CARRIES_MORE_THAN_A_NAME: RegExp[] = [
  // A dot between word characters: a hostname, a domain, a file name.
  /[a-z0-9-]\.[a-z]{2}/i,
  // A URL scheme, which a dotless host like "http://localhost" has anyway.
  /:\/\//,
  // An email address or a social handle.
  /@/,
  // An order, account, card or customer number. Model names ("WH-1000XM5") run
  // to four digits; six is past anything a product is called.
  /\d{6,}/,
];

/**
 * A seen price is not classified, and pretending otherwise would be worse than
 * leaving it unclassified. Every practice item needs a category; guessing one
 * from a label would file a keyboard under `food` often enough that
 * per-category progress would report on our guess rather than on the user.
 * `source: 'seen'` is how a caller tells these apart from catalogue items,
 * where the category is actually known.
 */
const SEEN_CATEGORY: Category = 'services';

/** A price tag: the item is one the user met, not one we chose for them. */
const SEEN_EMOJI = '🏷️';

/** The identity of an entry: same content, same key, wherever it sits. */
function keyOf(price: SeenPrice): string {
  // JSON rather than a joined string, because every separator character can
  // legitimately appear inside a label: "a 1" joined on a space is the same
  // key as "a" at 1, so the two would dedupe against each other and share
  // one id. Quoting makes the encoding one-to-one.
  return JSON.stringify([price.label, price.amount, price.currency]);
}

/**
 * The one gate into the store.
 *
 * Both entry points run everything through here, so a store loaded from disk
 * gets the same scrutiny as a fresh call: settings written by an older build,
 * or edited by hand, must not be able to put a URL in front of the user under
 * the guise of a coffee.
 */
function sanitise(price: SeenPrice): SeenPrice | null {
  // A non-string label is corrupt storage, not a name. Coercing it would store
  // the string "undefined" as a perfectly valid-looking product.
  if (typeof price.label !== 'string') return null;
  if (price.label.length > MAX_RAW_LABEL) return null;
  // Checked against the RAW label, before truncation: a locator hiding past
  // character 40 must still refuse the whole entry, or the cut merely hides it.
  if (CARRIES_MORE_THAN_A_NAME.some((pattern) => pattern.test(price.label))) return null;

  const label = price.label.replace(/\s+/gu, ' ').trim().slice(0, MAX_LABEL);
  if (label === '') return null;

  // Number.isFinite also rejects a string that happens to look like a number,
  // which `> 0` alone lets through and every later multiply then trusts.
  if (!Number.isFinite(price.amount) || !(price.amount > 0)) return null;

  // Three letters and nothing else, so the currency field cannot become a
  // second place to smuggle text into the store.
  if (!/^[a-z]{3}$/i.test(price.currency)) return null;

  return { label, amount: price.amount, currency: price.currency.toUpperCase() };
}

/**
 * Add a price to the store, or hand the store back unchanged.
 *
 * Refusal is silent and total: no partial record, no "we kept the amount",
 * nothing written at all for an entry we would not vouch for.
 */
export function remember(store: SeenPrice[], price: SeenPrice): SeenPrice[] {
  const clean = sanitise(price);
  if (clean === null) return store;

  // A price met again is not moved to the end. Re-appending would make position
  // track recency, sharpening the one ordering signal the store cannot avoid
  // having at all.
  const key = keyOf(clean);
  if (store.some((entry) => keyOf(entry) === key)) return store;

  // Slicing from the end also trims a store that arrived over the cap, which is
  // what a store written before MAX_SEEN was lowered looks like.
  return [...store, clean].slice(-MAX_SEEN);
}

/**
 * The store as practice material.
 *
 * Ids are derived from content rather than from position, because eviction
 * shifts every position: an index-based id would silently re-point a recorded
 * answer at a different price the first time the cap bit.
 */
export function seenItems(store: SeenPrice[]): PracticeItem[] {
  const items: PracticeItem[] = [];
  for (const entry of store) {
    const clean = sanitise(entry);
    // A stored entry that no longer passes the gate is dropped rather than
    // asked about. Practising against a price we cannot vouch for teaches a
    // wrong number, which is the one failure this product cannot have.
    if (clean === null) continue;
    items.push({
      id: `seen-${idOf(clean)}`,
      label: clean.label,
      emoji: SEEN_EMOJI,
      amount: clean.amount,
      currency: clean.currency,
      category: SEEN_CATEGORY,
      source: 'seen',
    });
  }
  return items;
}

/** FNV-1a over the entry's key: stable across runs, with no clock and no randomness. */
function idOf(price: SeenPrice): string {
  const key = keyOf(price);
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    // imul keeps the multiply in 32 bits; a plain `*` loses the low bits to
    // float rounding and collapses distinct labels onto one id.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Empty the store.
 *
 * A fresh array every time, never a shared constant: one caller mutating a
 * shared empty would repopulate everybody else's "cleared" store, which is the
 * kind of clear that is worse than no clear at all.
 */
export function clearSeen(): SeenPrice[] {
  return [];
}
