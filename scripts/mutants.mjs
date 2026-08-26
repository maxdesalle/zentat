// Does the suite actually CONSTRAIN the behaviour, or merely execute it?
//
// Coverage answers "did this line run". It cannot answer "was the assertion
// right", and that gap is not academic: three of the bugs shipped in v1.1.1
// had tests asserting the broken behaviour as correct, at 100% coverage, with
// a branching-tree spec each. The machinery faithfully protected the defect.
//
// So each entry below re-introduces a bug we actually shipped. Put the bug
// back; if the suite stays green, the suite does not constrain that behaviour
// and the coverage number is telling you nothing about it.
//
// Adding to this list is the cost of fixing a bug. Not a burden — it is the
// only mechanical proof that the fix is held in place by something.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {{name: string, path: string, from: string, to: string}[]} */
const MUTANTS = [
  {
    name: 'the page unit is chosen by the smallest price on the page',
    path: 'src/lib/conversion/format.ts',
    from: 'pageDecimals = scaleFor(sorted[Math.floor((sorted.length - 1) / 2)]);',
    to: 'pageDecimals = scaleFor(sorted[0]);',
  },
  {
    name: 'small amounts switch to zats on their own',
    path: 'src/lib/conversion/format.ts',
    from: "  if (unit === 'zats') {",
    to: "  if (unit === 'zats' || Math.abs(amount) < 0.001) {",
  },
  {
    name: 'a marked ANCESTOR is treated as proof the work is done',
    path: 'src/entrypoints/content/converter.ts',
    from: 'if (node.classList.contains(CONVERTED_MARKER)) continue;',
    to: 'if (node.closest(`.${CONVERTED_MARKER}`)) continue;',
  },
  {
    name: 'any ancestor may adopt a descendant’s accessible price',
    path: 'src/lib/detection/walker.ts',
    from: '  if (accessible === null) return null;\n  const covered = digitsOf(accessible);',
    to: '  if (accessible === null) return null;\n  return accessible;\n'
      + '  const covered = digitsOf(accessible);',
  },
  {
    name: 'the concatenation guard needs two children',
    path: 'src/lib/detection/walker.ts',
    from: 'if (el.children.length < 1) return false;',
    to: 'if (el.children.length < 2) return false;',
  },
  {
    name: 'the non-price rule judges our own output as well as the page’s',
    path: 'src/lib/detection/walker.ts',
    from: '    if (isNonPriceText(trimmed)) continue;',
    to: "    if (isNonPriceText(element.textContent ?? '')) continue;",
  },
  {
    name: 'the privacy jitter applies to the very first fetch',
    path: 'src/entrypoints/background/rates.ts',
    from: 'if (current.updatedAt) {',
    to: 'if (true) {',
  },
  {
    name: 'a forced refresh cannot cut the jitter short',
    path: 'src/entrypoints/background/rates.ts',
    from: 'if (force) cutJitterShort?.();',
    to: 'if (false) cutJitterShort?.();',
  },
  {
    name: 'a bare dollar sign matches inside NZ$ and HK$',
    path: 'src/lib/detection/patterns.ts',
    from: '(?:(?<![A-Za-z])\\b${code}\\b\\s*|(?<![A-Za-z]))',
    to: '(?:(?:\\b${code}\\b\\s*)?)',
  },
  {
    name: 'the rate is applied as a divide rather than a multiply',
    path: 'src/lib/conversion/convert.ts',
    from: 'const zecAmount = parsed.amount * rate;',
    to: 'const zecAmount = parsed.amount / rate;',
  },
  {
    name: 'a partial provider result replaces the cache instead of merging',
    path: 'src/lib/storage/rates.ts',
    from: 'rates: { ...current.rates, ...incoming.rates },',
    to: 'rates: { ...incoming.rates },',
  },
  {
    name: 'the held rate re-pegs on every tick',
    path: 'src/lib/rates/held.ts',
    from: 'if (Math.abs(spotPeg - current.peg) / current.peg > band) {',
    to: 'if (Math.abs(spotPeg - current.peg) / current.peg >= 0) {',
  },
];

function suitePasses() {
  try {
    execFileSync('npx', ['vitest', 'run', '--silent'], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const survived = [];
const stale = [];

for (const { name, path, from, to } of MUTANTS) {
  const file = join(root, path);
  const original = readFileSync(file, 'utf8');
  if (!original.includes(from)) {
    // The code moved. That is not a pass — it means nobody knows whether this
    // behaviour is still held, so the mutant has to be rewritten.
    stale.push(name);
    console.log(`  STALE     ${name}`);
    continue;
  }
  try {
    writeFileSync(file, original.replace(from, to));
    if (suitePasses()) {
      survived.push(name);
      console.log(`  SURVIVED  ${name}`);
    } else {
      console.log(`  caught    ${name}`);
    }
  } finally {
    writeFileSync(file, original);
  }
}

const caught = MUTANTS.length - survived.length - stale.length;
console.log(`\n${caught}/${MUTANTS.length} caught`);

if (survived.length > 0 || stale.length > 0) {
  if (survived.length > 0) {
    console.error(
      '\nThese bugs can come back without the suite noticing. Coverage will still'
        + ' read 100% while they do:',
    );
    for (const name of survived) console.error(`  - ${name}`);
  }
  if (stale.length > 0) {
    console.error('\nThese mutants no longer apply and must be rewritten:');
    for (const name of stale) console.error(`  - ${name}`);
  }
  process.exit(1);
}
