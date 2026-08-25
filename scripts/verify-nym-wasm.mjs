// Fail the build if the Nym WASM is not byte-for-byte what we reviewed.
//
// The npm package carries no provenance attestation, is published from an
// unpinned workflow that creates no git tag, and embeds a build timestamp that
// makes rebuilding it pointless — so there is nothing upstream to verify
// against. Pinning the version defends against a hostile republish only if
// something actually checks the bytes. This is that check.
//
// To roll the dependency forward: review the diff of the package's small JS
// glue (that is where a payload would go — the multi-megabyte WASM is only
// needed for plausibility), then regenerate this file with:
//   shasum -a 256 node_modules/@nymproject/mix-fetch/*.wasm
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

const expected = new Map(
  readFileSync(join(here, 'nym-wasm.sha256'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, name] = line.trim().split(/\s+/);
      return [name, hash];
    }),
);

let failed = false;
for (const [name, hash] of expected) {
  const path = require.resolve(`@nymproject/mix-fetch/${name}`);
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (actual !== hash) {
    console.error(`Nym WASM changed: ${name}\n  expected ${hash}\n  actual   ${actual}`);
    failed = true;
  }
}

if (failed) {
  console.error('\nRefusing to build. Review the change before updating scripts/nym-wasm.sha256.');
  process.exit(1);
}
console.log(`Nym WASM verified (${expected.size} files).`);
