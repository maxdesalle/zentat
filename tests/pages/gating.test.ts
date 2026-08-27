// @vitest-environment happy-dom
//
// The fast path must read exactly what the exhaustive path reads.
//
// parsePrice skips patterns whose needles are absent from the text, and skips
// the text entirely when none of them appear. That is an assertion about every
// regex in patterns.ts — that each one requires one of the literals declared
// beside it — and a needle list that is wrong in the unsafe direction drops
// real prices while every other test stays green. That is precisely the failure
// this project keeps being burned by: the CDN$ gap cost a Canadian user all
// thirteen prices on a Steam page, and nothing failed, because nothing could
// fail for a price we never looked at.
//
// So the claim is checked rather than reasoned about, against every string the
// captured corpus contains.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parsePrice, parsePriceExhaustive } from '../../src/lib/detection/parser';
import { DEFAULT_SETTINGS } from '../../src/lib/storage/settings';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');

interface Fixture {
  name: string;
  hostname: string;
  lang: string;
  htmlPath: string;
}

const fixtures: Fixture[] = readdirSync(fixturesDir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => {
    const meta = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));
    return {
      name: meta.name,
      hostname: meta.hostname,
      lang: meta.lang ?? 'en',
      htmlPath: join(fixturesDir, `${meta.name}.html`),
    };
  })
  .filter((fixture) => statSync(fixture.htmlPath).size > 4_000);

const currencies = DEFAULT_SETTINGS.currencies;

/** Every distinct string the page puts in front of the parser. */
function stringsIn(html: string): string[] {
  document.body.innerHTML = html;
  const seen = new Set<string>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = (node.nodeValue ?? '').trim();
    // An empty string reads as no price on either path, and the corpus is
    // mostly whitespace between tags.
    if (text !== '') seen.add(text);
  }
  document.body.innerHTML = '';
  return [...seen];
}

describe('the fast path reads what the exhaustive path reads', () => {
  it.each(fixtures.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    const strings = stringsIn(readFileSync(fixture.htmlPath, 'utf8'));
    const disagreements: string[] = [];

    for (const text of strings) {
      // Both readings, because the bare-number patterns only run inside a
      // price container and the gate is bypassed there.
      for (const inContainer of [false, true]) {
        const fast = parsePrice(
          text,
          currencies,
          fixture.hostname,
          fixture.lang,
          null,
          inContainer,
        );
        const full = parsePriceExhaustive(
          text,
          currencies,
          fixture.hostname,
          fixture.lang,
          null,
          inContainer,
        );
        if (JSON.stringify(fast) !== JSON.stringify(full)) {
          disagreements.push(
            `${JSON.stringify(text.slice(0, 120))} (inPriceContainer=${inContainer}): `
              + `fast read ${JSON.stringify(fast)}, exhaustive read ${JSON.stringify(full)}`,
          );
        }
      }
    }

    expect(disagreements, disagreements.slice(0, 5).join('\n')).toEqual([]);
  });
});
