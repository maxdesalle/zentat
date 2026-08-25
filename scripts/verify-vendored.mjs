// Fail the build if a vendored binary or bundled third-party file is not
// byte-for-byte what we reviewed.
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
//   shasum -a 256 node_modules/@nymproject/mix-fetch/*.wasm \
//     node_modules/qrcode-generator/dist/qrcode.js
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const expected = new Map(
  readFileSync(join(here, 'vendored.sha256'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, name] = line.trim().split(/\s+/);
      return [name, hash];
    }),
);

let failed = false;
// Plain paths under node_modules. require.resolve is no use here: a package's
// "exports" map can forbid deep imports (and even ./package.json), and we are
// reading these files rather than importing them.
const RESOLVE = {
  'go_conn.wasm': '@nymproject/mix-fetch/go_conn.wasm',
  'mix_fetch_wasm_bg.wasm': '@nymproject/mix-fetch/mix_fetch_wasm_bg.wasm',
  'qrcode.js': 'qrcode-generator/dist/qrcode.js',
};

const NODE_MODULES = join(here, '..', 'node_modules');

for (const [name, hash] of expected) {
  const relative = RESOLVE[name];
  if (!relative) {
    console.error(`No resolution rule for ${name}`);
    failed = true;
    continue;
  }
  const path = join(NODE_MODULES, relative);
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (actual !== hash) {
    console.error(`Vendored file changed: ${name}\n  expected ${hash}\n  actual   ${actual}`);
    failed = true;
  }
}

if (failed) {
  console.error('\nRefusing to build. Review the change before updating scripts/vendored.sha256.');
  process.exit(1);
}
console.log(`Vendored files verified (${expected.size}).`);
