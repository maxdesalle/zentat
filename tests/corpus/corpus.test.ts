// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { detectPrices } from '../../src/entrypoints/content/detector';
import { CURRENCY_CODES } from '../../src/lib/currencies';
import { FIXTURES } from './fixtures';
import type { ExpectedPrice, Fixture } from './types';

interface Found {
  text: string;
  currency: string;
  amount: number;
}

function detect(fixture: Fixture): Found[] {
  document.documentElement.lang = fixture.lang ?? 'en-US';
  document.body.innerHTML = fixture.html;

  return detectPrices(document.body, CURRENCY_CODES, fixture.hostname)
    .flatMap(({ prices }) =>
      prices.map((price) => ({
        text: price.original,
        currency: price.currency,
        amount: price.amount,
      }))
    );
}

function matches(found: Found, expected: ExpectedPrice): boolean {
  return found.currency === expected.currency
    && Math.abs(found.amount - expected.amount) < 0.000001;
}

/**
 * A legible failure. "Amazon.de: 3 prices lost, 1 new false positive" turns
 * triage into a glance; a raw array diff turns it into an afternoon.
 */
function report(fixture: Fixture, found: Found[]): string {
  const lines = [`\n${fixture.name} (${fixture.hostname})`];
  lines.push(
    `  found: ${
      found.map((f) => `${f.text}=${f.currency} ${f.amount}`).join(' | ') || '(nothing)'
    }`,
  );
  lines.push(
    `  expected: ${
      fixture.expect.map((e) => `${e.text}=${e.currency} ${e.amount}`).join(' | ') || '(nothing)'
    }`,
  );
  return lines.join('\n');
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('golden corpus', () => {
  for (const fixture of FIXTURES) {
    describe(fixture.name, () => {
      it('finds every expected price', () => {
        const found = detect(fixture);
        for (const expected of fixture.expect) {
          const hits = found.filter((f) => matches(f, expected));
          expect(hits.length, `missing ${expected.text}${report(fixture, found)}`)
            .toBeGreaterThanOrEqual(1);
          if (expected.count !== undefined) {
            expect(hits.length, `wrong count for ${expected.text}${report(fixture, found)}`)
              .toBe(expected.count);
          }
        }
      });

      it('reads nothing it must not', () => {
        const found = detect(fixture);
        for (const forbidden of fixture.forbid ?? []) {
          const digits = forbidden.replace(/\D/g, '');
          const hit = found.find((f) =>
            f.text.includes(forbidden)
            || (digits.length >= 3 && f.text.replace(/\D/g, '') === digits)
          );
          expect(hit, `converted forbidden "${forbidden}"${report(fixture, found)}`)
            .toBeUndefined();
        }
      });

      // A known gap that starts passing is news: something was fixed by
      // accident and the entry should be removed rather than left to rot.
      if (fixture.knownGaps?.length) {
        it('has not silently fixed its known gaps', () => {
          const found = detect(fixture);
          for (const gap of fixture.knownGaps!) {
            const hit = found.find((f) => f.text === gap.text);
            expect(
              hit,
              `known gap now PASSES — remove it from the fixture: ${gap.text} (${gap.why})`,
            ).toBeUndefined();
          }
        });
      }
    });
  }

  it('covers the shapes that actually break', () => {
    // A corpus that only holds easy cases passes forever and protects nothing.
    const names = FIXTURES.map((f) => f.name);
    for (
      const required of [
        'split-cents-no-separator',
        'coolblue-spec-sheet',
        'latam-dot-thousands',
        'saas-pricing-table',
        'non-price-numbers',
      ]
    ) {
      expect(names).toContain(required);
    }
  });
});
