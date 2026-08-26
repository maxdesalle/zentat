import { afterAll, describe, expect, it } from 'vitest';
import {
  extractPriceFromMatch,
  isBetterMatch,
  overlaps,
  parseNumber,
  parsePrice,
} from '../../src/lib/detection/parser';
import type { CurrencyPattern } from '../../src/lib/detection/patterns';

// Spec: tests/trees/parser.tree
// Bugs found in the field live in parser.regressions.test.ts alongside this.

const enabledCurrencies = ['USD', 'EUR', 'GBP'];

// The machine is not the page. Every test in this file runs as if the reader's
// own computer were German, so that any reading which quietly asks the machine
// how numbers are written — instead of asking the page — comes out as a wrong
// number here rather than only on someone else's laptop.
const RealNumberFormat = Intl.NumberFormat;
const languagesAsked: string[] = [];

function GermanByDefault(
  this: unknown,
  locales?: string,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  languagesAsked.push(String(locales));
  return new RealNumberFormat(locales ?? 'de-DE', options);
}

Intl.NumberFormat = GermanByDefault as unknown as typeof Intl.NumberFormat;
afterAll(() => {
  Intl.NumberFormat = RealNumberFormat;
});

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

      it('keeps three decimals after the comma', () => {
        // Three digits after a separator usually means grouping, and that rule
        // must not reach across a number that already has a grouping dot.
        // Reading "1.234,567" that way loses the fraction and returns 1234.
        expect(parseNumber('1.234,567')).toBe(1234.567);
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

  describe('given exactly three digits after a single comma', () => {
    describe('given the caller expects US decimals', () => {
      it('still reads them as thousands', () => {
        // The gas-price reading is about a DOT. A comma on a US page is a
        // thousands separator and nothing else, so "3,499" is three and a half
        // thousand dollars — reading it as 3.499 is off by a thousand.
        expect(parseNumber('3,499', true)).toBe(3499);
      });
    });
  });

  describe('given more than three digits after a single dot', () => {
    it('reads them all as decimals', () => {
      // Unit prices and crypto quotes carry four or more decimals. Matching
      // only the last three digits would turn 1.2345 into 12,345.
      expect(parseNumber('1.2345')).toBe(1.2345);
      expect(parseNumber('0.00595')).toBe(0.00595);
    });
  });

  describe('given a magnitude on top of grouped digits', () => {
    it('applies the magnitude to the grouped number', () => {
      // Each grouping shape leaves parseNumber by a different exit, and an
      // exit that forgets the magnitude reads a million times small.
      expect(parseNumber('1,500,000k')).toBe(1_500_000_000);
      expect(parseNumber('1.500.000k')).toBe(1_500_000_000);
      expect(parseNumber('1.500.000,5k')).toBe(1_500_000_500);
      expect(parseNumber('1,500,000.5k')).toBe(1_500_000_500);
    });
  });

  describe('given both separators appear more than once', () => {
    it('reads dots as grouping when the comma is the decimal', () => {
      expect(parseNumber('1.234.567,89')).toBe(1234567.89);
    });

    it('reads commas as grouping when the dot is the decimal', () => {
      expect(parseNumber('1,234,567.89')).toBe(1234567.89);
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

    it('takes the suffix off before reading the separators', () => {
      // Left on, the letter makes "1,200M" look like a number with four
      // characters after its comma, so the comma reads as a decimal point and
      // a $1.2 billion market cap renders as $1.2 million.
      expect(parseNumber('1,200M')).toBe(1_200_000_000);
    });
  });

  describe('given a spelled-out multiplier', () => {
    it('matches the whole word rather than a prefix', () => {
      // "miljoen" used to be captured as its prefix "mil": x1000, not x1M.
      expect(parseNumber('5 miljoen')).toBe(5_000_000);
      expect(parseNumber('5 mil')).toBe(5_000);
    });

    it('multiplies rather than divides', () => {
      // The direction is not self-evident from a passing test that only
      // checks the digits: 5 divided by a million is also "not 5".
      expect(parseNumber('5 million')).toBeGreaterThan(5);
      expect(parseNumber('2,000 million')).toBe(2_000_000_000);
    });

    it('handles compound multipliers', () => {
      // "thousand" is the tail of "hundred thousand", so the compound has to be
      // tried first or the same text reads a hundred times small.
      expect(parseNumber('5 hundred thousand')).toBe(500_000);
      // Markup keeps whitespace the page collapses on screen.
      expect(parseNumber('5 hundred  thousand')).toBe(500_000);
      // The words have to come off before the comma is read, or the comma
      // turns into a decimal point.
      expect(parseNumber('1,500 hundred thousand')).toBe(150_000_000);
    });

    it('handles non-English words', () => {
      expect(parseNumber('5 milliard')).toBe(5_000_000_000);
      expect(parseNumber('5 milione')).toBe(5_000_000);
      expect(parseNumber('5 millón')).toBe(5_000_000);
    });

    it('reads the word whatever its case', () => {
      // Headlines and banners shout.
      expect(parseNumber('5 MILLION')).toBe(5_000_000);
      expect(parseNumber('5 Hundred Thousand')).toBe(500_000);
    });
  });

  describe('given input that is not a number', () => {
    it('returns null for letters', () => {
      expect(parseNumber('abc')).toBe(null);
    });

    it('returns null for an empty string', () => {
      expect(parseNumber('')).toBe(null);
    });

    describe('given separators with no digits between them', () => {
      // parseNumber is called on spans a regex already matched, so these
      // should not arrive. Should-not is not the same as cannot, and the
      // alternative to returning null is returning NaN into a price.
      it('returns null for commas alone', () => {
        expect(parseNumber(',,')).toBe(null);
        expect(parseNumber(',,.')).toBe(null);
      });

      it('returns null for dots alone', () => {
        expect(parseNumber('..')).toBe(null);
      });

      it('returns null for a mix of both', () => {
        expect(parseNumber('..,')).toBe(null);
      });

      it('returns null for a separator followed by letters', () => {
        expect(parseNumber('a.123')).toBe(null);
        expect(parseNumber('.abc')).toBe(null);
      });
    });
  });
});

const span = (startIndex: number, endIndex: number) => ({ startIndex, endIndex });

describe('overlaps', () => {
  describe('given the spans are disjoint', () => {
    it('reports no overlap', () => {
      expect(overlaps(span(0, 3), span(5, 9))).toBe(false);
      expect(overlaps(span(5, 9), span(0, 3))).toBe(false);
    });
  });

  describe('given the candidate starts inside the other', () => {
    it('reports an overlap', () => {
      expect(overlaps(span(2, 9), span(0, 5))).toBe(true);
    });
  });

  describe('given the candidate ends inside the other', () => {
    it('reports an overlap', () => {
      expect(overlaps(span(0, 5), span(2, 9))).toBe(true);
    });
  });

  describe('given the candidate contains the other', () => {
    it('reports an overlap', () => {
      // Without this case a wider match is added alongside the narrower one it
      // swallows, and the same digits get converted twice.
      expect(overlaps(span(0, 12), span(3, 6))).toBe(true);
    });
  });

  describe('given the spans merely touch', () => {
    it('reports no overlap', () => {
      // "$5$6" is two prices, not one.
      expect(overlaps(span(2, 4), span(0, 2))).toBe(false);
    });
  });

  describe('at the boundaries', () => {
    // Each of these is one comparison away from swallowing the price next to
    // it, and adjacent prices are the normal case on a pricing table.
    it('treats a span starting exactly where the other ends as disjoint', () => {
      expect(overlaps(span(5, 9), span(0, 5))).toBe(false);
    });

    it('treats a span ending exactly where the other starts as disjoint', () => {
      expect(overlaps(span(0, 5), span(5, 9))).toBe(false);
    });

    it('treats identical spans as overlapping', () => {
      expect(overlaps(span(2, 6), span(2, 6))).toBe(true);
    });
  });
});

describe('isBetterMatch', () => {
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

  describe('given the candidate starts at the same offset as the other', () => {
    it('compares lengths rather than positions', () => {
      // Spans whose endpoints SUM the same but whose lengths differ: only a
      // real length comparison separates them.
      expect(isBetterMatch(span(4, 10), span(4, 6))).toBe(true);
      expect(isBetterMatch(span(4, 6), span(4, 10))).toBe(false);
    });
  });
});

describe('extractPriceFromMatch', () => {
  // None of these can arrive through parsePrice today: every pattern captures
  // a run of digits. They are the rules that decide what happens when the next
  // pattern does not, and the answer has to be "no price" rather than a price
  // of NaN shown with as much confidence as a real one.
  const dollars: CurrencyPattern = { code: 'USD', symbols: ['$'], regex: /never/g };
  const matchOf = (regex: RegExp, text: string) => regex.exec(text) as RegExpExecArray;

  describe('given the match captured no digits', () => {
    it('reads nothing', () => {
      expect(extractPriceFromMatch(matchOf(/(\$)/, '$'), dollars)).toBe(null);
    });
  });

  describe('given the captured digits are not a number', () => {
    it('reads nothing', () => {
      expect(extractPriceFromMatch(matchOf(/(a\d)/, 'a1'), dollars)).toBe(null);
    });
  });

  describe('given the captured amount is negative', () => {
    it('reads nothing', () => {
      expect(extractPriceFromMatch(matchOf(/(-\d)/, '-1'), dollars)).toBe(null);
    });
  });

  describe('given the captured amount is zero', () => {
    it('reads the price', () => {
      expect(extractPriceFromMatch(matchOf(/(0)/, '0'), dollars)?.price.amount).toBe(0);
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

    describe('given the language uses a dot decimal', () => {
      it('reads three digits as cents', () => {
        // The separator convention is asked of Intl per language rather than
        // kept in a hand-list, so the answer for a KNOWN dot-decimal locale
        // has to be pinned as tightly as the comma case.
        expect(parsePrice('$3.499', ['USD'], 'shop.example.com', 'en-US')[0]?.amount)
          .toBe(3.499);
      });
    });

    describe('given the page declares no language', () => {
      it('assumes a dot decimal', () => {
        expect(parsePrice('$3.499', ['USD'], 'shop.example.com', undefined)[0]?.amount)
          .toBe(3.499);
      });
    });

    describe('given the same language twice', () => {
      it('reads it the same way both times', () => {
        // The lookup is cached, and a cache that returns something different
        // on the second read is worse than no cache.
        const first = parsePrice('$3.499', ['USD'], 'a.com', 'en-US')[0]?.amount;
        const second = parsePrice('$3.499', ['USD'], 'a.com', 'en-US')[0]?.amount;
        expect(second).toBe(first);
      });

      it('asks the browser about that language only once', () => {
        // This runs for every price on the page, and a shopping page has
        // hundreds. Building a fresh formatter each time is work the content
        // script spends on someone else's page.
        languagesAsked.length = 0;
        parsePrice('$3.499', ['USD'], 'a.com', 'fr-FR');
        parsePrice('$9.999', ['USD'], 'a.com', 'fr-FR');
        expect(languagesAsked.filter((l) => l === 'fr-FR')).toHaveLength(1);
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

  describe('given a code before the amount', () => {
    it('reads the code without the space in front of it', () => {
      // The pattern has to swallow the space before "USD" to be sure the code
      // stands on its own. Reporting that space as part of the price makes the
      // replacement eat the gap between the label and the number.
      const [price] = parsePrice('Total USD 19.99', ['USD']);
      expect(price.original).toBe('USD 19.99');
      expect(price.amount).toBe(19.99);
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
      // Every dash the web uses as a minus, not just the ASCII one: a refund
      // line written with an en dash is still a refund.
      for (const dash of ['-', '−', '–', '—']) {
        expect(parsePrice(`Refund: ${dash}$5.99`, ['USD'])).toHaveLength(0);
      }
    });

    it('looks only at the character beside the dash', () => {
      // A digit earlier in the line is what makes a dash a range separator,
      // and only a digit right next to it counts. Any digit anywhere would
      // make "Item 2: -$5.99" a positive price.
      expect(parsePrice('Item 2: -$5.99', ['USD'])).toHaveLength(0);
    });

    it('treats every dash the web uses as a separator', () => {
      // Hyphen, minus, en dash and em dash all appear in "label — price"
      // layouts. Treating any of them as a sign drops the price entirely.
      for (const dash of ['-', '\u2212', '\u2013', '\u2014']) {
        const found = parsePrice(`Basic ${dash} $10`, ['USD']);
        expect(found.map((p) => p.amount)).toEqual([10]);
      }
    });

    describe('given the sign is attached to another number', () => {
      it('is not treated as a minus', () => {
        // "-40% $18.79" is a discount badge beside a price, and the price is
        // not negative. This is the exact Amazon deal-block shape.
        expect(parsePrice('-40% $18.79', ['USD'])[0]?.amount).toBe(18.79);
      });
    });

    it('still reads both ends of a range', () => {
      // A minus binds tightly to its number. Treating the nearest non-space
      // character as a sign swallowed every price in a "label — price" line.
      const range = parsePrice('£10-£20', ['GBP']);
      expect(range).toHaveLength(2);
      expect(range.map((r) => r.amount).sort((a, b) => a - b)).toEqual([10, 20]);
    });
  });

  describe('given a currency that prices in cents', () => {
    it('reads three digits after the dot as cents', () => {
      // Every currency whose everyday prices carry cents needs the gas-price
      // reading, not just the dollar. Dropping one from the list turns a
      // £3.499 forecourt price into £3,499.
      expect(parsePrice('£3.499', ['GBP'], 'shop.co.uk')[0]?.amount).toBe(3.499);
      expect(parsePrice('C$3.499', ['CAD'], 'shop.ca')[0]?.amount).toBe(3.499);
      expect(parsePrice('A$3.499', ['AUD'], 'shop.com.au')[0]?.amount).toBe(3.499);
      expect(parsePrice('MX$3.499', ['MXN'], 'tienda.com.mx')[0]?.amount).toBe(3.499);
    });
  });

  describe('given a price of zero', () => {
    it('reads it as zero', () => {
      // Free shipping and free tiers are quoted as prices, and dropping them
      // leaves a bare "$0.00" beside converted prices as if it had failed.
      expect(parsePrice('$0.00 shipping', ['USD'])[0]?.amount).toBe(0);
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

    it('applies on the bare domain as well as a subdomain', () => {
      expect(parsePrice('339,-', ['EUR'], 'coolblue.nl')).toHaveLength(1);
      expect(parsePrice('339,-', ['EUR'], 'shop.coolblue.nl')).toHaveLength(1);
    });

    it('does not apply to a host that merely ends in the same letters', () => {
      // "notcoolblue.nl" is a different registrant, and a suffix match without
      // the dot boundary hands them a Dutch price convention they never used.
      expect(parsePrice('339,-', ['EUR'], 'notcoolblue.nl')).toHaveLength(0);
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

    it('reads that markup when the price has no cents', () => {
      // The same accessible label drops the cents half on a whole-euro price.
      const results = parsePrice("'149' euro", ['EUR'], 'www.bol.com');
      expect(results).toHaveLength(1);
      expect(results[0].amount).toBe(149);
    });

    it('keeps a single-digit cent in the cents place', () => {
      // "149 euro en 5 cent" is 149.05. Joining the halves without padding
      // reads it as 149.50, ten times the cents.
      const results = parsePrice("'149' euro en '5' cent", ['EUR'], 'www.bol.com');
      expect(results[0]?.amount).toBe(149.05);
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

  describe('given several prices out of source order', () => {
    it('returns them left to right', () => {
      // Patterns are tried per currency, so matches arrive grouped by
      // currency rather than by position. The converter replaces them in the
      // order given, and out of order it rebuilds the text wrongly.
      const found = parsePrice('€5 then $10 then €15', ['USD', 'EUR']);
      expect(found.map((p) => p.startIndex)).toEqual(
        [...found.map((p) => p.startIndex)].sort((a, b) => a - b),
      );
      expect(found.map((p) => p.amount)).toEqual([5, 10, 15]);
    });
  });

  describe('given a currency is not enabled', () => {
    it('returns nothing for that currency', () => {
      expect(parsePrice('¥1000', ['USD'])).toHaveLength(0);
      // A symbol that means one currency and nothing else has no second
      // reading to fall back to, and asking for one must not throw.
      expect(parsePrice('€49.99', ['USD'])).toHaveLength(0);
    });

    describe('given the symbol could mean an enabled one instead', () => {
      it('uses the enabled reading', () => {
        // "$" on a .mx site resolves to MXN. With only CAD enabled the price
        // must fall through to a candidate the user actually converts.
        expect(parsePrice('$100', ['CAD'], 'tienda.com.mx')[0]?.currency).toBe('CAD');
      });
    });
  });

  describe('given text with no price in it', () => {
    it('returns nothing', () => {
      expect(parsePrice('Hello world', enabledCurrencies)).toHaveLength(0);
    });
  });
});
