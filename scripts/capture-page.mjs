// Save a real page's DOM as a test fixture.
//
// Hand-written markup encodes what I imagined the web looks like. Every bug
// this project has shipped came from the gap between that and the real thing:
// an Amazon deal block, a per-unit price on a grocery shelf, a price rendered
// after the first pass. So the fixtures are captured, not written.
//
//   node scripts/capture-page.mjs <name> <url> [--wait <ms>]
//
// Captures are committed and the tests run offline against them, so the suite
// stays deterministic and does not depend on a shop being up or unchanged.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [name, url, ...rest] = process.argv.slice(2);
if (!name || !url) {
  console.error('usage: node scripts/capture-page.mjs <name> <url> [--wait <ms>]');
  process.exit(1);
}
const waitMs = Number(rest[rest.indexOf('--wait') + 1]) || 1500;

// A desktop UA, because a phone layout is a different page with different
// markup, and the desktop one is what most of these adapters were written for.
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const browser = await chromium.launch();
const page = await browser.newPage({
  userAgent: USER_AGENT,
  viewport: { width: 1440, height: 900 },
});

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  // Retail pages hydrate their price after first paint — the shape that
  // matters most here is the one that arrives late.
  await page.waitForTimeout(waitMs);

  const captured = await page.evaluate(() => {
    // Strip what cannot affect price detection but bloats the fixture:
    // behaviour, styling, media, and anything cross-origin.
    for (
      const el of document.querySelectorAll(
        'script, style, link, noscript, iframe, svg, canvas, video, audio, source, picture',
      )
    ) el.remove();
    for (const img of document.querySelectorAll('img')) {
      img.removeAttribute('src');
      img.removeAttribute('srcset');
    }
    // Inline styles stay: bol.com identifies its real price by
    // style*="position: absolute", so they carry detection signal.
    return {
      html: document.body.innerHTML,
      lang: document.documentElement.lang || '',
      title: document.title,
    };
  });

  const dir = join(root, 'tests/pages/fixtures');
  mkdirSync(dir, { recursive: true });
  const meta = {
    name,
    url,
    hostname: new URL(url).hostname,
    lang: captured.lang,
    title: captured.title,
    capturedAt: new Date().toISOString().slice(0, 10),
    bytes: captured.html.length,
  };
  writeFileSync(join(dir, `${name}.html`), captured.html);
  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`captured ${name}: ${meta.bytes} bytes from ${meta.hostname}`);
} finally {
  await browser.close();
}
