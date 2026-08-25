// Verify that every branch written in a .tree file is actually tested.
//
// A tree is a specification. Left unchecked it drifts from the tests, and a
// stale specification is worse than none — it reads as a guarantee while
// guaranteeing nothing. This makes the drift a build failure.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const treeDir = join(here, '..', 'tests', 'trees');
const testDir = join(here, '..', 'tests', 'unit');

/** Branch and leaf text, stripped of the drawing characters. */
function parseTree(source) {
  const nodes = [];
  for (const line of source.split('\n')) {
    const text = line.replace(/^[\s│├└─]+/u, '').trim();
    if (!text) continue;
    // The root names the suite; it is not a branch.
    if (!/^[\s│├└─]/u.test(line)) continue;
    nodes.push(text);
  }
  return nodes;
}

const trees = readdirSync(treeDir).filter((name) => name.endsWith('.tree'));
let failed = false;

for (const treeName of trees) {
  const base = treeName.replace(/\.tree$/, '');
  const testName = `${base}.test.ts`;
  let test;
  try {
    test = readFileSync(join(testDir, testName), 'utf8');
  } catch {
    console.error(`${treeName}: no matching ${testName}`);
    failed = true;
    continue;
  }

  const missing = parseTree(readFileSync(join(treeDir, treeName), 'utf8'))
    // Text is compared, not position: the tree is the spec, the nesting in the
    // test is how JavaScript expresses it.
    //
    // A leaf reads "it returns null" in the tree and `it('returns null')` in
    // the test, so the leading "it " belongs to the keyword rather than the
    // text — strip it before looking.
    .filter((node) => {
      const text = node.startsWith('it ') ? node.slice(3) : node;
      return !test.includes(`'${text}'`) && !test.includes(`"${text}"`)
        && !test.includes(`\`${text}\``);
    });

  if (missing.length > 0) {
    failed = true;
    console.error(`\n${treeName}: ${missing.length} branch(es) in the tree with no test:`);
    for (const node of missing) console.error(`  - ${node}`);
  }
}

if (failed) {
  console.error('\nEvery branch in a .tree must have a test with the same text.');
  process.exit(1);
}
console.log(`Trees verified (${trees.length}).`);
