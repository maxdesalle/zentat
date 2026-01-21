import { describe, it, expect } from 'vitest';
import { parsePrice, parseNumber } from '../../src/lib/detection/parser';

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

  it('ignores disabled currencies', () => {
    const results = parsePrice('¥1000', ['USD']); // JPY not enabled
    expect(results).toHaveLength(0);
  });

  it('returns empty for non-price text', () => {
    const results = parsePrice('Hello world', enabledCurrencies);
    expect(results).toHaveLength(0);
  });
});
