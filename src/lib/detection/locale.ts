// Infer currency from TLD or page signals
const TLD_CURRENCY_MAP: Record<string, string> = {
  'ca': 'CAD',
  'uk': 'GBP',
  'co.uk': 'GBP',
  'de': 'EUR',
  'fr': 'EUR',
  'it': 'EUR',
  'es': 'EUR',
  'nl': 'EUR',
  'be': 'EUR',
  'at': 'EUR',
  'jp': 'JPY',
  'co.jp': 'JPY',
  'cn': 'CNY',
  'com.cn': 'CNY',
  'au': 'AUD',
  'com.au': 'AUD',
  'in': 'INR',
  'co.in': 'INR',
  'br': 'BRL',
  'com.br': 'BRL',
  'mx': 'MXN',
  'com.mx': 'MXN',
  'kr': 'KRW',
  'co.kr': 'KRW',
  'ch': 'CHF',
};

export function inferCurrencyFromHostname(hostname: string): string | null {
  // Extract TLD(s) from hostname
  // e.g., "www.amazon.ca" -> "ca"
  // e.g., "www.amazon.co.uk" -> "co.uk"
  const parts = hostname.split('.');

  if (parts.length >= 2) {
    // Try two-part TLD first (co.uk, com.au, etc.)
    const twoPartTld = parts.slice(-2).join('.');
    if (TLD_CURRENCY_MAP[twoPartTld]) {
      return TLD_CURRENCY_MAP[twoPartTld];
    }

    // Try single TLD
    const singleTld = parts[parts.length - 1];
    if (TLD_CURRENCY_MAP[singleTld]) {
      return TLD_CURRENCY_MAP[singleTld];
    }
  }

  return null;
}

// For ambiguous symbols like "$", resolve based on context
export function resolveAmbiguousSymbol(symbol: string, hostname: string): string {
  const inferredCurrency = inferCurrencyFromHostname(hostname);

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
    return 'JPY'; // Default
  }

  return inferredCurrency || 'USD';
}
