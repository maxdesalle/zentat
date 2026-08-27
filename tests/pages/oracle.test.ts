import { describe, expect, it } from 'vitest';
import { plausibleCurrencies, readAmount, readRenderedZec } from './oracle';

// The oracle is what the page harness measures the product against, so a bug
// in it does not fail loudly — it makes the suite lie. Every case below is one
// that was wrong in a draft of it and accused correct code of being broken.

describe('readAmount', () => {
  it('reads plain and grouped numbers', () => {
    expect(readAmount('$9.99')).toBe(9.99);
    expect(readAmount('$1,282,051')).toBe(1282051);
    // Space grouping is unambiguous; a lone dot before three digits is not,
    // and that case is refused below rather than guessed at.
    expect(readAmount('350 900 €')).toBe(350900);
    expect(readAmount('1.234.567')).toBe(1234567);
  });

  it('applies a multiplier that belongs to the number', () => {
    expect(readAmount('$18 billion')).toBe(18e9);
    expect(readAmount('$19.9b')).toBe(19.9e9);
    expect(readAmount('$29.121B')).toBe(29.121e9);
  });

  it('ignores a multiplier that belongs to something else', () => {
    // "million" counts requests here, not dollars.
    expect(readAmount('$0.30 / million requests')).toBe(0.3);
    expect(readAmount('$5 T-shirt')).toBe(5);
  });

  describe('given three digits after a lone separator', () => {
    it('refuses to guess', () => {
      // 1500 in Berlin, 1.5 in Boston. Nothing here settles it, and an oracle
      // that guessed would be asserting its guess against the parser's.
      expect(readAmount('$1.500')).toBeNull();
      expect(readAmount('1,500')).toBeNull();
    });

    it('reads it as a mantissa when a multiplier follows', () => {
      expect(readAmount('$1.500B')).toBe(1.5e9);
    });
  });
});

describe('plausibleCurrencies', () => {
  it('lets a written code settle a dollar', () => {
    expect(plausibleCurrencies('$1,257 CAD')).toEqual(['CAD']);
    expect(plausibleCurrencies('CDN$ 19.49')).toEqual(['CAD']);
    expect(plausibleCurrencies('US$19.49')).toEqual(['USD']);
  });

  it('keeps a bare dollar ambiguous', () => {
    expect(plausibleCurrencies('$19.49')).toEqual(['USD', 'CAD', 'AUD', 'MXN']);
  });

  it('names nothing for text carrying no currency', () => {
    expect(plausibleCurrencies('100%')).toBeNull();
  });
});

describe('readRenderedZec', () => {
  it('allows exactly the precision the rendering claims', () => {
    // "1,282,051" is a grouped integer, not three decimals. Reading it as
    // decimals set the tolerance a thousand times too tight, and the oracle
    // failed a value it had itself computed as exactly right.
    expect(readRenderedZec('1,282,051 ZEC')).toEqual({ value: 1282051, tolerance: 0.5 });
    expect(readRenderedZec('0.0128 ZEC')).toEqual({ value: 0.0128, tolerance: 0.00005 });
  });

  it('undoes abbreviation', () => {
    const read = readRenderedZec('78.3B ZEC');
    expect(read?.value).toBe(78.3e9);
    expect(read?.tolerance).toBe(0.05e9);
  });
});
