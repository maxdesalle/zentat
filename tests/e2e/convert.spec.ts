import { type BrowserContext, chromium, expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../../dist/chrome-mv3');

// Content scripts don't inject into data: URLs, so the fixture is served on a
// routed https origin instead.
const FIXTURE_URL = 'https://fixture.zentat.invalid/';
const FIXTURE_HTML = `
  <!DOCTYPE html><html><body>
    <p id="usd">Price: $19.99</p>
    <p id="eu">Kost 1.234,56 &euro;</p>
    <button id="cta">Pay $49.99 now</button>
  </body></html>
`;

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
    `${FIXTURE_URL}**`,
    (route) => route.fulfill({ contentType: 'text/html', body: FIXTURE_HTML }),
  );

  // Seed cached rates so the test needs no network access
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  await sw.evaluate(async () => {
    await chrome.storage.local.set({
      rates: {
        rates: { USD: 0.00125, EUR: 0.0013 },
        updatedAt: Date.now(),
        source: 'e2e',
      },
    });
  });
});

test.afterAll(async () => {
  await context?.close();
});

test('converts prices, keeps buttons fiat, and tooltips show the original', async () => {
  const page = await context.newPage();
  await page.goto(FIXTURE_URL);

  const converted = page.locator('#usd .zentat-converted');
  await expect(converted).toHaveCount(1);
  await expect(converted).toHaveAttribute('data-zentat-original', '$19.99');
  await expect(converted).toHaveAttribute('title', 'Original: $19.99');
  await expect(converted).toContainText('ZEC');

  // Checkout CTAs are never rewritten
  await expect(page.locator('#cta')).toHaveText('Pay $49.99 now');

  // The page body was never hidden
  const visibility = await page.evaluate(() => getComputedStyle(document.body).visibility);
  expect(visibility).toBe('visible');
});
