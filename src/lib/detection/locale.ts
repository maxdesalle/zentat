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
};

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
    // $ could be USD, CAD, AUD, MXN, etc.
    if (inferredCurrency === 'CAD') return 'CAD';
    if (inferredCurrency === 'AUD') return 'AUD';
    if (inferredCurrency === 'MXN') return 'MXN';
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
