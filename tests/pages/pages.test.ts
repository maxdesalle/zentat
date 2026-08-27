// @vitest-environment happy-dom
//
// Every captured page, run through the whole pipeline, checked against
// properties rather than expected values.
//
// The corpus next door asserts what was DETECTED. Every bug this project has
// shipped was downstream of detection — the unit, the marker, the dead
// adapter, the element nobody looked at — so these assert what the reader
// actually ends up seeing.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { visibleFiatCount } from './visible';

// Below this a capture is a bot wall or an empty JavaScript shell, and a
// fixture that contains no page proves nothing.
const MIN_USEFUL_BYTES = 4_000;

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
  /** Fiat prices a reader may still see after conversion. Ratcheted. */
  maxFiatRemaining?: number;
}

// Metadata is cheap; the markup is not. Real captures run to hundreds of
// kilobytes each and holding every one in memory at once exhausts the worker
// long before the assertions get a chance to fail.
const pages = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({
    meta: JSON.parse(readFileSync(join(fixturesDir, f), 'utf8')) as PageMeta,
    htmlPath: join(fixturesDir, f.replace(/\.json$/, '.html')),
  }))
  .filter((p) => statSync(p.htmlPath).size > MIN_USEFUL_BYTES);

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
  document.body.innerHTML = readFileSync(page.htmlPath, 'utf8');
}

beforeEach(() => {
  document.body.innerHTML = '';
  clearPageScale();
});

// Real pages are large. Dropping the DOM between tests keeps a run of a
// hundred of them inside one worker's memory.
afterEach(() => {
  document.body.innerHTML = '';
});

describe.each(pages.map((p) => [p.meta.name, p] as const))('%s', (_name, page) => {
  // One test, not four: a real capture is hundreds of kilobytes and parsing it
  // once per assertion exhausts the worker's heap long before the suite ends.
  // Every check below runs against a single parse of the page.
  it('survives a full convert, a second pass and a revert', () => {
    load(page);
    const before = document.body.innerHTML;
    const problems: string[] = [];

    const fiatBefore = visibleFiatCount(document.body);

    expect(() => convertPricesInDocument(rates, settings)).not.toThrow();

    // How many fiat prices a reader can still see. Ratcheted, exactly like a
    // known gap: leaving MORE behind is a regression, leaving fewer means the
    // recorded number is stale and should be tightened. Without this the suite
    // cannot fail for a price we never looked at, which is how Steam shipped
    // converting nothing at all and Apple's configurator shipped in dollars.
    const fiatAfter = visibleFiatCount(document.body);
    const allowed = page.meta.maxFiatRemaining;
    if (allowed === undefined) {
      problems.push(`no maxFiatRemaining recorded; it is ${fiatAfter} of ${fiatBefore}`);
    } else if (fiatAfter > allowed) {
      problems.push(`left ${fiatAfter} fiat prices on screen, was allowed ${allowed}`);
    } else if (fiatAfter < allowed) {
      problems.push(`only ${fiatAfter} fiat prices remain, tighten maxFiatRemaining to that`);
    }

    const expected = new Set((page.meta.knownGaps ?? []).map((gap) => gap.invariant));
    const violations = checkConverted();
    for (const v of violations.filter((v) => !expected.has(v.invariant))) {
      problems.push(`${v.invariant}: ${v.detail}`);
    }
    // A recorded gap must still be real; a stale one is a lie about what this
    // page proves.
    const seen = new Set(violations.map((v) => v.invariant));
    for (const name of expected) {
      if (!seen.has(name)) problems.push(`known gap no longer fails, remove it: ${name}`);
    }

    // The observer re-runs on every mutation batch. A second pass that finds
    // more, finds less, or nests a conversion inside one is the shape of two
    // bugs already shipped.
    const afterFirst = document.body.innerHTML;
    convertPricesInDocument(rates, settings);
    const drift = firstDifference(afterFirst, document.body.innerHTML);
    if (drift) problems.push(`second pass changed the page ${drift}`);

    // Switch the extension off and the page must be what its author wrote.
    revertConversions();
    for (const v of revertLeavesNothingBehind()) problems.push(`${v.invariant}: ${v.detail}`);
    const residue = firstDifference(before, document.body.innerHTML);
    if (residue) problems.push(`revert did not restore the page ${residue}`);

    expect(problems).toEqual([]);
    // Real captures run to hundreds of kilobytes and this test walks each one
    // several times. The default five seconds is a limit on the fixture's
    // size, not on anything the code does.
  }, 30_000);
});
