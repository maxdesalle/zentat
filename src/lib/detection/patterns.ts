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
}

// Number pattern: 1,234.56 or 1.234,56 or 1234.56 or 69k or 2.5M or 150B or 2T
// Supports k/K (thousand), m/M (million), B (billion), T (trillion) suffixes
// Also supports spelled-out multipliers in multiple languages
// First alternation requires thousand separators (+ not *), second handles plain numbers
// Note: \s doesn't match non-breaking space (\u00A0), so we explicitly include it
const MULTIPLIER_WORDS = 'thousand|million|billion|trillion|mille|tausend|duizend|mil|millón|milhão|milione|miljoen|milliard|miljard|miliardo|bilhão|biljoen';
const NUM_SUFFIX = String.raw`[kKmMBT]?(?:[\s\u00A0]+(?:hundred[\s\u00A0]+)?(?:${MULTIPLIER_WORDS}))?`;
const NUM = String.raw`(\d{1,3}(?:[,.\s\u00A0]\d{3})+(?:[.,]\d{1,2})?${NUM_SUFFIX}|\d+(?:[.,]\d{1,2})?${NUM_SUFFIX})`;

// Build currency patterns
function buildPattern(symbols: string[], code: string): RegExp {
  const escapedSymbols = symbols.map((s) => escapeRegex(s)).join('|');
  // Match patterns:
  // 1. symbol + number: $19.99, €1,299.00
  // 2. number + symbol: 1 299,00 €, 19.99$
  // 3. CODE + number: USD 19.99, EUR 1299
  // 4. number + CODE: 19.99 USD, 1299 EUR
  const pattern = String.raw`(?:(${escapedSymbols})\s*${NUM}|${NUM}\s*(${escapedSymbols})|(?:^|\s)\b(${code})\b\s*${NUM}|${NUM}\s*\b(${code})\b)`;
  return new RegExp(pattern, 'gi');
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// European price format: "339,-" or "1.299,-" (whole number with ,- suffix)
// Handles whitespace/newlines between parts: "339 , -" or "339\n,\n-"
// Matches regular hyphen (U+002D), EN DASH (U+2013), and EM DASH (U+2014)
const EUR_DASH_PATTERN = /(\d{1,3}(?:\.\d{3})*)\s*,\s*[\u002D\u2013\u2014]/g;

// Dutch/Belgian format: "247,11 excl. btw" or "247,11 incl. btw"
const EUR_BTW_PATTERN = /(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s*(?:excl|incl)\.?\s*btw/gi;

// Dutch format: "149 euro" or "'149' euro" or "'149' euro en '00' cent" (bol.com)
// Captures full bol.com accessibility format with optional cents part
const EUR_WORD_PATTERN = /['"]?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)['"]?\s*euro(?:\s+en\s+['"]?(\d{1,2})['"]?\s*cent)?/gi;

// Bol.com decimal format: "149,00" or "53,95" (plain decimal, no symbol)
// Only safe on bol.com where we know all prices are EUR
const BOL_DECIMAL_PATTERN = /\b(\d{1,3}(?:\.\d{3})*,\d{2})\b/g;

// Coolblue whole number format: "1.349" or "899" (no decimal, uses . as thousand separator)
// Often the ",-" suffix is in a separate HTML element
const COOLBLUE_WHOLE_PATTERN = /\b(\d{1,3}(?:\.\d{3})+)\b/g;

// Sites that use EUR with regional price formats (no € symbol)
const EUR_REGIONAL_SITES = ['coolblue.nl', 'coolblue.be', 'bol.com', 'mediamarkt.nl', 'mediamarkt.be'];

export const CURRENCY_PATTERNS: CurrencyPattern[] = [
  { code: 'USD', symbols: ['$', 'US$'], regex: buildPattern(['$', 'US$'], 'USD') },
  { code: 'EUR', symbols: ['€'], regex: buildPattern(['€'], 'EUR') },
  // European ",-" format (e.g., "339,-" on Dutch/Belgian EUR sites)
  // Restricted to known EUR sites since ",-" is also used for DKK, NOK, CHF, etc.
  { code: 'EUR', symbols: [',-'], regex: EUR_DASH_PATTERN, hostnames: EUR_REGIONAL_SITES },
  // Dutch/Belgian "excl. btw" / "incl. btw" format
  { code: 'EUR', symbols: ['btw'], regex: EUR_BTW_PATTERN, hostnames: EUR_REGIONAL_SITES },
  // Dutch "euro" word format (e.g., "149 euro", "53,95 euro")
  { code: 'EUR', symbols: ['euro'], regex: EUR_WORD_PATTERN, hostnames: EUR_REGIONAL_SITES },
  // Bol.com plain decimal format (e.g., "149,00", "53,95") - very restricted
  { code: 'EUR', symbols: [], regex: BOL_DECIMAL_PATTERN, hostnames: ['bol.com'] },
  // Coolblue whole number format (e.g., "1.349", "899") - thousand separator with no decimal
  { code: 'EUR', symbols: [], regex: COOLBLUE_WHOLE_PATTERN, hostnames: ['coolblue.nl', 'coolblue.be'] },
  { code: 'GBP', symbols: ['£'], regex: buildPattern(['£'], 'GBP') },
  { code: 'JPY', symbols: ['¥', '円'], regex: buildPattern(['¥', '円'], 'JPY') },
  { code: 'CAD', symbols: ['C$', 'CA$'], regex: buildPattern(['C$', 'CA$'], 'CAD') },
  { code: 'AUD', symbols: ['A$', 'AU$'], regex: buildPattern(['A$', 'AU$'], 'AUD') },
  { code: 'CHF', symbols: ['Fr.', 'CHF'], regex: buildPattern(['Fr.', 'CHF'], 'CHF') },
  { code: 'CNY', symbols: ['¥', '元', 'CN¥'], regex: buildPattern(['CN¥', '元'], 'CNY') },
  { code: 'KRW', symbols: ['₩'], regex: buildPattern(['₩'], 'KRW') },
  { code: 'INR', symbols: ['₹'], regex: buildPattern(['₹'], 'INR') },
  { code: 'BRL', symbols: ['R$'], regex: buildPattern(['R$'], 'BRL') },
  { code: 'MXN', symbols: ['MX$'], regex: buildPattern(['MX$'], 'MXN') },
];

// Simple combined pattern for quick detection
// Requires digit after currency symbol to avoid matching cashtags like $BTC
// Includes European formats: ",-", "btw", "euro", decimal prices, k/m/M/B/T suffixes, and spelled-out multipliers
// Note: [\s\u00A0] includes non-breaking space for French number formatting
// Also matches European thousand-separator format like "1.349" (used on Coolblue)
// Multilingual multiplier words: EN, FR, DE, NL, ES, PT, IT
// Note: \d.*btw requires a number before "btw" to avoid matching labels like "BTW (V.A.T.)"
export const QUICK_DETECT_PATTERN = /[$€£¥₩₹][\s\u00A0]*\d|\d[\s\u00A0]*[$€£¥₩₹]|(?:USD|EUR|GBP|JPY|CAD|AUD|CHF|CNY|KRW|INR|BRL|MXN)\b|\d,-|\d[.,\s\u00A0]*(?:excl|incl)\.?\s*btw\b|\beuro\b|\d,\d{2}\b|\d\.\d{3}\b|\d[kKmMBT]\b|\d[\s\u00A0]+(?:hundred[\s\u00A0]+)?(?:thousand|million|billion|trillion|mille|tausend|duizend|mil|millón|milhão|milione|miljoen|milliard|miljard|miliardo|bilhão|biljoen)\b/i;

