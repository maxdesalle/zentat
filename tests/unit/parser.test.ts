import { describe, expect, it } from 'vitest';
import { isBetterMatch, parseNumber, parsePrice } from '../../src/lib/detection/parser';

// Spec: tests/trees/parser.tree
// Bugs found in the field live in parser.regressions.test.ts alongside this.

const enabledCurrencies = ['USD', 'EUR', 'GBP'];

describe('parseNumber', () => {
  describe('given a bare number', () => {
    it('parses an integer', () => {
      expect(parseNumber('123')).toBe(123);
    });

    it('parses a decimal', () => {
      expect(parseNumber('1.99')).toBe(1.99);
      expect(parseNumber('0.99')).toBe(0.99);
    });

    it('parses zero', () => {
      expect(parseNumber('0')).toBe(0);
    });
  });

  describe('given grouping separators', () => {
    describe('given US grouping', () => {
      it('reads a comma as thousands', () => {
        expect(parseNumber('1,234')).toBe(1234);
        expect(parseNumber('150,000,000')).toBe(150000000);
        expect(parseNumber('10,000')).toBe(10000);
      });

      it('reads a dot as the decimal point', () => {
        expect(parseNumber('1,234.56')).toBe(1234.56);
        expect(parseNumber('1,234,567.89')).toBe(1234567.89);
      });
    });

    describe('given EU grouping', () => {
      it('reads a dot as thousands', () => {
        expect(parseNumber('1.234')).toBe(1234);
        expect(parseNumber('150.000.000')).toBe(150000000);
        expect(parseNumber('1.000.000')).toBe(1000000);
      });

      it('reads a comma as the decimal point', () => {
        expect(parseNumber('1.234,56')).toBe(1234.56);
        expect(parseNumber('1.234.567,89')).toBe(1234567.89);
      });
    });

    describe('given Indian lakh grouping', () => {
      it('reads the two-digit groups', () => {
        expect(parseNumber('1,00,000')).toBe(100000);
        expect(parseNumber('12,34,567.89')).toBe(1234567.89);
      });
    });

    describe('given Swiss apostrophe grouping', () => {
      it('reads a straight apostrophe', () => {
        expect(parseNumber("1'299.00")).toBe(1299);
      });

      it('reads a typographic apostrophe', () => {
        expect(parseNumber('1’299.00')).toBe(1299);
      });
    });
  });

  describe('given exactly three digits after a single dot', () => {
    // The genuinely ambiguous case: "$3.499" is a US gas price, "1.349" on a
    // Dutch shop is one thousand three hundred and forty nine. Nothing in the
    // string itself settles it, so the caller's locale evidence has to.
    describe('given the caller expects US decimals', () => {
      it('reads them as a decimal', () => {
        expect(parseNumber('3.499', true)).toBe(3.499);
      });
    });

    describe('given the caller does not', () => {
      it('reads them as thousands', () => {
        expect(parseNumber('3.499')).toBe(3499);
        expect(parseNumber('1.349')).toBe(1349);
      });
    });
  });

  describe('given a magnitude suffix', () => {
    it('reads it case-insensitively', () => {
      expect(parseNumber('69k')).toBe(69000);
      expect(parseNumber('100K')).toBe(100000);
      expect(parseNumber('5m')).toBe(5000000);
      expect(parseNumber('2.5M')).toBe(2500000);
    });

    it('applies the right magnitude for each letter', () => {
      // Lowercase b/t matched the case-insensitive regex but used to parse
      // as x1, turning a five-billion valuation into five.
      expect(parseNumber('1.5B')).toBe(1_500_000_000);
      expect(parseNumber('5b')).toBe(5_000_000_000);
      expect(parseNumber('2T')).toBe(2_000_000_000_000);
      expect(parseNumber('1.2t')).toBe(1_200_000_000_000);
      expect(parseNumber('69.5k')).toBe(69500);
    });
  });

  describe('given a spelled-out multiplier', () => {
    it('matches the whole word rather than a prefix', () => {
      // "miljoen" used to be captured as its prefix "mil": x1000, not x1M.
      expect(parseNumber('5 miljoen')).toBe(5_000_000);
      expect(parseNumber('5 mil')).toBe(5_000);
    });

    it('handles compound multipliers', () => {
      expect(parseNumber('5 hundred thousand')).toBe(500_000);
    });

    it('handles non-English words', () => {
      expect(parseNumber('5 milliard')).toBe(5_000_000_000);
      expect(parseNumber('5 milione')).toBe(5_000_000);
      expect(parseNumber('5 millón')).toBe(5_000_000);
    });
  });

  describe('given input that is not a number', () => {
    it('returns null for letters', () => {
      expect(parseNumber('abc')).toBe(null);
    });

    it('returns null for an empty string', () => {
      expect(parseNumber('')).toBe(null);
    });
  });
});

describe('isBetterMatch', () => {
  const span = (startIndex: number, endIndex: number) => ({ startIndex, endIndex });

  describe('given the candidate starts earlier', () => {
    it('wins', () => {
      expect(isBetterMatch(span(0, 3), span(2, 9))).toBe(true);
    });
  });

  describe('given the candidate starts later', () => {
    it('loses', () => {
      expect(isBetterMatch(span(2, 9), span(0, 3))).toBe(false);
    });
  });

  describe('given both start at the same offset', () => {
    describe('given the candidate is longer', () => {
      it('wins', () => {
        // The longer match is the more specific one: "$1,234.56" over "$1".
        expect(isBetterMatch(span(0, 9), span(0, 2))).toBe(true);
      });
    });

    describe('given the candidate is no longer', () => {
      it('loses', () => {
        expect(isBetterMatch(span(0, 2), span(0, 9))).toBe(false);
        expect(isBetterMatch(span(0, 5), span(0, 5))).toBe(false);
      });
    });
  });
});

describe('parsePrice', () => {
  describe('given a symbol before the amount', () => {
    it('reads a dollar sign', () => {
      const results = parsePrice('Price: $19.99', enabledCurrencies);
      expect(results).toHaveLength(1);
      expect(results[0].amount).toBe(19.99);
      expect(results[0].currency).toBe('USD');
    });

    it('reads a euro sign', () => {
      const results = parsePrice('€49.99', enabledCurrencies);
      expect(results).toHaveLength(1);
      expect(results[0].amount).toBe(49.99);
      expect(results[0].currency).toBe('EUR');
    });

    it('reads a pound sign', () => {
      const results = parsePrice('£100', enabledCurrencies);
      expect(results).toHaveLength(1);
      expect(results[0].amount).toBe(100);
      expect(results[0].currency).toBe('GBP');
    });
  });

  describe('given the page declares a language', () => {
    describe('given the language uses a comma decimal', () => {
      it('reads the number that way', () => {
        // Which separator a locale uses is asked of Intl rather than kept in a
        // hand-list: es-ES uses a dot for thousands where es-AR uses a comma,
        // and a hand-list gets that wrong.
        expect(parsePrice('$3.499', ['USD'], 'shop.example.de', 'de-DE')[0]?.amount).toBe(3499);
      });
    });

    describe('given the language tag is not one the browser knows', () => {
      it('falls back to a dot decimal rather than failing', () => {
        // A malformed lang attribute is a page authoring mistake, not a reason
        // to stop converting the page.
        expect(parsePrice('$3.499', ['USD'], 'shop.example.com', 'not a lang!!')[0]?.amount)
          .toBe(3.499);
      });
    });
  });

  describe('given a code after the amount', () => {
    it('reads the code', () => {
      const results = parsePrice('99.99 USD', enabledCurrencies);
      expect(results).toHaveLength(1);
      expect(results[0].amount).toBe(99.99);
      expect(results[0].currency).toBe('USD');
    });
  });

  describe('given several prices in one string', () => {
    it('returns each of them', () => {
      const results = parsePrice('Sale: $10 → $5 (Save $5!)', enabledCurrencies);
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(parsePrice('$1,234.56', enabledCurrencies)[0].amount).toBe(1234.56);
    });
  });

  describe('given a magnitude in the price', () => {
    it('reads a suffix letter', () => {
      expect(parsePrice('$5b valuation', enabledCurrencies)[0]?.amount).toBe(5_000_000_000);
      expect(parsePrice('a $1.2t market', enabledCurrencies)[0]?.amount).toBe(1_200_000_000_000);
    });

    it('reads a spelled-out word', () => {
      expect(parsePrice('$10 million', enabledCurrencies)[0]?.amount).toBe(10_000_000);
      const dutch = parsePrice('€5 miljoen', ['EUR']);
      expect(dutch).toHaveLength(1);
      expect(dutch[0].amount).toBe(5_000_000);
    });
  });

  describe('given a negative amount', () => {
    it('skips the negative price', () => {
      expect(parsePrice('Refund: -$5.99', ['USD'])).toHaveLength(0);
    });

    it('still reads both ends of a range', () => {
      // A minus binds tightly to its number. Treating the nearest non-space
      // character as a sign swallowed every price in a "label — price" line.
      const range = parsePrice('£10-£20', ['GBP']);
      expect(range).toHaveLength(2);
      expect(range.map((r) => r.amount).sort((a, b) => a - b)).toEqual([10, 20]);
    });
  });

  describe('given an ambiguous symbol', () => {
    describe('given the page states its own currency', () => {
      it('beats the guess from the hostname', () => {
        // A geo-priced .com is CAD about as often as it is USD, so the TLD is
        // a guess. JSON-LD saying "CAD" is not.
        const results = parsePrice('$19.99', ['USD', 'CAD'], 'shop.example.com', 'en', 'CAD');
        expect(results[0]?.currency).toBe('CAD');
      });

      describe('given the page names a currency the symbol cannot mean', () => {
        it('ignores the page and keeps the guess', () => {
          // A page-wide currency declaration does not make a euro sign mean
          // yen. Trusting it blindly would mislabel every price on the page.
          const results = parsePrice('€49.99', ['EUR', 'JPY'], 'shop.example.com', 'en', 'JPY');
          expect(results[0]?.currency).toBe('EUR');
        });
      });
    });

    describe('given the hostname names a country', () => {
      it("resolves to that country's currency", () => {
        const results = parsePrice('$19.99', ['USD', 'CAD'], 'www.amazon.ca');
        expect(results).toHaveLength(1);
        expect(results[0].currency).toBe('CAD');
      });
    });

    describe('given that currency is not enabled', () => {
      it('falls back to an enabled candidate', () => {
        // "$" on a .mx site resolves to MXN. With only USD enabled the price
        // must still convert rather than silently disappear.
        expect(parsePrice('$100', ['USD'], 'tienda.com.mx')[0]?.currency).toBe('USD');
        expect(parsePrice('$100', ['MXN'], 'tienda.com.mx')[0]?.currency).toBe('MXN');
      });
    });

    describe('given the page language disambiguates', () => {
      it('resolves from the language', () => {
        const cny = parsePrice('¥199', ['CNY', 'JPY'], 'shop.example.com', 'zh-CN');
        expect(cny[0]?.currency).toBe('CNY');
      });
    });

    describe('given nothing disambiguates', () => {
      it('resolves to the default reading', () => {
        const jpy = parsePrice('¥199', ['CNY', 'JPY'], 'shop.example.com');
        expect(jpy[0]?.currency).toBe('JPY');
      });
    });
  });

  describe('given a dollar sign claimed by a prefix', () => {
    describe('given the prefix names a supported currency', () => {
      it('reads that currency', () => {
        expect(parsePrice('CA$19.99', ['USD', 'CAD'])[0]?.currency).toBe('CAD');
        expect(parsePrice('A$50', ['USD', 'AUD'])[0]?.currency).toBe('AUD');
        expect(parsePrice('R$19,99', ['USD', 'BRL'])[0]?.currency).toBe('BRL');
        expect(parsePrice('US$19.99', ['USD'])[0]?.currency).toBe('USD');
      });
    });

    describe('given the prefix names an unsupported one', () => {
      it('reads nothing rather than guessing US dollars', () => {
        // NZ$, HK$ and S$ are real currencies this extension does not carry
        // rates for. The bare "$" pattern used to match inside them and report
        // US dollars: NZ$50 shown as USD is off by about 65%, stated with the
        // same confidence as a correct conversion. A visible gap beats that.
        for (const text of ['NZ$50', 'HK$50', 'S$50']) {
          expect(parsePrice(text, ['USD'])).toHaveLength(0);
        }
      });
    });
  });

  describe('given a hostname-restricted pattern', () => {
    it('applies on that site', () => {
      const onCoolblue = parsePrice('339,-', ['EUR'], 'www.coolblue.nl');
      expect(onCoolblue).toHaveLength(1);
      expect(onCoolblue[0].amount).toBe(339);
      expect(onCoolblue[0].currency).toBe('EUR');
    });

    it('does not apply elsewhere', () => {
      // "339,-" is a Dutch price convention. Reading it anywhere would turn
      // any comma-dash sequence on the web into a price.
      expect(parsePrice('339,-', ['EUR'], 'example.dk')).toHaveLength(0);
    });

    it("reads a site's split euro-and-cent markup", () => {
      const results = parsePrice("'149' euro en '95' cent", ['EUR'], 'www.bol.com');
      expect(results).toHaveLength(1);
      expect(results[0].amount).toBe(149.95);
    });
  });

  describe('given the same price appears twice in one string', () => {
    it('returns both of them', () => {
      // A dedup pass used to collapse matches by their original TEXT, so
      // "Buy 2 for $19.99 or 1 for $19.99" converted only the first and left
      // the second in dollars right beside its converted twin.
      expect(parsePrice('Buy 2 for $19.99 or 1 for $19.99', ['USD'])).toHaveLength(2);
      expect(parsePrice('Was $10, now $5, you save $5', ['USD'])).toHaveLength(3);
    });

    it('keeps them at their own positions', () => {
      const results = parsePrice('$5 and $5', ['USD']);
      expect(results.map((r) => r.startIndex)).toEqual([0, 7]);
    });
  });

  describe('given two readings overlap in position', () => {
    it('keeps the longer match', () => {
      // "$1,234.56" can also be read as "$1" followed by junk. The longer
      // match is the specific one.
      const results = parsePrice('$1,234.56', enabledCurrencies);
      expect(results).toHaveLength(1);
      expect(results[0].amount).toBe(1234.56);
      expect(results[0].original).toContain('1,234.56');
    });

    it('keeps the one that starts earlier', () => {
      // Two patterns claiming overlapping digits: "EUR 5" from index 0 and
      // "5 $" from index 4. The earlier start is the real price.
      const results = parsePrice('EUR 5 $', ['USD', 'EUR']);
      expect(results).toHaveLength(1);
      expect(results[0].currency).toBe('EUR');
      expect(results[0].startIndex).toBe(0);
    });

    it('discards the shorter one', () => {
      expect(parsePrice('$10 million', enabledCurrencies)).toHaveLength(1);
      const trailing = parsePrice('$1,234.56 EUR', ['USD', 'EUR']);
      expect(trailing).toHaveLength(1);
      expect(trailing[0].currency).toBe('USD');
    });

    it('keeps the reading whose symbol is actually in the text', () => {
      const results = parsePrice('€49.99', ['USD', 'EUR', 'GBP']);
      expect(results).toHaveLength(1);
      expect(results[0].currency).toBe('EUR');
    });
  });

  describe('given a currency is not enabled', () => {
    it('returns nothing for that currency', () => {
      expect(parsePrice('¥1000', ['USD'])).toHaveLength(0);
    });
  });

  describe('given text with no price in it', () => {
    it('returns nothing', () => {
      expect(parsePrice('Hello world', enabledCurrencies)).toHaveLength(0);
    });
  });
});
