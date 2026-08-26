// Infer currency from TLD or page signals
const TLD_CURRENCY_MAP: Record<string, string> = {
  'ca': 'CAD',
  'uk': 'GBP',
  'de': 'EUR',
  'fr': 'EUR',
  'it': 'EUR',
  'es': 'EUR',
  'nl': 'EUR',
  'be': 'EUR',
  'at': 'EUR',
  'jp': 'JPY',
  'cn': 'CNY',
  'au': 'AUD',
  'in': 'INR',
  'br': 'BRL',
  'mx': 'MXN',
  'kr': 'KRW',
  'ch': 'CHF',
  // Countries whose local currency is written "$" and which we cannot price.
  // Named on purpose: naming the currency is what lets the parser REFUSE it.
  // Unnamed, a Chilean peso page fell through to USD and rendered every one of
  // its 214 prices about 950 times too high. ".co" is deliberately absent —
  // it is a Colombian TLD in name and a generic one in practice.
  'cl': 'CLP',
  'ar': 'ARS',
  'uy': 'UYU',
  'nz': 'NZD',
  'sg': 'SGD',
  'hk': 'HKD',
  'tw': 'TWD',
};

// Every currency that writes itself "$". A country TLD naming one of these is
// evidence about which dollar the glyph means — including when the answer is a
// dollar we hold no rate for, which is a reason to convert nothing rather than
// a reason to fall back to the American one.
const DOLLAR_CURRENCIES = new Set([
  'USD',
  'CAD',
  'AUD',
  'MXN',
  'CLP',
  'ARS',
  'UYU',
  'NZD',
  'SGD',
  'HKD',
  'TWD',
]);

export function inferCurrencyFromHostname(hostname: string): string | null {
  // Extract TLD from hostname
  // e.g., "www.amazon.ca" -> "ca"
  const parts = hostname.split('.');

  if (parts.length >= 2) {
    const singleTld = parts[parts.length - 1];
    if (TLD_CURRENCY_MAP[singleTld]) {
      return TLD_CURRENCY_MAP[singleTld];
    }
  }

  return null;
}

// Candidate currencies for symbols shared by several of them. Exported so the
// parser can fall back to another candidate when the locale-resolved currency
// is disabled (e.g. "$" on a .mx site resolves to MXN, but if the user only
// enabled USD we convert as USD rather than dropping the price entirely).
export const AMBIGUOUS_SYMBOLS: Record<string, string[]> = {
  $: ['USD', 'CAD', 'AUD', 'MXN'],
  '¥': ['JPY', 'CNY'],
};

// For ambiguous symbols like "$", resolve based on context.
// `documentLang` is the page's html[lang], used to tell zh (CNY) from ja (JPY)
// on generic TLDs. Returns null for non-ambiguous symbols so pattern.code is
// preserved.
export function resolveAmbiguousSymbol(
  symbol: string,
  hostname: string,
  documentLang?: string,
): string | null {
  const inferredCurrency = inferCurrencyFromHostname(hostname);
  // Stryker disable next-line StringLiteral: equivalent — this fallback only
  // ever feeds a startsWith('zh') test, and no replacement string passes it
  // either, so nothing downstream can tell one empty default from another.
  const lang = (documentLang || '').toLowerCase();

  if (symbol === '$') {
    // A country TLD that names a dollar settles which dollar this is. A TLD
    // that names something else (".de" is EUR) says nothing about a "$" on the
    // page, so it does not get to answer.
    if (inferredCurrency && DOLLAR_CURRENCIES.has(inferredCurrency)) return inferredCurrency;
    return 'USD'; // Default
  }

  if (symbol === '¥') {
    // ¥ could be JPY or CNY
    if (inferredCurrency === 'CNY') return 'CNY';
    if (inferredCurrency === 'JPY') return 'JPY';
    if (lang.startsWith('zh')) return 'CNY';
    return 'JPY'; // Default
  }

  // Non-ambiguous symbols (€, £, ₩, ₹, etc.) - don't override pattern.code
  return null;
}
