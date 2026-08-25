// Verify that every branch written in a .tree file is actually tested, in the
// same nesting the tree describes.
//
// A tree is a specification. Left unchecked it drifts from the tests, and a
// stale specification is worse than none — it reads as a guarantee while
// guaranteeing nothing. This makes the drift a build failure.
//
// Paths are compared, not just texts. Matching text alone lets a test drift out
// from under its branch: the tree says "given the page published an address ->
// it renders a QR", the test has both strings but the QR case sits at the top
// level, and nobody notices. That is exactly the kind of quiet slippage the
// tree exists to prevent.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const treeDir = join(here, '..', 'tests', 'trees');
const testDir = join(here, '..', 'tests', 'unit');

const DRAWING = /^[\s│├└─]+/u;

/**
 * Every root-to-leaf-and-intermediate path in a tree, as arrays of branch text.
 * Depth comes from the drawing prefix, which is four characters per level.
 */
function treePaths(source) {
  const paths = [];
  const stack = [];
  for (const line of source.split('\n')) {
    if (!line.trim()) continue;
    // The root names the suite; it is not a branch.
    if (!DRAWING.test(line)) continue;
    const prefix = DRAWING.exec(line)[0];
    // Four characters per level ("├── ", "│   ", "    "), and the first level
    // sits at depth 0 because the root is not a branch.
    const depth = prefix.length / 4 - 1;
    const text = line.slice(prefix.length).trim();
    stack.length = depth;
    stack[depth] = text.startsWith('it ') ? text.slice(3) : text;
    paths.push([...stack]);
  }
  return paths;
}

/**
 * Every describe/it path in a test file, as arrays of title text.
 *
 * Nesting comes from indentation rather than a parser: dprint enforces two
 * spaces per level and CI checks the formatting, so indentation is as reliable
 * here as an AST and costs nothing.
 */
function testPaths(source) {
  const paths = [];
  const stack = [];
  for (const line of source.split('\n')) {
    const match = /^(\s*)(describe|it)\(\s*(['"`])((?:[^\\]|\\.)*?)\3/.exec(line);
    if (!match) continue;
    const depth = match[1].length / 2;
    stack.length = depth;
    stack[depth] = match[4].replace(/\\(.)/g, '$1');
    paths.push([...stack]);
  }
  return paths;
}

const trees = readdirSync(treeDir).filter((name) => name.endsWith('.tree'));
let failed = false;

for (const treeName of trees) {
  const base = treeName.replace(/\.tree$/, '');
  const testName = `${base}.test.ts`;
  let source;
  try {
    source = readFileSync(join(testDir, testName), 'utf8');
  } catch {
    console.error(`${treeName}: no matching ${testName}`);
    failed = true;
    continue;
  }

  const inTest = new Set(testPaths(source).map((path) => path.join(' > ')));
  const missing = treePaths(readFileSync(join(treeDir, treeName), 'utf8'))
    .map((path) => path.join(' > '))
    .filter((path) => !inTest.has(path));

  if (missing.length > 0) {
    failed = true;
    console.error(`\n${treeName}: ${missing.length} branch(es) with no test at that path:`);
    for (const path of missing) console.error(`  - ${path}`);
  }
}

if (failed) {
  console.error('\nEvery branch in a .tree must have a test nested the same way.');
  process.exit(1);
}
console.log(`Trees verified (${trees.length}).`);
