import { describe, expect, it } from 'vitest';
import { parseNumber, parsePrice } from '../../src/lib/detection/parser';

describe('parseNumber', () => {
  it('parses simple integers', () => {
    expect(parseNumber('123')).toBe(123);
    expect(parseNumber('0')).toBe(0);
  });

  it('parses US format (comma thousands, dot decimal)', () => {
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('1,234,567.89')).toBe(1234567.89);
  });

  it('parses large numbers with multiple commas (no decimal)', () => {
    expect(parseNumber('150,000,000')).toBe(150000000);
    expect(parseNumber('1,000,000')).toBe(1000000);
    expect(parseNumber('10,000')).toBe(10000);
  });

  it('parses large EU numbers with multiple dots (no decimal)', () => {
    expect(parseNumber('150.000.000')).toBe(150000000);
    expect(parseNumber('1.000.000')).toBe(1000000);
  });

  it('parses numbers with k/m/M/B/T suffixes', () => {
    expect(parseNumber('69k')).toBe(69000);
    expect(parseNumber('100K')).toBe(100000);
    expect(parseNumber('5m')).toBe(5000000);
    expect(parseNumber('2.5M')).toBe(2500000);
    expect(parseNumber('1.5B')).toBe(1500000000);
    expect(parseNumber('2T')).toBe(2000000000000);
    expect(parseNumber('69.5k')).toBe(69500);
  });

  it('parses lowercase b/t suffixes at the right magnitude', () => {
    // These matched the (case-insensitive) regex but used to parse as ×1
    expect(parseNumber('5b')).toBe(5_000_000_000);
    expect(parseNumber('1.2t')).toBe(1_200_000_000_000);
  });

  it('parses non-English multiplier words at full length', () => {
    // "miljoen" used to be captured as its prefix "mil" (×1000 instead of ×1M)
    expect(parseNumber('5 miljoen')).toBe(5_000_000);
    expect(parseNumber('5 milliard')).toBe(5_000_000_000);
    expect(parseNumber('5 milione')).toBe(5_000_000);
    expect(parseNumber('5 millón')).toBe(5_000_000);
    expect(parseNumber('5 mil')).toBe(5_000);
  });

  it('parses Indian lakh grouping', () => {
    expect(parseNumber('1,00,000')).toBe(100000);
    expect(parseNumber('12,34,567.89')).toBe(1234567.89);
  });

  it('parses Swiss apostrophe thousand separators', () => {
    expect(parseNumber("1'299.00")).toBe(1299);
    expect(parseNumber('1’299.00')).toBe(1299);
  });

  it('reads three decimals as a decimal for US-style single-digit prices', () => {
    // Gas-style pricing: "$3.499" is $3.499, not $3,499
    expect(parseNumber('3.499', true)).toBe(3.499);
    // Without the US-decimal hint the thousands reading stands (Coolblue "1.349")
    expect(parseNumber('3.499')).toBe(3499);
    expect(parseNumber('1.349')).toBe(1349);
  });

  it('parses EU format (dot thousands, comma decimal)', () => {
    expect(parseNumber('1.234')).toBe(1234);
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('1.234.567,89')).toBe(1234567.89);
  });

  it('parses simple decimals', () => {
    expect(parseNumber('1.99')).toBe(1.99);
    expect(parseNumber('0.99')).toBe(0.99);
  });

  it('returns null for invalid input', () => {
    expect(parseNumber('abc')).toBe(null);
    expect(parseNumber('')).toBe(null);
  });
});

describe('parsePrice', () => {
  const enabledCurrencies = ['USD', 'EUR', 'GBP'];

  it('parses $X format', () => {
    const results = parsePrice('Price: $19.99', enabledCurrencies);
    expect(results).toHaveLength(1);
    expect(results[0].amount).toBe(19.99);
    expect(results[0].currency).toBe('USD');
  });

  it('parses €X format', () => {
    const results = parsePrice('€49.99', enabledCurrencies);
    expect(results).toHaveLength(1);
    expect(results[0].amount).toBe(49.99);
    expect(results[0].currency).toBe('EUR');
  });

  it('parses £X format', () => {
    const results = parsePrice('£100', enabledCurrencies);
    expect(results).toHaveLength(1);
    expect(results[0].amount).toBe(100);
    expect(results[0].currency).toBe('GBP');
  });

  it('parses X USD suffix format', () => {
    const results = parsePrice('99.99 USD', enabledCurrencies);
    expect(results).toHaveLength(1);
    expect(results[0].amount).toBe(99.99);
    expect(results[0].currency).toBe('USD');
  });

  it('parses multiple prices in text', () => {
    const results = parsePrice('Sale: $10 → $5 (Save $5!)', enabledCurrencies);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('handles thousand separators', () => {
    const results = parsePrice('$1,234.56', enabledCurrencies);
    expect(results).toHaveLength(1);
    expect(results[0].amount).toBe(1234.56);
  });

  it('parses financial-news magnitude suffixes', () => {
    expect(parsePrice('$5b valuation', enabledCurrencies)[0]?.amount).toBe(5_000_000_000);
    expect(parsePrice('a $1.2t market', enabledCurrencies)[0]?.amount).toBe(1_200_000_000_000);
    expect(parsePrice('$10 million', enabledCurrencies)[0]?.amount).toBe(10_000_000);
  });

  it('parses Dutch spelled-out millions', () => {
    const results = parsePrice('€5 miljoen', ['EUR']);
    expect(results).toHaveLength(1);
    expect(results[0].amount).toBe(5_000_000);
  });

  it('parses Indian lakh prices', () => {
    const results = parsePrice('₹1,00,000', ['INR']);
    expect(results).toHaveLength(1);
    expect(results[0].amount).toBe(100000);
  });

  it('parses Swiss apostrophe prices', () => {
    const results = parsePrice("CHF 1'299.00", ['CHF']);
    expect(results).toHaveLength(1);
    expect(results[0].amount).toBe(1299);
  });

  it('reads $X.XXX gas-style prices as decimals', () => {
    const results = parsePrice('$3.499/gal', ['USD']);
    expect(results).toHaveLength(1);
    expect(results[0].amount).toBe(3.499);
  });

  it('skips negative amounts but keeps ranges', () => {
    expect(parsePrice('Refund: -$5.99', ['USD'])).toHaveLength(0);
    const range = parsePrice('£10-£20', ['GBP']);
    expect(range).toHaveLength(2);
    expect(range.map((r) => r.amount).sort((a, b) => a - b)).toEqual([10, 20]);
  });

  it('resolves ambiguous $ from the hostname TLD', () => {
    const results = parsePrice('$19.99', ['USD', 'CAD'], 'www.amazon.ca');
    expect(results).toHaveLength(1);
    expect(results[0].currency).toBe('CAD');
  });

  it('falls back to an enabled candidate when the locale currency is disabled', () => {
    // "$" on a .mx site resolves to MXN; with only USD enabled the price must
    // still convert (as USD) instead of silently disappearing
    const results = parsePrice('$100', ['USD'], 'tienda.com.mx');
    expect(results).toHaveLength(1);
    expect(results[0].currency).toBe('USD');

    const mxn = parsePrice('$100', ['MXN'], 'tienda.com.mx');
    expect(mxn[0]?.currency).toBe('MXN');
  });

  it('uses page language to disambiguate ¥ on generic TLDs', () => {
    const cny = parsePrice('¥199', ['CNY', 'JPY'], 'shop.example.com', 'zh-CN');
    expect(cny[0]?.currency).toBe('CNY');
    const jpy = parsePrice('¥199', ['CNY', 'JPY'], 'shop.example.com');
    expect(jpy[0]?.currency).toBe('JPY');
  });

  it('applies hostname-restricted patterns only on their sites', () => {
    const onCoolblue = parsePrice('339,-', ['EUR'], 'www.coolblue.nl');
    expect(onCoolblue).toHaveLength(1);
    expect(onCoolblue[0].amount).toBe(339);
    expect(onCoolblue[0].currency).toBe('EUR');

    expect(parsePrice('339,-', ['EUR'], 'example.dk')).toHaveLength(0);
  });

  it('parses bol.com euro-and-cent accessibility format', () => {
    const results = parsePrice("'149' euro en '95' cent", ['EUR'], 'www.bol.com');
    expect(results).toHaveLength(1);
    expect(results[0].amount).toBe(149.95);
  });

  it('ignores disabled currencies', () => {
    const results = parsePrice('¥1000', ['USD']); // JPY not enabled
    expect(results).toHaveLength(0);
  });

  it('returns empty for non-price text', () => {
    const results = parsePrice('Hello world', enabledCurrencies);
    expect(results).toHaveLength(0);
  });
});
