import { type BrowserContext, chromium, expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// What the offline page harness cannot see.
//
// Every one of the 124 page tests calls convertPricesInDocument() on a string
// parsed by happy-dom. There is no paint, no clock and no layout there, so two
// whole classes of defect are invisible to it by construction:
//
//   - a fiat price the reader SEES before it is converted
//   - a converted price that does not look like the price it replaced
//
// Both were reported from real use while the offline suite was green. These
// run the built extension in Chromium and measure what a person would see.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../../dist/chrome-mv3');
const ORIGIN = 'https://render.zentat.invalid';

/** Amazon's price markup: a big whole part, a small superscript for cents. */
// The blocking script is the point. A real product page runs a great deal of
// script between the price being parsed and the document being complete, and
// anything waiting on DOMContentLoaded waits for all of it. On a synthetic page
// with nothing in it the two are indistinguishable, which is how this defect
// survived: it only appears when the page has work to do.
const BLOCK_MS = 120;
const PAGE = `<!DOCTYPE html><html lang="en-US"><head><style>
  .a-price { font-size: 13px; }
  .a-price-whole { font-size: 28px; font-weight: 700; }
  .a-price-symbol, .a-price-fraction { font-size: 14px; vertical-align: super; }
  body { font-size: 13px; font-family: system-ui; }
</style></head><body>
  <p id="plain">Subtotal: $19.99</p>
  <span class="a-price" id="styled"><span class="a-offscreen">$23.38</span
  ><span aria-hidden="true"><span class="a-price-symbol">$</span
  ><span class="a-price-whole">23</span><span class="a-price-fraction">38</span></span></span>
  ${
  Array.from(
    { length: 5 },
    // Each in its own scope. Sharing one made every script after the first a
    // redeclaration error, so only one of the five ever blocked and the
    // fixture was a quarter as slow as it claimed.
    () =>
      `<script>(() => { const until = Date.now() + ${BLOCK_MS}; while (Date.now() < until); })();</script>`,
  ).join('<p>more of the page</p>')
}
  <p>Everything below this point arrives after the page has done its work.</p>
</body></html>`;

let context: BrowserContext;

test.beforeAll(async () => {
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
  await context.route(
    `${ORIGIN}/**`,
    (route) => route.fulfill({ contentType: 'text/html', body: PAGE }),
  );

  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  await sw.evaluate(async () => {
    await chrome.storage.local.set({
      rates: { rates: { USD: 0.00125 }, updatedAt: Date.now(), source: 'e2e' },
    });
  });
});

test.afterAll(async () => {
  await context?.close();
});

test('the fiat price is replaced before a reader could read it', async () => {
  const page = await context.newPage();

  // Timed from OUTSIDE the page. A sampler running inside it cannot see the
  // window that matters: requestAnimationFrame does not fire while the main
  // thread is blocked, and a blocked main thread is exactly when the page sits
  // there showing dollars. The first attempt at this test measured 0ms through
  // half a second of visible fiat for that reason.
  const started = Date.now();
  await page.goto(`${ORIGIN}/`, { waitUntil: 'commit' });
  await page.locator('#plain span[title^="Original: "]').waitFor({ state: 'attached' });
  const untilConverted = Date.now() - started;

  // However long this takes is however long the price sat there in dollars.
  //
  // 600ms is a RECORDED CEILING, not an acceptable number. On this fixture the
  // figure was 727ms while the first conversion waited for DOMContentLoaded,
  // and 549ms once it started as soon as there was a body to convert. What is
  // left is the page's own blocking scripts: nothing of ours can run while the
  // main thread is busy, and cached rates only arrive asynchronously, so the
  // first conversion cannot precede the first gap the page leaves.
  //
  // Ratcheted like every other measurement here — it may only come down. Bring
  // it down and tighten this number.
  expect(
    untilConverted,
    `the dollar price stood for ${untilConverted}ms before it was converted`,
  ).toBeLessThan(600);
});

test('the converted price is styled like the price it replaced', async () => {
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`);

  const converted = page.locator('#styled span[title^="Original: "]');
  await expect(converted).toHaveCount(1);

  // Amazon renders "$23" at 28px with a 14px superscript for the cents. A
  // replacement that lands at the body's 13px is a different thing on the
  // page: correct, and easy to miss beside the product it prices.
  const sizes = await page.evaluate(() => {
    const container = document.getElementById('styled')!;
    const ours = container.querySelector('span[title^="Original: "]')!;
    return {
      ours: parseFloat(getComputedStyle(ours).fontSize),
      container: parseFloat(getComputedStyle(container).fontSize),
      body: parseFloat(getComputedStyle(document.body).fontSize),
    };
  });

  expect(
    sizes.ours,
    `converted price renders at ${sizes.ours}px where the page's price is ${sizes.container}px`,
  ).toBeGreaterThanOrEqual(sizes.container * 0.9);
});
