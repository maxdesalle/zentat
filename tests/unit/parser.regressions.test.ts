import { describe, expect, it } from 'vitest';
import { parseNumber, parsePrice } from '../../src/lib/detection/parser';

const ALL = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'KRW', 'INR', 'BRL', 'MXN'];
const amounts = (text: string, lang = 'en-US') =>
  parsePrice(text, ALL, 'www.example.com', lang).map((p) => p.amount);

describe('a dash separating a label from a price is not a minus sign', () => {
  // Label–dash–price is the dominant SaaS/e-commerce pricing layout. Treating
  // the dash as negation dropped these silently.
  it.each([
    ['Basic – $10/mo', 10],
    ['Pro - $29', 29],
    ['Team — $99', 99],
    ['Enterprise − $499', 499],
    ['- $9.99', 9.99],
    ['The fee – $50 – applies', 50],
  ])('keeps the price in %j', (text, expected) => {
    expect(amounts(text)).toContain(expected);
  });

  it('still drops a genuine negative amount', () => {
    expect(amounts('Refund -$5.00')).toEqual([]);
    expect(amounts('Adjustment −€12,50')).toEqual([]);
  });

  it('keeps both ends of a range', () => {
    expect(amounts('$19.99 – $29.99')).toEqual([19.99, 29.99]);
    expect(amounts('£10-£20')).toEqual([10, 20]);
  });
});

describe('dot-as-thousands is not misread as a decimal', () => {
  it('reads $1.500 as 1500 on a comma-decimal page', () => {
    // es-AR/es-CL write 1500 pesos as "$1.500". Reading it as 1.5 is a 1000x error.
    expect(amounts('$1.500', 'es-AR')).toEqual([1500]);
    expect(amounts('$2.750', 'es-CL')).toEqual([2750]);
  });

  it('keeps gas-style $3.499 as a decimal on a dot-decimal page', () => {
    expect(amounts('$3.499', 'en-US')).toEqual([3.499]);
  });

  it('reads a trailing-zero third decimal as thousands even in en-US', () => {
    // Gas pricing never ends in a redundant zero; "$1.500" is EU-formatted 1500.
    expect(amounts('$1.500', 'en-US')).toEqual([1500]);
  });

  it('does not apply the single-digit rule to wider integer parts', () => {
    expect(amounts('$12.499', 'en-US')).toEqual([12499]);
  });
});

describe('sub-cent precision survives', () => {
  it.each([
    ['$0.00595', 0.00595],
    ['$0.046', 0.046],
    ['$0.0000116', 0.0000116],
    ['€0.0075', 0.0075],
  ])('parses %j without truncating', (text, expected) => {
    expect(amounts(text)).toEqual([expected]);
  });

  it('leaves no digits stranded outside the match', () => {
    const [price] = parsePrice('$0.00595/hr', ALL, 'www.example.com', 'en-US');
    expect(price.original).toBe('$0.00595');
  });
});

describe('parseNumber', () => {
  it('keeps more than two decimal places', () => {
    expect(parseNumber('0.00595', true)).toBe(0.00595);
    expect(parseNumber('1.2345', true)).toBe(1.2345);
  });
});
