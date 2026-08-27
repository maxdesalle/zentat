import { CURRENCY_CODES } from '../currencies';
import { AMBIGUOUS_SYMBOLS, resolveAmbiguousSymbol } from './locale';
import { CURRENCY_PATTERNS, type CurrencyPattern } from './patterns';

export interface ParsedPrice {
  original: string;
  amount: number;
  currency: string;
  startIndex: number;
  endIndex: number;
}

// Currencies whose conventional format uses "." as the decimal separator, so a
// single-digit integer part before ".ddd" reads as a decimal ($3.499 gas-style
// pricing), not a thousands separator.
const US_DECIMAL_CURRENCIES = new Set(['USD', 'GBP', 'CAD', 'AUD', 'MXN']);

// The same table as AMBIGUOUS_SYMBOLS, keyed so that a match carrying no symbol
// at all can be looked up without a guard in front of it: it simply is not in
// the map.
const AMBIGUITY_BY_SYMBOL = new Map<string | undefined, string[]>(
  Object.entries(AMBIGUOUS_SYMBOLS),
);

// The gas-style "$3.499" read is only safe on a page that writes decimals with
// a dot. "$1.500" on an es-AR page is 1500 pesos, and reading it as 1.5 is a
// 1000x error. Ask ICU rather than keeping a hand-list of locales — es-MX uses
// a dot while es-AR uses a comma, and a hand-list gets that wrong.
const decimalSepCache = new Map<string, string>();

function usesDotDecimal(lang: string | undefined): boolean {
  // A page that declares no language is read with a dot. We never let Intl
  // fall back to its default locale here: that is the machine's language, and
  // how the reader's own OS writes numbers says nothing about how this page
  // does — it would make one page read differently for two people.
  if (!lang) return true;
  let sep = decimalSepCache.get(lang);
  if (sep === undefined) {
    try {
      const parts = new Intl.NumberFormat(lang).formatToParts(1.1);
      // Indexing straight into the filtered parts on purpose: 1.1 has a
      // decimal part in every locale that constructs at all, and a locale that
      // does not construct throws from the line above. Either way the catch is
      // the only fallback this needs.
      sep = parts.filter((part) => part.type === 'decimal')[0].value;
    } catch {
      sep = '.';
    }
    decimalSepCache.set(lang, sep);
  }
  return sep === '.';
}

/**
 * Whether two matched spans cover any of the same characters.
 *
 * Exported and tested directly for the same reason as isBetterMatch: the
 * containment case cannot be produced through parsePrice with today's pattern
 * list, and it is the case that decides whether a wider match silently
 * duplicates a narrower one already in the results.
 */
export function overlaps(
  a: Pick<ParsedPrice, 'startIndex' | 'endIndex'>,
  b: Pick<ParsedPrice, 'startIndex' | 'endIndex'>,
): boolean {
  // Each span starts before the other ends. This covers containment in both
  // directions, and it treats spans that merely touch as disjoint: "$5$6" is
  // two prices, not one.
  return a.startIndex < b.endIndex && b.startIndex < a.endIndex;
}

/**
 * Which of two overlapping matches to keep: the one that starts earlier, and
 * on a tie the longer one.
 *
 * Exported and tested directly because the tie is not reachable through
 * parsePrice with today's pattern list — every pair that can overlap starts at
 * different offsets. That makes it exactly the rule most likely to be silently
 * wrong when the next pattern is added.
 */
export function isBetterMatch(
  candidate: Pick<ParsedPrice, 'startIndex' | 'endIndex'>,
  existing: Pick<ParsedPrice, 'startIndex' | 'endIndex'>,
): boolean {
  if (candidate.startIndex !== existing.startIndex) {
    // Stryker disable next-line EqualityOperator: the guard above has already
    // ruled out equal start offsets, so < and <= cannot disagree here.
    return candidate.startIndex < existing.startIndex;
  }
  return candidate.endIndex - candidate.startIndex > existing.endIndex - existing.startIndex;
}

/**
 * Whether an uppercase prefix immediately before this match claims the symbol
 * for a different currency: "NZ$" is not "$", and reading it as one is a
 * currency error on a page that told us exactly what it meant.
 *
 * Case matters, which is why this is here and not in the pattern: those are
 * compiled case-insensitively, so a lookbehind that excludes [A-Z] excludes
 * [a-z] with it — and then "Euro€672.33", where the symbol merely abuts a
 * word, matches nothing at all.
 */
const CLAIMING_PREFIX = /(?:NZ|HK|SG|CDN|CA|AU|MX|US|S|R|A|C)$/;

function symbolIsClaimedByPrefix(text: string, price: ParsedPrice): boolean {
  // Only a match that STARTS with its symbol can have one taken from it.
  if (/^[\d]/.test(price.original)) return false;
  return CLAIMING_PREFIX.test(text.slice(0, price.startIndex));
}

/**
 * Whether this match only found its symbol by ignoring case.
 *
 * "R$" is the Brazilian real and "r$" is the end of the word "Dollar" against
 * a dollar sign. The patterns cannot tell them apart — they are compiled with
 * the i flag so that currency CODES match however a page writes them — so the
 * distinction is drawn here, where the original text is still in hand.
 */
function matchedSymbolInWrongCase(pattern: CurrencyPattern, original: string): boolean {
  return pattern.symbols.some((symbol) =>
    /[A-Za-z]/.test(symbol)
    && original.toLowerCase().startsWith(symbol.toLowerCase())
    && !original.startsWith(symbol)
  );
}

/**
 * Every pattern the corpus and the fuzzer can reach, run unconditionally.
 *
 * This is the reference `parsePrice` is checked against, not a code path the
 * extension uses. The fast path skips patterns whose needles are absent, and a
 * needle list that is wrong in the unsafe direction would drop real prices
 * while every existing test stayed green — the exact failure this suite keeps
 * being burned by. So the equivalence is asserted directly, over the whole
 * fixture corpus, rather than reasoned about.
 */
export function parsePriceExhaustive(
  text: string,
  enabledCurrencies: string[],
  hostname?: string,
  documentLang?: string,
  pageCurrency?: string | null,
  inPriceContainer = false,
): ParsedPrice[] {
  return readPrices(
    CURRENCY_PATTERNS,
    text,
    enabledCurrencies,
    hostname,
    documentLang,
    pageCurrency,
    inPriceContainer,
  );
}

/**
 * Patterns worth running against a given host, in their declared order.
 *
 * The hostname test is per-pattern and per-call, and parsePrice is called
 * thousands of times per page with the same host — so the answer is worked out
 * once and kept. This changes no result: it applies the same predicate the loop
 * already applied, just earlier and fewer times.
 */
interface HostPatterns {
  /** Patterns needing currency evidence — the everyday case. */
  evidenced: CurrencyPattern[];
  /** Those plus the bare-number patterns, for inside a known price container. */
  all: CurrencyPattern[];
  /** Union of `evidenced` needles: text matching none of them holds no price. */
  gate: RegExp;
}

const hostPatterns = new Map<string, HostPatterns>();

function patternsFor(hostname?: string): HostPatterns {
  const key = hostname ?? '';
  const cached = hostPatterns.get(key);
  if (cached) return cached;

  const all = CURRENCY_PATTERNS.filter((pattern) =>
    !pattern.hostnames || !hostname
    || pattern.hostnames.some((h) => hostname === h || hostname.endsWith('.' + h))
  );
  const evidenced = all.filter((pattern) => !pattern.requiresPriceContainer);
  const needles = [...new Set(evidenced.flatMap((pattern) => pattern.needles))];
  const gate = new RegExp(
    needles.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'i',
  );

  const entry = { evidenced, all, gate };
  hostPatterns.set(key, entry);
  return entry;
}

/**
 * The literals a price on this host must contain — the union of every needle of
 * every pattern that can run there.
 *
 * Shared with the walker so "could this subtree hold a price at all" is asked
 * with exactly the same evidence the parser will demand of it, and cannot drift
 * from it.
 */
export function currencyEvidenceFor(hostname?: string): RegExp {
  return patternsFor(hostname).gate;
}

export function parsePrice(
  text: string,
  enabledCurrencies: string[],
  hostname?: string,
  documentLang?: string,
  /**
   * Currency the page states in its own structured data. Beats every guess we
   * would otherwise make from a symbol or a TLD — "$" on a geo-priced .com is
   * CAD roughly as often as it is USD.
   */
  pageCurrency?: string | null,
  /**
   * Whether the text came from an element a site adapter identified as a price
   * container. Patterns matching bare numbers only run when this is true.
   */
  inPriceContainer = false,
): ParsedPrice[] {
  const host = patternsFor(hostname);
  // Most text on a page is prose with no currency mark anywhere in it. One
  // alternation of literals answers that in a single native scan; without it,
  // every such string was run past all seventeen patterns, each carrying the
  // full number grammar. That was a flat ~43ms per page — the same cost on a
  // small page as on a large one, because it is paid per string, not per price.
  //
  // Inside a price container the bare-number patterns are live, and those match
  // text holding no evidence at all, so the gate does not apply.
  if (!inPriceContainer && !host.gate.test(text)) return [];

  // Which patterns can match THIS text, decided here rather than inside the
  // loop: readPrices has to stay the unfiltered reading, or parsePriceExhaustive
  // would apply the very filter it exists to check.
  const eligible = inPriceContainer ? host.all : host.evidenced;
  return readPrices(
    eligible.filter((pattern) => pattern.evidence.test(text)),
    text,
    enabledCurrencies,
    hostname,
    documentLang,
    pageCurrency,
    inPriceContainer,
  );
}

/**
 * The user's enabled currencies as an uppercase set, rebuilt only when the
 * settings array itself changes.
 *
 * Building it per call was a fixed cost paid thousands of times per page — a
 * flat ~22ms whatever the page held, because it depends on the settings and not
 * on the text being read. Keyed on identity, so a caller that builds a fresh
 * array each time is simply no worse off than before.
 */
let enabledCache: { source: string[]; set: Set<string> } | null = null;

function enabledSetFor(currencies: string[]): Set<string> {
  if (enabledCache !== null && enabledCache.source === currencies) return enabledCache.set;
  const set = new Set(currencies.map((c) => c.toUpperCase()));
  enabledCache = { source: currencies, set };
  return set;
}

function readPrices(
  patterns: CurrencyPattern[],
  text: string,
  enabledCurrencies: string[],
  hostname?: string,
  documentLang?: string,
  pageCurrency?: string | null,
  inPriceContainer = false,
): ParsedPrice[] {
  const results: ParsedPrice[] = [];
  const enabledSet = enabledSetFor(enabledCurrencies);

  for (const pattern of patterns) {
    // A bare-number pattern with no currency evidence needs positional
    // evidence instead, or it reads screen resolutions as prices.
    if (pattern.requiresPriceContainer && !inPriceContainer) continue;

    // Skip patterns restricted to specific hostnames
    if (pattern.hostnames && hostname) {
      const matchesHost = pattern.hostnames.some(
        (h) => hostname === h || hostname.endsWith('.' + h),
      );
      if (!matchesHost) continue;
    }

    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.regex.exec(text)) !== null) {
      const parsed = extractPriceFromMatch(match, pattern, hostname, documentLang);
      // Stryker disable next-line ConditionalExpression: extractPriceFromMatch
      // only returns null for matches no pattern in CURRENCY_PATTERNS can
      // produce (its own tests cover those), so this guard never sees one.
      if (parsed) {
        // Skip negative amounts (refunds, discounts): a minus sign directly
        // before the match — but not a range dash, which has a price/digit on
        // its left side ("£10–£20").
        if (isNegatedAt(text, parsed.price.startIndex)) continue;
        // "NZ$131,981" is not a plain dollar sign. The prefix names a currency
        // we may or may not hold a rate for, and either way this pattern is
        // not the one that should read it.
        // A symbol spelled with letters means its own case and no other.
        // These patterns are compiled case-insensitively, so BRL's "R$"
        // matched the "r$" inside "Canadian Dollar$1,087.47" and priced a
        // Canadian dollar figure in Brazilian reais — caught by the page
        // harness comparing what we rendered against what we said we read.
        if (matchedSymbolInWrongCase(pattern, parsed.price.original)) continue;

        // Only a MULTI-character symbol takes a prefix with it: "CA$19.49" is
        // CAD's own match and keeps its "CA", while "$131,981" out of
        // "NZ$131,981" is a bare dollar sign with someone else's letters in
        // front of it.
        const keepsItsPrefix = pattern.symbols.some((symbol) =>
          symbol.length > 1 && parsed.price.original.startsWith(symbol)
        );
        if (!keepsItsPrefix && symbolIsClaimedByPrefix(text, parsed.price)) continue;

        let currency = parsed.price.currency;
        // Undefined for every unambiguous symbol, and for a match that carried
        // no symbol at all.
        const candidates = AMBIGUITY_BY_SYMBOL.get(parsed.symbol);
        // An ambiguous symbol resolved by TLD is a guess; the page's own
        // declaration is not — but a declaration the symbol cannot mean is no
        // evidence at all, and "$" prices read as yen are off by 150x.
        const declared = candidates?.find((c) => c === pageCurrency);
        if (declared) currency = declared;

        // A code written immediately after the price is the most specific
        // claim on the page, and it was being thrown away. Airbnb quotes
        // "$1,257 CAD"; we took the glyph, read it as USD, and left the code
        // stranded beside the result, so the page read "1.61 ZEC CAD" — a
        // label contradicting both the unit and the value, at 35% over the
        // real price. Only a code the symbol could actually mean is believed,
        // so "$50 TRY IT NOW" is not a Turkish lira price.
        const trailing = trailingCurrencyCode(text, parsed.price.endIndex);
        const stated = trailing
            && (trailing.code === currency || candidates?.includes(trailing.code))
          ? trailing
          : null;

        if (stated) {
          // A code the user has not enabled is not licence to convert at some
          // other currency. It is a reason to leave the price alone.
          if (!enabledSet.has(stated.code)) continue;
          currency = stated.code;
        } else {
          // A currency we do not SUPPORT is not one the user merely switched
          // off. There is no rate behind it and no sibling that means the same
          // thing, so substituting another dollar is how a Chilean peso price
          // became a US dollar price — 950x too high, on all 214 prices of the
          // page. Refusing shows the user a gap they can see.
          if (!CURRENCY_CODES.includes(currency)) continue;
          // If the locale-resolved currency for an ambiguous symbol is
          // disabled, fall back to another enabled candidate for that symbol
          // instead of silently dropping the price (e.g. "$" resolved to MXN
          // on a .mx site while the user only enabled USD).
          if (!enabledSet.has(currency)) {
            currency = candidates?.find((c) => enabledSet.has(c)) ?? currency;
          }
          if (!enabledSet.has(currency)) continue;
        }

        // Swallowing the code is part of the fix, not tidying: left behind it
        // sits against our output as a currency label for a value in ZEC.
        const noCents = currency === 'EUR' ? trailingNoCentsMark(text, parsed.price.endIndex) : 0;
        const endIndex = parsed.price.endIndex + (stated?.length ?? 0) + noCents;
        const price = {
          ...parsed.price,
          currency,
          endIndex,
          original: stated || noCents
            ? text.slice(parsed.price.startIndex, endIndex).trim()
            : parsed.price.original,
        };

        // Check for overlap with existing results
        const overlapIndex = results.findIndex((r) => overlaps(price, r));

        if (overlapIndex === -1) {
          // No overlap, add new result
          results.push(price);
        } else if (isBetterMatch(price, results[overlapIndex])) {
          results[overlapIndex] = price;
        }
      }
    }
  }

  // Sort by position
  results.sort((a, b) => a.startIndex - b.startIndex);

  expandAbbreviatedRanges(results, text, documentLang);

  // No second dedup pass. There used to be one that collapsed matches sharing
  // the same ORIGINAL TEXT, which dropped legitimate repeats: "Buy 2 for
  // $19.99 or 1 for $19.99" converted only the first, leaving the second in
  // dollars right next to its converted twin. Its overlap half was dead code —
  // the loop above already resolves every overlap by position, using a strictly
  // wider rule — and its currency-preference half could only ever see matches
  // that loop had already collapsed.
  return results;
}

// An uppercase three-letter code standing on its own after a price. Case is
// not folded: "cad" in running prose is a word, not a currency label.
const TRAILING_CODE = /^[\s\u00a0]*([A-Z]{3})(?![A-Za-z])/;

function trailingCurrencyCode(
  text: string,
  endIndex: number,
): { code: string; length: number } | null {
  const match = TRAILING_CODE.exec(text.slice(endIndex));
  return match ? { code: match[1], length: match[0].length } : null;
}

/**
 * The Dutch and Belgian ",-" that closes a whole-euro price.
 *
 * It says "and no cents", so it belongs to the price and has to go with it.
 * The euro-sign pattern matched "€ 250" out of "€ 250,-" and stopped, leaving
 * the mark to sit against our output as "0,36 ZEC,-". Same reasoning as the
 * trailing currency code above: what is left behind reads as a label on a
 * value in ZEC.
 *
 * A digit after the dash means it is a minus sign on the next number, not this
 * price's ending.
 */
const TRAILING_NO_CENTS = /^[\s\u00a0]*,[\s\u00a0]*[-–—](?!\d)/;

function trailingNoCentsMark(text: string, endIndex: number): number {
  // Only where it means that: ",-" also ends prices in kroner and francs, and
  // this is reached with a currency already decided.
  const match = TRAILING_NO_CENTS.exec(text.slice(endIndex));
  return match ? match[0].length : 0;
}

// "$210–360": a range whose upper bound inherits the lower one's symbol. The
// bound must be bare digits — "– $360" is two prices and both patterns already
// find it.
const ABBREVIATED_RANGE = /^([\s\u00a0]*(?:[–—−-]|to(?=[\s\u00a0]))[\s\u00a0]*)(\d[\d.,]*)/;

// A bound followed by a multiplier belongs to a magnitude this cannot read off
// the lower bound ("$5-10 million"), so the range is refused rather than guessed.
const BOUND_MULTIPLIER =
  /^[\s\u00a0]*(?:[kmbt](?![a-z])|million|billion|trillion|thousand|mil|mn|bn)\b/i;

/**
 * Give an abbreviated range's upper bound the currency of its lower one.
 *
 * Converting only the lower bound is the worst available outcome: the upper
 * one is left bare, immediately beside our output, where it reads as ZEC.
 * Rome2Rio's "$210–360" rendered "0.269 ZEC–360", a range whose top looked
 * about 1,300 times its real value on a page that exists to compare costs.
 *
 * So both bounds convert or neither does. A bound this cannot read with the
 * lower one's convention takes the lower bound down with it — silence beats a
 * confident wrong number, and half a converted range is exactly that.
 *
 * Mutates in place: the caller owns the array and returns it.
 */
function expandAbbreviatedRanges(
  prices: ParsedPrice[],
  text: string,
  documentLang: string | undefined,
): void {
  for (let index = prices.length - 1; index >= 0; index--) {
    const price = prices[index];
    const tail = ABBREVIATED_RANGE.exec(text.slice(price.endIndex));
    if (!tail) continue;

    const startIndex = price.endIndex + tail[1].length;
    const endIndex = startIndex + tail[2].length;
    const preferUsDecimal = US_DECIMAL_CURRENCIES.has(price.currency)
      && usesDotDecimal(documentLang);
    const amount = BOUND_MULTIPLIER.test(text.slice(endIndex))
      ? null
      : parseNumber(tail[2], preferUsDecimal);

    if (amount === null) {
      prices.splice(index, 1);
      continue;
    }
    prices.splice(index + 1, 0, {
      original: tail[2],
      amount,
      currency: price.currency,
      startIndex,
      endIndex,
    });
  }
}

// A minus sign binds tightly to its number: "-$5" is negative, "Basic – $10" is
// a label separated from a price. Requiring adjacency is what separates the two
// — the earlier "nearest non-space character" rule swallowed every price in a
// pricing table, a bullet list, or any "label — price" line.
const MINUS_SIGNS = new Set(['-', '\u2212', '\u2013', '\u2014']);

function isNegatedAt(text: string, startIndex: number): boolean {
  // A price at index 0 has no character before it, and the set does not hold
  // undefined either.
  if (!MINUS_SIGNS.has(text[startIndex - 1])) return false;
  // A dash with a price on its left is a range ("£10-£20"), not a sign.
  return !/[\d$€£¥₩₹]$/.test(text.slice(0, startIndex - 1));
}

interface ExtractedPrice {
  price: ParsedPrice;
  symbol?: string;
}

/**
 * One regex match turned into a price, or null if the match does not carry a
 * number this can trust.
 *
 * Exported and tested directly for the same reason as overlaps: no pattern in
 * CURRENCY_PATTERNS can reach the null cases today, because every one of them
 * captures a run of digits. They are here for the next pattern that does not,
 * and what they stop is a price of NaN or zero rendered with exactly as much
 * confidence as a real one.
 */
export function extractPriceFromMatch(
  match: RegExpExecArray,
  pattern: CurrencyPattern,
  hostname?: string,
  documentLang?: string,
): ExtractedPrice | null {
  // The number alone when the pattern deliberately matched more than the price
  // — see readsPastThePrice. The rest of the match proved the currency; it did
  // not state the amount, and it belongs to the page.
  const whole = match[0];
  const priceText = pattern.readsPastThePrice
    ? match.slice(1).find((group) => group && /\d/.test(group)) ?? whole
    : whole;
  const original = priceText;
  const startIndex = match.index + whole.indexOf(priceText);
  const endIndex = startIndex + original.length;

  // Find the numeric parts from the match groups
  const numericGroups: string[] = [];
  let detectedSymbol: string | undefined;

  for (const group of match.slice(1)) {
    // Stryker disable next-line ConditionalExpression: a group that did not
    // take part is undefined, and neither test below matches the string
    // "undefined" — skipping it early only saves the work.
    if (!group) continue;
    if (/\d/.test(group)) {
      // Any numeric shape a pattern can capture: "149", "53,95", "1'299.00".
      numericGroups.push(group);
      continue;
    }
    // Stryker disable next-line ConditionalExpression: the only symbols
    // anything downstream treats as ambiguous are "$" and "¥", both inside
    // this class, so recording a currency CODE group here as if it were a
    // symbol would change no reading.
    if (/[$€£¥₩₹]/.test(group)) detectedSymbol = group;
  }

  if (numericGroups.length === 0) return null;

  // Handle bol.com "X euro en Y cent" format - two separate numeric groups
  let numStr: string;
  if (numericGroups.length === 2 && pattern.symbols.includes('euro')) {
    // Combine euros and cents: "149" + "95" -> "149.95"
    const euros = numericGroups[0];
    const cents = numericGroups[1].padStart(2, '0');
    numStr = `${euros}.${cents}`;
  } else {
    // Use the first numeric group (standard case)
    numStr = numericGroups[0];
  }

  const preferUsDecimal = US_DECIMAL_CURRENCIES.has(pattern.code) && usesDotDecimal(documentLang);
  const amount = parseNumber(numStr, preferUsDecimal);
  // A price of exactly zero is a real price ("$0.00 shipping"), so only a
  // failed read or a negative amount is rejected here. Negatives from a minus
  // sign on the page are rejected earlier, at isNegatedAt.
  if (amount === null || amount < 0) return null;

  // Resolve currency - use locale for ambiguous symbols
  let currency = pattern.code;
  if (detectedSymbol && hostname) {
    const resolved = resolveAmbiguousSymbol(detectedSymbol, hostname, documentLang);
    if (resolved) {
      currency = resolved;
    }
  }

  return {
    price: {
      original: original.trim(),
      amount,
      currency,
      startIndex,
      endIndex,
    },
    symbol: detectedSymbol,
  };
}

// Multipliers for k/m/b/t suffixes (both cases: the patterns are compiled with
// the 'i' flag, so lowercase b/t match too and must map correctly)
const SUFFIX_MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  K: 1_000,
  m: 1_000_000,
  M: 1_000_000,
  b: 1_000_000_000,
  B: 1_000_000_000,
  t: 1_000_000_000_000,
  T: 1_000_000_000_000,
};

// Spelled-out multipliers (multilingual), written as regex fragments so a
// compound can allow any run of whitespace between its words.
// Includes English, French, German, Dutch, Spanish, Portuguese, Italian.
//
// ORDER MATTERS. The first entry that matches the end of the string wins, so a
// compound has to sit ahead of the word that is its own tail: "5 hundred
// thousand" read as a plain "thousand" is 5,000 instead of 500,000.
const WORD_MULTIPLIERS: Record<string, number> = {
  // Hundred thousand (10^5)
  'hundred\\s+thousand': 100_000,
  // Thousand (10^3)
  thousand: 1_000,
  mille: 1_000, // FR, IT
  tausend: 1_000, // DE
  duizend: 1_000, // NL
  mil: 1_000, // ES, PT
  // Million (10^6)
  million: 1_000_000,
  millón: 1_000_000, // ES
  milhão: 1_000_000, // PT
  milione: 1_000_000, // IT
  miljoen: 1_000_000, // NL
  // Billion (10^9) - short scale
  billion: 1_000_000_000,
  milliard: 1_000_000_000, // FR, DE (long scale billion)
  miljard: 1_000_000_000, // NL
  miliardo: 1_000_000_000, // IT
  // Trillion (10^12)
  trillion: 1_000_000_000_000,
  bilhão: 1_000_000_000_000, // PT (can mean 10^12)
  biljoen: 1_000_000_000_000, // NL
};

const WORD_MULTIPLIER_ENTRIES = Object.entries(WORD_MULTIPLIERS);

export function parseNumber(str: string, preferUsDecimal: boolean = false): number | null {
  // No trim: every kind of space comes off a few lines down anyway.
  let cleaned = str;

  // Check for spelled-out multipliers first (e.g., "10 million", "5 hundred thousand")
  let multiplier = 1;
  for (const [word, mult] of WORD_MULTIPLIER_ENTRIES) {
    const wordPattern = new RegExp(`\\s*${word}\\s*$`, 'i');
    if (wordPattern.test(cleaned)) {
      multiplier = mult;
      // The word has to come off rather than being left for parseFloat to
      // ignore: "1,500 hundred thousand" still has to read its comma as
      // grouping, and it only can once the words are gone.
      cleaned = cleaned.replace(wordPattern, '');
      break;
    }
  }

  // Remove spaces (incl. non-breaking/narrow) and Swiss apostrophe separators
  cleaned = cleaned.replace(/[\s\u00A0\u202F'’]/g, '');

  // Check for and extract suffix multiplier (k, K, m, M, b, B, t, T)
  const lastChar = cleaned.slice(-1);
  if (SUFFIX_MULTIPLIERS[lastChar]) {
    multiplier *= SUFFIX_MULTIPLIERS[lastChar];
    cleaned = cleaned.slice(0, -1);
  }

  const commaCount = (cleaned.match(/,/g) || []).length;
  const dotCount = (cleaned.match(/\./g) || []).length;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  // Two or more commas means every comma is a thousands separator, whatever
  // else is in the string: US grouping ("150,000,000"), Indian lakh grouping
  // ("1,00,000"), and either of them with a decimal dot ("1,234,567.89").
  if (commaCount > 1) {
    cleaned = cleaned.replace(/,/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num * multiplier;
  }

  // Multiple dots with no comma = EU thousand separators only (e.g., "150.000.000").
  // The comma test is what keeps "1.234.567,89" out of here, where stripping
  // the dots would leave parseFloat to stop dead at the comma.
  if (dotCount > 1 && commaCount === 0) {
    cleaned = cleaned.replace(/\./g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num * multiplier;
  }

  // Handle ambiguous single-separator cases like "1,234" or "1.234"
  // If exactly one separator with exactly 3 digits after it, it's usually a
  // thousand separator — EXCEPT for a dot in a US-decimal currency with a
  // single-digit integer part ("$3.499" gas-style pricing), which reads as a
  // decimal rather than $3,499. A redundant trailing zero rules that out:
  // pump prices never end in one, so "$1.500" is EU-formatted 1500.
  if (commaCount + dotCount === 1) {
    const sepIndex = Math.max(lastComma, lastDot);
    const afterSep = cleaned.slice(sepIndex + 1);
    // Anchored at both ends: "1.2345" is four decimals, not a grouped 12,345.
    if (/^\d{3}$/.test(afterSep)) {
      // A multiplier already carries the magnitude, so what precedes it is a
      // mantissa — nothing writes a thousands group inside one. "$29.121B"
      // read as grouping was 29,121 billion, a thousandfold over.
      //
      // Only a multiplier beats the integer-length shape test. A DECLARED
      // language does not, though it looks like it should: fotocasa.es says
      // lang="en" and writes "23.199 €" for 23,199 euros, while cnbc-markets
      // also says "en" and writes "912.524" as a genuine three-decimal quote.
      // Same declaration, opposite conventions. Telling those apart needs the
      // document's own grouping evidence — xe.com writes "1,000 USD" in the
      // same breath as "429.109 EUR" — and that is a real feature, not a
      // condition to bolt on here.
      //
      // The trailing zero rules both readings out: pump prices never end in a
      // redundant one, so "$1.500" is 1500 however the rest reads, and that is
      // what keeps a German "1.500 Millionen" out of here.
      const isUsDecimalRead = cleaned[sepIndex] === '.'
        && !afterSep.endsWith('0')
        && (multiplier !== 1 || (preferUsDecimal && sepIndex <= 1));
      if (!isUsDecimalRead) {
        // Single separator with 3 digits = thousand separator
        cleaned = cleaned.replace(/[,.]/, '');
        const num = parseFloat(cleaned);
        return isNaN(num) ? null : num * multiplier;
      }
    }
  }

  // Detect format: 1,234.56 (US) vs 1.234,56 (EU)
  // Stryker disable next-line EqualityOperator: the two indexes are equal only
  // when both are -1, and with no separator at all either branch is a no-op.
  if (lastComma > lastDot) {
    // EU format: 1.234,56 -> remove dots, replace comma with dot
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // US format: 1,234.56 -> remove commas
    cleaned = cleaned.replace(/,/g, '');
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num * multiplier;
}
