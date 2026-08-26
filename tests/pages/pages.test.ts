// @vitest-environment happy-dom
//
// Every captured page, run through the whole pipeline, checked against
// properties rather than expected values.
//
// The corpus next door asserts what was DETECTED. Every bug this project has
// shipped was downstream of detection — the unit, the marker, the dead
// adapter, the element nobody looked at — so these assert what the reader
// actually ends up seeing.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: () => ({
      getValue: async () => null,
      setValue: async () => {},
      watch: () => () => {},
    }),
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
    watch: () => () => {},
  },
}));

import {
  convertPricesInDocument,
  revertConversions,
} from '../../src/entrypoints/content/converter';
import { clearPageScale } from '../../src/lib/conversion/format';
import type { RatesData } from '../../src/lib/storage/rates';
import { DEFAULT_SETTINGS } from '../../src/lib/storage/settings';
import { checkConverted, firstDifference, revertLeavesNothingBehind } from './invariants';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');

interface PageMeta {
  name: string;
  url: string;
  hostname: string;
  lang: string;
  /**
   * Invariants this page is known to violate, each with the reason.
   *
   * Recorded rather than hidden, and asserted to STILL fail: the day one
   * starts passing, this test says so and the entry comes out. A gap nobody
   * is reminded of is a gap nobody fixes.
   */
  knownGaps?: Array<{ invariant: string; why: string }>;
}

const pages = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({
    meta: JSON.parse(readFileSync(join(fixturesDir, f), 'utf8')) as PageMeta,
    html: readFileSync(join(fixturesDir, f.replace(/\.json$/, '.html')), 'utf8'),
  }));

// ZEC around $780, which is where everyday prices land at their least
// convenient — small fractions, the case the display grammar has to survive.
const RATE = 1 / 780;
const rates: RatesData = {
  rates: {
    USD: RATE,
    EUR: RATE * 1.09,
    GBP: RATE * 1.27,
    JPY: RATE / 150,
    CAD: RATE / 1.36,
    AUD: RATE / 1.52,
    CHF: RATE * 1.13,
    CNY: RATE / 7.2,
    KRW: RATE / 1350,
    INR: RATE / 83,
    BRL: RATE / 5.4,
    MXN: RATE / 17,
  },
  updatedAt: Date.now(),
  source: 'fixture',
};

const settings = { ...DEFAULT_SETTINGS, currencies: DEFAULT_SETTINGS.currencies };

function load(page: (typeof pages)[number]) {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hostname: page.meta.hostname },
    writable: true,
    configurable: true,
  });
  document.documentElement.lang = page.meta.lang;
  document.body.innerHTML = page.html;
}

beforeEach(() => {
  document.body.innerHTML = '';
  clearPageScale();
});

describe.each(pages.map((p) => [p.meta.name, p] as const))('%s', (_name, page) => {
  it('converts without throwing', () => {
    load(page);
    expect(() => convertPricesInDocument(rates, settings)).not.toThrow();
  });

  it('holds every rendering invariant', () => {
    load(page);
    convertPricesInDocument(rates, settings);
    const expected = new Set((page.meta.knownGaps ?? []).map((gap) => gap.invariant));
    const violations = checkConverted();

    expect(violations.filter((v) => !expected.has(v.invariant))).toEqual([]);

    // And the recorded gaps must still be real. A stale one is a lie about
    // what this page proves.
    const seen = new Set(violations.map((v) => v.invariant));
    expect([...expected].filter((name) => !seen.has(name))).toEqual([]);
  });

  it('converts the same way twice', () => {
    // The observer re-runs on every mutation batch. A second pass that finds
    // more, finds less, or nests a conversion inside one is the shape of two
    // bugs already shipped.
    load(page);
    convertPricesInDocument(rates, settings);
    const first = document.body.innerHTML;
    convertPricesInDocument(rates, settings);
    expect(firstDifference(first, document.body.innerHTML)).toBeNull();
  });

  it('gives the page back exactly as it was', () => {
    // Switch the extension off and the page must be what its author wrote.
    // This is what makes it a guest rather than a squatter.
    load(page);
    const before = document.body.innerHTML;
    convertPricesInDocument(rates, settings);
    revertConversions();
    expect(revertLeavesNothingBehind()).toEqual([]);
    expect(firstDifference(before, document.body.innerHTML)).toBeNull();
  });
});
