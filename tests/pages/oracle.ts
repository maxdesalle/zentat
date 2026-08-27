// An independent reading of a price, written to disagree with src/.
//
// Every converted span carries the text it replaced, in its tooltip. That is
// the extension stating what it read. This module reads the same text a second
// time, with its own rules, and checks that the ZEC on screen follows from it.
//
// The point is the independence. tests/pages/visible.ts already catches prices
// we never LOOKED at; nothing catches a price we looked at and got wrong,
// because the harness's other checks all ask whether our output is
// self-consistent. It is perfectly self-consistent to render $200 as two
// dollars' worth, which is what Cloudflare shipped.
//
// It refuses far more than it reads. Every genuinely ambiguous shape returns
// null rather than a guess: a wrong oracle is worse than no oracle, because it
// costs the suite its credibility on exactly the cases that matter. What
// survives is the large, boring majority, which is where regressions hide.

/** Currency codes a glyph can denote, ordered by nothing in particular. */
const GLYPH_CURRENCIES: Record<string, string[]> = {
  '£': ['GBP'],
  '€': ['EUR'],
  '₩': ['KRW'],
  '₹': ['INR'],
  '¥': ['JPY', 'CNY'],
  $: ['USD', 'CAD', 'AUD', 'MXN'],
};

/** Prefixes that settle a dollar outright. Longest first: CDN$ before C$. */
const DOLLAR_PREFIXES: Array<[string, string]> = [
  ['CDN$', 'CAD'],
  ['CA$', 'CAD'],
  ['AU$', 'AUD'],
  ['MX$', 'MXN'],
  ['US$', 'USD'],
  ['R$', 'BRL'],
  ['C$', 'CAD'],
  ['A$', 'AUD'],
];

const ISO = /\b(USD|EUR|GBP|JPY|CAD|AUD|CHF|CNY|KRW|INR|BRL|MXN)\b/;

/**
 * Which currencies this text could denote, or null if it names none.
 *
 * A written code is decisive: "$1,257 CAD" is Canadian whatever the glyph
 * suggests, and reading it as USD was a 35% error on Airbnb.
 */
export function plausibleCurrencies(text: string): string[] | null {
  const iso = ISO.exec(text.toUpperCase());
  if (iso) return [iso[1]];
  for (const [prefix, code] of DOLLAR_PREFIXES) {
    if (text.includes(prefix)) return [code];
  }
  for (const [glyph, codes] of Object.entries(GLYPH_CURRENCIES)) {
    if (text.includes(glyph)) return codes;
  }
  return null;
}

/**
 * The number this text states, or null where the notation is genuinely
 * ambiguous.
 *
 * The one case refused outright is a lone separator with exactly three digits
 * after it: "1.500" is fifteen hundred in Berlin and one and a half in Boston,
 * and no rule available here settles it. That is precisely the shape the
 * project's own parser needs heuristics for, so an oracle that guessed would
 * be asserting its guess against theirs.
 */
/**
 * The multiplier this text carries, spelled out or suffixed.
 *
 * Stripping it silently is how the first version of this oracle read
 * "$18 billion" as eighteen and then accused the extension of a billionfold
 * error. An oracle that is wrong on the loud cases is worse than none.
 */
function multiplierIn(text: string): number {
  // Directly after the digits, or it belongs to something else: in
  // "$0.30 / million requests" the million counts requests, not dollars, and
  // treating it as a multiplier accused a correct conversion of being a
  // millionfold off.
  const word = /\d[\s\u00a0]*(thousand|million|billion|trillion)\b/i.exec(text);
  if (word) {
    return { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 }[
      word[1].toLowerCase() as 'thousand' | 'million' | 'billion' | 'trillion'
    ];
  }
  // A bare letter directly after the digits, not the start of a word.
  // Case-insensitive: pages write "$19.9b" as readily as "$19.9B". The
  // hyphen in the lookahead keeps "$5 T-shirt" from becoming five trillion.
  const suffix = /\d\s*([KMBT])(?![A-Za-z-])/i.exec(text);
  if (suffix) {
    return { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[suffix[1].toUpperCase() as 'K' | 'M' | 'B' | 'T'];
  }
  return 1;
}

export function readAmount(text: string): number | null {
  const scale = multiplierIn(text);
  const cleaned = text.replace(/[^\d.,]/g, '');
  if (!/\d/.test(cleaned)) return null;

  const commas = (cleaned.match(/,/g) ?? []).length;
  const dots = (cleaned.match(/\./g) ?? []).length;

  if (commas > 0 && dots > 0) {
    // Whichever comes last is the decimal point; the other is grouping.
    const decimal = cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.') ? ',' : '.';
    const grouping = decimal === ',' ? '.' : ',';
    const value = Number(cleaned.split(grouping).join('').replace(decimal, '.'));
    return Number.isFinite(value) ? value * scale : null;
  }

  if (commas + dots === 0) {
    const value = Number(cleaned);
    return Number.isFinite(value) ? value * scale : null;
  }

  if (commas + dots > 1) {
    // Repeated separators are grouping: "1.234.567" and "1,234,567" alike.
    const value = Number(cleaned.replace(/[.,]/g, ''));
    return Number.isFinite(value) ? value * scale : null;
  }

  const separator = commas === 1 ? ',' : '.';
  const after = cleaned.slice(cleaned.lastIndexOf(separator) + 1);
  // Three digits after a lone separator is the one shape no rule here can
  // settle: "1.500" is fifteen hundred in Berlin and one and a half in Boston.
  // UNLESS a multiplier follows, because nothing writes a thousands group
  // inside a mantissa that already carries an explicit "B" — "$29.121B" is
  // 29.121 billion in every convention there is. That is a fact about notation
  // rather than a rule borrowed from the parser, so the oracle may know it,
  // and knowing it is what lets this catch a thousandfold error rather than
  // shrug at one.
  if (after.length === 3 && scale === 1) return null;
  const value = Number(cleaned.replace(separator, '.'));
  return Number.isFinite(value) ? value * scale : null;
}

/**
 * The ZEC figure this rendering shows, with the slack its own rounding allows.
 *
 * The tolerance is half a unit in the last place it actually printed, which is
 * the most precision the rendering claims. A fixed percentage cannot work: a
 * price rendered "0.01 ZEC" on a page whose grid is two decimals is honestly
 * a third away from its exact value, while one rendered "0.002564 ZEC" is not
 * — and the second is the hundredfold error this exists to catch.
 */
export function readRenderedZec(text: string): { value: number; tolerance: number } | null {
  const match = /(-?[\d.,]+)\s*([KMBT])?\s*ZEC/i.exec(text);
  if (!match) return null;
  // OUR output, not the page's — so the ambiguity readAmount refuses does not
  // arise. Intl formatted this, and the harness renders in en-US: the comma
  // groups and the dot is the decimal point. Reading it with the cautious
  // page rules made the oracle return null for "1,583 ZEC" and "0.110 ZEC",
  // and every such case was reported as "nothing converted" when the
  // conversion was in fact correct.
  const base = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const scale = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[2]?.toUpperCase() ?? ''] ?? 1;
  const decimals = /\.(\d+)$/.exec(match[1])?.[1].length ?? 0;
  // Half a unit in the last place printed, plus a hair. A value sitting
  // exactly on the rounding boundary — 0.32050 rendered "0.321" — differs by
  // exactly half a unit, and in binary floating point that comes out a shade
  // over rather than equal.
  const half = 0.5 * Math.pow(10, -decimals) * scale;
  return { value: base * scale, tolerance: half * 1.000001 };
}
