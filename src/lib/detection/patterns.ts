export interface CurrencyPattern {
  code: string;
  symbols: string[];
  // Pattern matches: symbol/code + number or number + symbol/code
  // Group 1: optional prefix symbol
  // Group 2: the number (with optional decimals and thousand separators)
  // Group 3: optional suffix symbol/code
  regex: RegExp;
  // Optional: restrict this pattern to specific hostnames
  hostnames?: string[];
  /**
   * Only run inside an element the site adapter marked as a price container.
   * Set on any pattern that matches a bare number with no currency evidence.
   */
  requiresPriceContainer?: boolean;
  /**
   * Substrings this pattern cannot match without. Text holding none of them is
   * skipped before the expensive scan runs.
   *
   * These are not a heuristic — each is a literal the regex REQUIRES. Every
   * alternative buildPattern emits contains either one of the symbols it was
   * built from or the currency code, and each hand-written pattern names the
   * character it is anchored on. Declaring MORE needles than the regex needs is
   * harmless (the pattern merely runs when it need not); declaring fewer would
   * silently drop prices, so `parsePriceExhaustive` exists to prove it doesn't.
   */
  needles: string[];
  /** `needles` compiled to one alternation. Built once, below. */
  evidence: RegExp;
}

// Number pattern: 1,234.56 or 1.234,56 or 1234.56 or 69k or 2.5M or 150B or 2T
// Supports k/K (thousand), m/M (million), b/B (billion), t/T (trillion) suffixes
// Also supports spelled-out multipliers in multiple languages
// First alternation handles Indian lakh/crore grouping (1,00,000), the second
// requires thousand separators (+ not *), the third handles plain numbers
// Ordered longest-first and bounded with \b so e.g. "miljoen" is never
// captured as its prefix "mil" (which would be off by a factor of 1000)
const MULTIPLIER_WORDS =
  'thousand|trillion|milliard|miliardo|miljard|milione|millón|milhão|miljoen|biljoen|bilhão|billion|million|tausend|duizend|mille|mil';
const NUM_SUFFIX = String
  .raw`[kKmMbBtT]?(?:[\s\u00A0]+(?:hundred[\s\u00A0]+)?(?:${MULTIPLIER_WORDS})\b)?`;
// The (?!\d) after the group run stops a thousands read from ending mid-number:
// without it "0.00595" matched as "0.005" and stranded "95" in the DOM.
// Group separator: comma, dot, space, non-breaking/narrow space, and the Swiss
// apostrophes ' and ’ (CHF 1'299.00). Deliberately excludes \n and \t so a
// price and an unrelated number on the next line never join into one amount.
const SEP = String.raw`[,.'’ \u00A0\u202F]`;
const INDIAN_NUM = String.raw`\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d{1,2})?`;
const NUM = String
  .raw`(${INDIAN_NUM}${NUM_SUFFIX}|\d{1,3}(?:${SEP}\d{3})+(?!\d)(?:[.,]\d{1,8})?${NUM_SUFFIX}|\d+(?:[.,]\d{1,8})?${NUM_SUFFIX})`;

// All currency symbols for negative lookahead
const ALL_SYMBOLS = '[$€£¥₩₹]';

// Build currency patterns
function buildPattern(symbols: string[], code: string): RegExp {
  const escapedSymbols = symbols.map((s) => escapeRegex(s)).join('|');
  // Match patterns:
  // 1. optional CODE + symbol + number: EUR €1,299.00, $19.99 (captures "EUR €" together to avoid leaving "EUR" behind)
  // 2. number + symbol: 1 299,00 €, 19.99$
  // 3. CODE + number: USD 19.99, EUR 1299 (but NOT "EUR €300" where symbol follows)
  // 4. number + CODE: 19.99 USD, 1299 EUR
  // Note: Pattern 3 uses negative lookahead to avoid matching "EUR €300,000" where the symbol-based pattern should take precedence
  // The lookbehind is load-bearing: without it the bare "$" pattern matches
  // inside "NZ$50", "HK$50" and "S$50" and reports them as US dollars. Those
  // are currencies this extension does not support, and a NZ$ price shown as
  // USD is off by about 65% — stated confidently. Refusing to read a dollar
  // sign that some other letter is claiming is the only safe answer; showing
  // nothing is a gap the user can see, showing USD is one they cannot.
  //
  // It guards the START of the alternative rather than the symbol itself, so
  // "EUR€300" still matches through the code prefix.
  //
  // The letter guard has moved out of this regex and into parsePrice, because
  // these patterns are compiled case-insensitively and a lookbehind cannot
  // tell "NZ$" from "…o€". Blocking every letter cost coinmarketcap's whole
  // rate table, which renders "ZEC/EUREuro€672.33" — the € sits against the
  // "o" of "Euro", and nothing matched at all. See symbolIsClaimedByPrefix.
  const pattern = String
    .raw`(?:(?:\b${code}\b\s*)?(${escapedSymbols})\s*${NUM}|${NUM}\s*(${escapedSymbols})|(?:^|\s)\b(${code})\b\s*(?!${ALL_SYMBOLS})${NUM}|${NUM}\s*\b(${code})\b)`;
  return new RegExp(pattern, 'gi');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// European price format: "339,-" or "1.299,-" (whole number with ,- suffix)
// Handles whitespace/newlines between parts: "339 , -" or "339\n,\n-"
// Matches regular hyphen (U+002D), EN DASH (U+2013), and EM DASH (U+2014)
const EUR_DASH_PATTERN = /(\d{1,3}(?:\.\d{3})*)\s*,\s*[-–—]/g;

// Dutch/Belgian format: "247,11 excl. btw" or "247,11 incl. btw"
const EUR_BTW_PATTERN = /(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s*(?:excl|incl)\.?\s*btw/gi;

// Dutch format: "149 euro" or "'149' euro" or "'149' euro en '00' cent" (bol.com)
// Captures full bol.com accessibility format with optional cents part
const EUR_WORD_PATTERN =
  /['"]?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)['"]?\s*euro(?:\s+en\s+['"]?(\d{1,2})['"]?\s*cent)?/gi;

// Bol.com decimal format: "149,00" or "53,95" (plain decimal, no symbol)
// Only safe on bol.com where we know all prices are EUR
// Bare-number patterns are a false-positive generator by construction: a
// number with no currency evidence is as likely to be a screen resolution, a
// battery capacity or a clock speed as a price. A hostname allowlist does not
// change that — it only says WHICH page the wrong answer appears on.
//
// So these are marked, and the walker requires positional evidence before
// running them: the element must sit inside something the site's adapter has
// identified as a price container. That replaces "trust every number on this
// host" with "trust numbers in these nodes on this host", which is the actual
// claim we can support.
const BOL_DECIMAL_PATTERN = /\b(\d{1,3}(?:\.\d{3})*,\d{2})\b/g;

// Coolblue whole number format: "1.349" or "899" (no decimal, uses . as thousand separator)
// Often the ",-" suffix is in a separate HTML element
const COOLBLUE_WHOLE_PATTERN = /\b(\d{1,3}(?:\.\d{3})+)\b/g;

// Sites that use EUR with regional price formats (no € symbol)
const EUR_REGIONAL_SITES = [
  'coolblue.nl',
  'coolblue.be',
  'bol.com',
  'mediamarkt.nl',
  'mediamarkt.be',
];

const PATTERN_SOURCES: Array<Omit<CurrencyPattern, 'evidence'>> = [
  {
    code: 'USD',
    symbols: ['$', 'US$'],
    regex: buildPattern(['$', 'US$'], 'USD'),
    needles: ['$', 'USD'],
  },
  { code: 'EUR', symbols: ['€'], regex: buildPattern(['€'], 'EUR'), needles: ['€', 'EUR'] },
  // European ",-" format (e.g., "339,-" on Dutch/Belgian EUR sites)
  // Restricted to known EUR sites since ",-" is also used for DKK, NOK, CHF, etc.
  {
    code: 'EUR',
    symbols: [',-'],
    regex: EUR_DASH_PATTERN,
    hostnames: EUR_REGIONAL_SITES,
    needles: [','],
  },
  // Dutch/Belgian "excl. btw" / "incl. btw" format
  {
    code: 'EUR',
    symbols: ['btw'],
    regex: EUR_BTW_PATTERN,
    hostnames: EUR_REGIONAL_SITES,
    needles: ['btw'],
  },
  // Dutch "euro" word format (e.g., "149 euro", "53,95 euro")
  {
    code: 'EUR',
    symbols: ['euro'],
    regex: EUR_WORD_PATTERN,
    hostnames: EUR_REGIONAL_SITES,
    needles: ['euro'],
  },
  // Bol.com plain decimal format (e.g., "149,00", "53,95") - very restricted
  {
    code: 'EUR',
    symbols: [],
    regex: BOL_DECIMAL_PATTERN,
    hostnames: ['bol.com'],
    requiresPriceContainer: true,
    needles: [','],
  },
  // Coolblue whole number format (e.g., "1.349", "899") - thousand separator with no decimal
  {
    code: 'EUR',
    symbols: [],
    regex: COOLBLUE_WHOLE_PATTERN,
    requiresPriceContainer: true,
    hostnames: ['coolblue.nl', 'coolblue.be'],
    needles: ['.'],
  },
  { code: 'GBP', symbols: ['£'], regex: buildPattern(['£'], 'GBP'), needles: ['£', 'GBP'] },
  {
    code: 'JPY',
    symbols: ['¥', '円'],
    regex: buildPattern(['¥', '円'], 'JPY'),
    needles: ['¥', '円', 'JPY'],
  },
  // CDN$ is Steam's notation, and Steam is not a small corner of the web. Its
  // absence meant a Canadian user got ZERO conversions on a store page: 13
  // prices, none of them read. Nothing failed, because nothing in the suite
  // could fail for a price we never looked at.
  {
    code: 'CAD',
    symbols: ['C$', 'CA$', 'CDN$'],
    regex: buildPattern(['C$', 'CA$', 'CDN$'], 'CAD'),
    // The whole symbol, not the dollar sign inside it. Needles are matched
    // case-insensitively, the way the pattern is compiled, so "c$" is covered.
    // Listing a bare "$" here would be safe but ruinous: it made every dollar
    // price on the page run this grammar, and the four dollar currencies below
    // it, for text only USD could ever match.
    needles: ['C$', 'CA$', 'CDN$', 'CAD'],
  },
  {
    code: 'AUD',
    symbols: ['A$', 'AU$'],
    regex: buildPattern(['A$', 'AU$'], 'AUD'),
    needles: ['A$', 'AU$', 'AUD'],
  },
  {
    code: 'CHF',
    symbols: ['Fr.', 'CHF'],
    regex: buildPattern(['Fr.', 'CHF'], 'CHF'),
    needles: ['Fr.', 'CHF'],
  },
  // Declared symbols are a superset of the two this regex was built from, which
  // is the safe direction: an extra needle costs a scan, a missing one costs a
  // price.
  {
    code: 'CNY',
    symbols: ['¥', '元', 'CN¥'],
    regex: buildPattern(['CN¥', '元'], 'CNY'),
    needles: ['¥', '元', 'CNY'],
  },
  { code: 'KRW', symbols: ['₩'], regex: buildPattern(['₩'], 'KRW'), needles: ['₩', 'KRW'] },
  { code: 'INR', symbols: ['₹'], regex: buildPattern(['₹'], 'INR'), needles: ['₹', 'INR'] },
  { code: 'BRL', symbols: ['R$'], regex: buildPattern(['R$'], 'BRL'), needles: ['R$', 'BRL'] },
  { code: 'MXN', symbols: ['MX$'], regex: buildPattern(['MX$'], 'MXN'), needles: ['MX$', 'MXN'] },
];

export const CURRENCY_PATTERNS: CurrencyPattern[] = PATTERN_SOURCES.map((pattern) => ({
  ...pattern,
  evidence: new RegExp(pattern.needles.map(escapeRegex).join('|'), 'i'),
}));

// Simple combined pattern for quick detection
// Requires digit after currency symbol to avoid matching cashtags like $BTC
// Includes European formats: ",-", "btw", "euro", decimal prices, k/m/M/B/T suffixes, and spelled-out multipliers
// Note: [\s\u00A0] includes non-breaking space for French number formatting
// Also matches European thousand-separator format like "1.349" (used on Coolblue)
// Multilingual multiplier words: EN, FR, DE, NL, ES, PT, IT
// Note: \d.*btw requires a number before "btw" to avoid matching labels like "BTW (V.A.T.)"
export const QUICK_DETECT_PATTERN =
  /[$€£¥₩₹][\s\u00A0]*\d|\d[\s\u00A0]*[$€£¥₩₹]|(?:USD|EUR|GBP|JPY|CAD|AUD|CHF|CNY|KRW|INR|BRL|MXN)\b|\d,-|\d[.,\s\u00A0]*(?:excl|incl)\.?\s*btw\b|\beuro\b|\d,\d{2}\b|\d\.\d{3}\b|\d[kKmMbBtT]\b|\d[\s\u00A0]+(?:hundred[\s\u00A0]+)?(?:thousand|million|billion|trillion|mille|tausend|duizend|mil|millón|milhão|milione|miljoen|milliard|miljard|miliardo|bilhão|biljoen)\b/i;
