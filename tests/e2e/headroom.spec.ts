/**
 * Conversion must finish WELL BEFORE the page paints.
 *
 * Milliseconds are the wrong unit for "did the user see a dollar sign". The
 * question is an ordering one: our replacement has to be in the DOM before the
 * pixel is drawn. A fast conversion on a faster page still flashes.
 *
 * So the budget is a RATIO. Conversion must land inside MAX_RATIO of the page's
 * own first contentful paint, leaving the rest as headroom for a real machine
 * under real load — where our work and the page's compete for one thread.
 *
 * These fixtures have their scripts stripped, so they paint far sooner than the
 * live sites do. That makes this a HARDER test than the web, deliberately: pass
 * here and the live margin is wider, never narrower.
 */
import { type BrowserContext, chromium, expect, test } from '@playwright/test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '../../dist/chrome-mv3');
const FIX = path.resolve(__dirname, '../pages/fixtures');
const ORIGIN = 'https://headroom.zentat.invalid';

/** Conversion may use at most this share of the page's time-to-first-paint. */
const MAX_RATIO = 0.7;

/**
 * Pages that do not reach that margin, each with a ceiling and a reason.
 *
 * These are not permission to be slow. A page over its ceiling fails, and so
 * does a page that comes in well UNDER it — a stale exception hides a fix as
 * effectively as it hides a regression, and this suite has been burned by
 * exactly that before.
 *
 * Both are the same shape. Captures carry no stylesheet, so they paint the
 * instant their first text parses — 40–100ms, faster than any real page, which
 * cannot paint before its render-blocking CSS arrives. Against that floor the
 * fixed cost of the extension STARTING is what is left: Chrome takes ~20–25ms
 * to set up the isolated world and run the first line, one cross-process
 * storage read follows, and the first Intl.NumberFormat costs ~9ms of ICU
 * initialisation. That is ~35ms before any DOM has been read, on a page that
 * has finished painting at 60ms. What these four measure is the floor of
 * starting a content script at all, not the cost of the conversion.
 */
const KNOWN_TIGHT: Record<string, { ceiling: number; why: string }> = {
  'plausible-pricing': {
    // Measured between 0.76 and 0.98 across runs on one machine. The ceiling is
    // the top of that spread, not the best of it: this page paints at 50–100ms,
    // so the fixed cost of STARTING a content script is the whole budget, and
    // how much is left depends on what else the machine is doing. A tighter
    // number here fails on a busy afternoon and says nothing about the code.
    ceiling: 1,
    why:
      'Smallest pricing page in the corpus; paints at ~50–100ms, so startup is the whole budget.',
  },
  'grubhub-menu': {
    ceiling: 0.85,
    why: '126 prices on a page that paints at ~60ms — the writes alone outlast the paint.',
  },
};
/** Median of this many loads, so one scheduling hiccup cannot fail a page. */
const RUNS = Number(process.env.HEADROOM_RUNS ?? 5);
/** How long to keep waiting before concluding a page holds no price at all. */
const NO_PRICE_MS = 2500;

const RATES = {
  rates: {
    USD: 0.00128,
    EUR: 0.0014,
    GBP: 0.00163,
    JPY: 0.0000086,
    CAD: 0.00095,
    AUD: 0.00085,
    CHF: 0.00145,
    CNY: 0.00018,
    KRW: 0.00000097,
    INR: 0.0000154,
    BRL: 0.00023,
    MXN: 0.000068,
    SEK: 0.00012,
    PLN: 0.00033,
    TRY: 0.000037,
    ZAR: 0.00007,
    NOK: 0.00012,
    DKK: 0.00019,
  },
  updatedAt: 0,
  source: 'headroom',
};

// A capture without its metadata sidecar is a failed capture, not a page.
// The page suite ignores those too; crashing on one would make this harness
// fail for a reason that has nothing to do with speed.
const PAGES = readdirSync(FIX)
  .filter((f) => f.endsWith('.html'))
  .map((f) => f.slice(0, -5))
  .filter((name) => existsSync(path.join(FIX, `${name}.json`)));

let ctx: BrowserContext;
let worker: import('@playwright/test').Worker;

test.beforeAll(async () => {
  ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  worker = sw;
  await primeRates();
});

test.afterAll(async () => {
  await ctx?.close();
});

/**
 * Rates are re-asserted before every load. The background refreshes on its own
 * schedule and its fetch cannot succeed here, so a run long enough to cross a
 * refresh saw pages stop converting for a reason that had nothing to do with
 * their speed — which showed up as the measured population quietly shrinking.
 */
async function primeRates(): Promise<void> {
  await worker.evaluate(async (rates) => {
    await chrome.storage.local.set({ rates: { ...rates, updatedAt: Date.now() } });
  }, RATES);
}

interface Sample {
  fcp: number;
  converted: number;
}

interface Fixture {
  name: string;
  url: string;
  lang: string;
}

/**
 * Fixtures are served from the origin they were captured from, not a stand-in
 * host. Currency inference reads the TLD and site adapters match on hostname,
 * so a page served from somewhere else converts differently — or, for a third
 * of the corpus, not at all.
 */
function key(url: string): string {
  const parsed = new URL(url);
  return parsed.host + parsed.pathname.replace(/\/$/, '');
}

const FIXTURES = new Map<string, Fixture>();
for (const name of PAGES) {
  const meta = JSON.parse(readFileSync(path.join(FIX, `${name}.json`), 'utf8'));
  FIXTURES.set(key(meta.url), { name, url: meta.url, lang: meta.lang ?? 'en' });
}

let shared: import('@playwright/test').Page | undefined;

/**
 * One page, navigated repeatedly. Init scripts re-run on every navigation, and
 * a fresh page per fixture costs more setup time than the measurement itself.
 */
async function pageForMeasuring() {
  if (shared) return shared;
  shared = await ctx.newPage();
  // Runs at document_start, the same lifecycle point as the content script, and
  // records the conversion against the PAGE's clock — the only clock the paint
  // timings share.
  await shared.addInitScript(() => {
    const w = window as unknown as { __converted: number; __fcp: number };
    w.__converted = -1;
    w.__fcp = -1;
    // Observed as it happens rather than read back afterwards. Reading
    // performance.getEntriesByType('paint') at the end of a run returned
    // nothing for 43 of 105 pages — repeat navigations in one tab do not
    // reliably keep the entry — and those pages were then dropped from the
    // measurement entirely. They were disproportionately the FAST ones, so the
    // scoreboard was built from the slow half of the corpus.
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === 'first-contentful-paint' && w.__fcp < 0) w.__fcp = entry.startTime;
      }
    }).observe({ type: 'paint', buffered: true });
    const seen = () => document.querySelector('span[title^="Original: "]') !== null;
    const observer = new MutationObserver(() => {
      if (w.__converted >= 0 || !seen()) return;
      w.__converted = performance.now();
      observer.disconnect();
    });
    // The Document node, not documentElement: an init script runs before the
    // parser has created the root element, and observing null throws — which
    // silently reports every page as having converted nothing at all.
    observer.observe(document, { childList: true, subtree: true, characterData: true });
  });
  await shared.route('**/*', (route) => {
    // Captures reference their origin's images, fonts and scripts. None of them
    // exist here, and waiting for each to fail would put network timing inside a
    // measurement about our own code. Refusing them is faster and repeatable.
    if (route.request().resourceType() !== 'document') return route.abort();
    const fixture = FIXTURES.get(key(route.request().url()));
    if (!fixture) return route.abort();
    const html = readFileSync(path.join(FIX, `${fixture.name}.html`), 'utf8');
    return route.fulfill({
      // Without the charset, Chrome decodes these bytes as windows-1252 and
      // every €, £, ¥ and ₹ becomes mojibake. The page then holds no currency
      // symbol at all, so it converts nothing — and reads as a page too slow to
      // measure rather than a page served wrong. That silently removed a fifth
      // of the corpus, all of it non-dollar.
      contentType: 'text/html; charset=utf-8',
      body: `<!DOCTYPE html><html lang="${fixture.lang}"><body>${html}</body></html>`,
    });
  });
  return shared;
}

async function load(fixture: Fixture): Promise<Sample> {
  const page = await pageForMeasuring();
  await primeRates();
  await page.goto(fixture.url, { waitUntil: 'commit' });
  // Both, and the paint second on purpose: a page that converts DURING parsing
  // gets there before its first contentful paint, which is the outcome this
  // whole exercise is chasing. Sampling at the moment of conversion recorded no
  // paint for those pages and dropped them from the measurement — the best
  // results were the ones being thrown away.
  await page.waitForFunction(
    () => (window as unknown as { __converted: number }).__converted >= 0,
    undefined,
    { timeout: NO_PRICE_MS },
  ).catch(() => {});
  await page.waitForFunction(
    () => (window as unknown as { __fcp: number }).__fcp >= 0,
    undefined,
    { timeout: NO_PRICE_MS },
  ).catch(() => {});
  return await page.evaluate(() => {
    const w = window as unknown as { __converted: number; __fcp: number };
    return { fcp: w.__fcp, converted: w.__converted };
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

test('conversion lands well before first paint', async () => {
  test.setTimeout(20 * 60 * 1000);
  const failures: string[] = [];
  const silent: string[] = [];
  const unscored: string[] = [];
  const report: Array<{ name: string; ratio: number; fcp: number; converted: number }> = [];

  for (const fixture of FIXTURES.values()) {
    const name = fixture.name;
    const samples: Sample[] = [];
    for (let run = 0; run < RUNS; run++) samples.push(await load(fixture));
    // A page that converts nothing is not a fast page — it is a page whose
    // prices are all still in fiat. It cannot be measured here, but it must not
    // pass silently either.
    if (samples.every((s) => s.converted < 0)) {
      silent.push(name);
      continue;
    }
    // A page that converted but recorded no paint cannot be scored. Dropping it
    // quietly shrank the measured population from 89 pages to 62 without a word,
    // which reads exactly like a passing run on a smaller corpus.
    const usable = samples.filter((s) => s.converted >= 0 && s.fcp > 0);
    if (usable.length === 0) {
      unscored.push(name);
      continue;
    }

    // The median RUN, not three independent medians. Taking the middle ratio,
    // the middle paint and the middle conversion separately produced lines like
    // "44ms of 96ms = 73%", which is not a fact about any load that happened.
    const ranked = [...usable].sort((a, b) => a.converted / a.fcp - b.converted / b.fcp);
    const middle = ranked[Math.floor(ranked.length / 2)];
    const ratio = middle.converted / middle.fcp;
    const fcp = middle.fcp;
    const converted = middle.converted;
    report.push({ name, ratio, fcp, converted });
    const known = KNOWN_TIGHT[name];
    const limit = known ? known.ceiling : MAX_RATIO;
    const where = `converted at ${converted.toFixed(0)}ms, paint at ${fcp.toFixed(0)}ms `
      + `= ${(ratio * 100).toFixed(0)}%`;
    if (ratio > limit) {
      failures.push(`${name}: ${where}, over its ${(limit * 100).toFixed(0)}% ceiling`);
      // Clearly under, not merely under: these ratios move by ten points
      // between runs on a busy machine, and a stale-exception check that fires
      // on jitter is a test that cries wolf.
    } else if (known && ratio < MAX_RATIO - 0.1) {
      failures.push(
        `${name}: ${where} — it now meets the ${MAX_RATIO * 100}% budget, so its `
          + `exception is stale and should be deleted (${known.why})`,
      );
    }
  }

  report.sort((a, b) => b.ratio - a.ratio);
  const worst = report.slice(0, 15)
    .map((r) =>
      `  ${(r.ratio * 100).toFixed(0).padStart(4)}%  ${r.name} `
      + `(${r.converted.toFixed(0)}ms of ${r.fcp.toFixed(0)}ms)`
    )
    .join('\n');
  console.log(`\nHeadroom, worst 15 of ${report.length} pages:\n${worst}\n`);

  console.log(`Converted nothing (${silent.length}): ${silent.join(', ')}`);
  console.log(`Converted but no paint recorded (${unscored.length}): ${unscored.join(', ')}\n`);

  expect(
    failures,
    `${failures.length} of ${report.length} pages are outside their budget:\n`
      + failures.join('\n'),
  ).toEqual([]);
});
