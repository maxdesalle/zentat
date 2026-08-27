import { describe, expect, it } from 'vitest';
import {
  CURRENCY_PATTERNS,
  type CurrencyPattern,
  QUICK_DETECT_PATTERN,
} from '../../src/lib/detection/patterns';

// Spec: tests/trees/patterns.tree

const patternFor = (predicate: (pattern: CurrencyPattern) => boolean): CurrencyPattern => {
  const found = CURRENCY_PATTERNS.filter(predicate);
  if (found.length !== 1) throw new Error(`expected one pattern, found ${found.length}`);
  return found[0];
};

const usd = () => patternFor((p) => p.code === 'USD');
const eur = () => patternFor((p) => p.code === 'EUR' && p.symbols[0] === '€');
const chf = () => patternFor((p) => p.code === 'CHF');
const inr = () => patternFor((p) => p.code === 'INR');
const dash = () => patternFor((p) => p.symbols[0] === ',-');
const btw = () => patternFor((p) => p.symbols[0] === 'btw');
const euroWord = () => patternFor((p) => p.symbols[0] === 'euro');
const bolDecimal = () =>
  patternFor((p) =>
    p.requiresPriceContainer === true && p.symbols.length === 0
    && p.hostnames?.[0] === 'bol.com'
  );
const coolblueWhole = () =>
  patternFor((p) =>
    p.requiresPriceContainer === true && p.symbols.length === 0
    && p.hostnames?.[0] === 'coolblue.nl'
  );

/**
 * The text of every match. Asserting the whole span, not just that something
 * matched, is what catches a pattern that stops one digit short of the end.
 */
const spans = (pattern: CurrencyPattern, text: string): string[] =>
  [...text.matchAll(pattern.regex)].map((match) => match[0]);

/** The amount a single-group pattern hands the parser. */
const amount = (pattern: CurrencyPattern, text: string): string | undefined =>
  [...text.matchAll(pattern.regex)][0]?.[1];

describe('CURRENCY_PATTERNS', () => {
  it('lists every currency it reads, and the sites where a bare number counts', () => {
    // The two entries with no symbol read a number carrying no currency
    // evidence whatsoever. Their hostname list, and the price-container flag
    // beside it, are the whole of what stops a screen resolution or a postcode
    // from being priced in ZEC, so both belong in the specification.
    const dutchSites = ['coolblue.nl', 'coolblue.be', 'bol.com', 'mediamarkt.nl', 'mediamarkt.be'];
    const declared = CURRENCY_PATTERNS.map((pattern) => ({
      code: pattern.code,
      symbols: pattern.symbols,
      hostnames: pattern.hostnames ?? null,
      bareNumber: pattern.requiresPriceContainer ?? false,
    }));

    expect(declared).toEqual([
      { code: 'USD', symbols: ['$', 'US$'], hostnames: null, bareNumber: false },
      { code: 'EUR', symbols: ['€'], hostnames: null, bareNumber: false },
      { code: 'EUR', symbols: [',-'], hostnames: dutchSites, bareNumber: false },
      { code: 'EUR', symbols: ['btw'], hostnames: dutchSites, bareNumber: false },
      { code: 'EUR', symbols: ['euro'], hostnames: dutchSites, bareNumber: false },
      { code: 'EUR', symbols: [], hostnames: ['bol.com'], bareNumber: true },
      { code: 'EUR', symbols: [], hostnames: ['coolblue.nl', 'coolblue.be'], bareNumber: true },
      { code: 'GBP', symbols: ['£'], hostnames: null, bareNumber: false },
      { code: 'JPY', symbols: ['¥', '円'], hostnames: null, bareNumber: false },
      // CDN$ is Steam's notation. Without it a Canadian user got zero
      // conversions on a Steam store page: 13 prices, none of them read.
      { code: 'CAD', symbols: ['C$', 'CA$', 'CDN$'], hostnames: null, bareNumber: false },
      { code: 'AUD', symbols: ['A$', 'AU$'], hostnames: null, bareNumber: false },
      { code: 'CHF', symbols: ['Fr.', 'CHF'], hostnames: null, bareNumber: false },
      { code: 'CNY', symbols: ['¥', '元', 'CN¥'], hostnames: null, bareNumber: false },
      { code: 'KRW', symbols: ['₩'], hostnames: null, bareNumber: false },
      { code: 'INR', symbols: ['₹'], hostnames: null, bareNumber: false },
      { code: 'BRL', symbols: ['R$'], hostnames: null, bareNumber: false },
      { code: 'MXN', symbols: ['MX$'], hostnames: null, bareNumber: false },
    ]);
  });

  describe('when a symbol sits beside the number', () => {
    it('reads the amount from either side of the symbol', () => {
      expect(spans(usd(), '$19.99')).toEqual(['$19.99']);
      expect(spans(usd(), '$ 19.99')).toEqual(['$ 19.99']);
      expect(spans(usd(), '19.99$')).toEqual(['19.99$']);
      expect(spans(eur(), '1 299,00 €')).toEqual(['1 299,00 €']);
    });

    it('takes a currency code standing in front of the symbol with it', () => {
      // Leaving "EUR" behind next to a converted "€300" reads as two prices.
      expect(spans(eur(), 'EUR €300')).toEqual(['EUR €300']);
    });
  });

  describe('when only a currency code marks the price', () => {
    it('reads a code on either side of the number', () => {
      expect(spans(usd(), 'USD 19.99')).toEqual(['USD 19.99']);
      expect(spans(usd(), '19.99 USD')).toEqual(['19.99 USD']);
    });

    it('ignores a code that the text before it runs straight into', () => {
      // "EUR/USD 1.05" is an exchange rate, not $1.05. Requiring a space (or
      // the start of the text) in front of the code is what tells them apart.
      expect(spans(usd(), 'EUR/USD 1.05')).toEqual([]);
    });
  });

  describe('given another letter claims the dollar sign', () => {
    it('reads nothing rather than guessing US dollars', () => {
      // NZ$, HK$ and S$ are currencies this extension does not carry, and each
      // is worth roughly two thirds of a US dollar. A visible gap is a mistake
      // the user can catch; a confident wrong price is not.
      for (const text of ['NZ$50', 'HK$50', 'S$50']) expect(spans(usd(), text)).toEqual([]);
      expect(spans(usd(), 'US$50')).toEqual(['US$50']);
    });
  });

  describe('when the number is grouped', () => {
    it('reads Indian lakh grouping as one number', () => {
      // Stopping after "1,00" would price a ₹100,000 phone at ₹1.
      expect(spans(inr(), '₹1,00,000')).toEqual(['₹1,00,000']);
      expect(spans(inr(), '₹12,34,567')).toEqual(['₹12,34,567']);
    });

    it('reads the separators the rest of the world writes', () => {
      expect(spans(chf(), "CHF 1'299.00")).toEqual(["CHF 1'299.00"]);
      expect(spans(chf(), 'CHF 1’299.00')).toEqual(['CHF 1’299.00']);
      expect(spans(eur(), '€1.234.567')).toEqual(['€1.234.567']);
      expect(spans(usd(), '$1,234,567')).toEqual(['$1,234,567']);
    });

    it('reads a number through to its last digit', () => {
      // "$0.00595" once matched as "$0.005" and left "95" sitting in the page
      // beside the converted price.
      expect(spans(usd(), '$0.00595')).toEqual(['$0.00595']);
    });

    it('never joins two numbers across a line break', () => {
      // A price and an unrelated number on the next line are one text node as
      // far as the walker is concerned; joining them multiplies by a thousand.
      expect(spans(eur(), '€1\n234')).toEqual(['€1']);
    });
  });

  describe('given a Dutch or Belgian price with no symbol', () => {
    describe('when the price ends in a dash', () => {
      it('reads every thousands group, not just the last one', () => {
        // Reading "1.299,-" as 299 undercharges by a factor of four.
        expect(amount(dash(), '1.299,-')).toBe('1.299');
        expect(amount(dash(), '339,-')).toBe('339');
      });

      it('reads a price the markup has spaced apart', () => {
        expect(spans(dash(), '339 , -')).toEqual(['339 , -']);
      });
    });

    describe('when a VAT label follows the price', () => {
      it('reads the amount the label belongs to', () => {
        // Falling back to the digits nearest the label prices a €247 item at
        // €11, and neither number looks wrong on its own.
        expect(amount(btw(), '247,11 excl. btw')).toBe('247,11');
        expect(amount(btw(), '1.299 excl. btw')).toBe('1.299');
      });

      it('reads a label with no space before it', () => {
        // Adjacent elements concatenate with nothing between them.
        expect(amount(btw(), '247,11excl. btw')).toBe('247,11');
      });

      it('reads a label written without its full stop or its space', () => {
        expect(spans(btw(), '247 excl btw')).toEqual(['247 excl btw']);
        expect(spans(btw(), '247 incl.btw')).toEqual(['247 incl.btw']);
      });
    });

    describe('when the price is spelled out with the word euro', () => {
      it('reads a bare number followed by the word', () => {
        expect(spans(euroWord(), '149 euro')).toEqual(['149 euro']);
        expect(spans(euroWord(), '149euro')).toEqual(['149euro']);
      });

      it('reads a grouped or fractional amount', () => {
        expect(amount(euroWord(), '1.299 euro')).toBe('1.299');
        expect(amount(euroWord(), '53,95 euro')).toBe('53,95');
      });

      it('reads euros and cents as one price, quoted or not', () => {
        // bol.com writes its accessible price as "'149' euro en '95' cent".
        // Reading only the euros drops the cents into the page as a stray 95.
        expect(spans(euroWord(), "'149' euro en '95' cent")).toEqual(["'149' euro en '95' cent"]);
        expect(spans(euroWord(), '149 euro en 95 cent')).toEqual(['149 euro en 95 cent']);
      });

      it('reads them across the whitespace markup leaves behind', () => {
        const indented = "'149'\n  euro\n  en\n  '95'\n  cent";
        expect(spans(euroWord(), indented)).toEqual([indented]);
      });
    });

    describe('when nothing but a decimal number is left', () => {
      it('reads both cents and thousands', () => {
        expect(amount(bolDecimal(), '149,00')).toBe('149,00');
        expect(amount(bolDecimal(), '1.349,00')).toBe('1.349,00');
      });

      it('reads every thousands group of a whole number', () => {
        expect(amount(coolblueWhole(), '1.234.567')).toBe('1.234.567');
        expect(amount(coolblueWhole(), '10.999')).toBe('10.999');
      });
    });
  });
});

describe('QUICK_DETECT_PATTERN', () => {
  // The gate in front of every parse. Anything it passes over is never
  // converted at all, so a miss here is invisible rather than merely wrong.
  it('sees a symbol whichever side of the number it falls, spaced or not', () => {
    expect(QUICK_DETECT_PATTERN.test('€ 5')).toBe(true);
    expect(QUICK_DETECT_PATTERN.test('5€')).toBe(true);
    expect(QUICK_DETECT_PATTERN.test('5 €')).toBe(true);
  });

  it('sees a price that ends in a dash', () => {
    expect(QUICK_DETECT_PATTERN.test('339,-')).toBe(true);
  });

  it('sees a VAT label however it is punctuated', () => {
    expect(QUICK_DETECT_PATTERN.test('247,11 excl. btw')).toBe(true);
    expect(QUICK_DETECT_PATTERN.test('247,11excl. btw')).toBe(true);
    expect(QUICK_DETECT_PATTERN.test('247 excl btw')).toBe(true);
    expect(QUICK_DETECT_PATTERN.test('247 incl.btw')).toBe(true);
  });

  it('sees a decimal price with no symbol at all', () => {
    expect(QUICK_DETECT_PATTERN.test('149,00')).toBe(true);
  });

  it('sees a spelled-out multiplier', () => {
    expect(QUICK_DETECT_PATTERN.test('5 million')).toBe(true);
    expect(QUICK_DETECT_PATTERN.test('5 hundred thousand')).toBe(true);
  });

  it('sees a multiplier across the whitespace markup leaves behind', () => {
    expect(QUICK_DETECT_PATTERN.test('5\n  hundred\n  thousand')).toBe(true);
  });

  describe('given a number with a single digit after the comma', () => {
    it('passes it over', () => {
      // "149,0" is not how any European price is written, and treating loose
      // decimals as prices is how a version number becomes an amount of money.
      expect(QUICK_DETECT_PATTERN.test('149,0')).toBe(false);
    });
  });
});
