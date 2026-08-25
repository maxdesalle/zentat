// Which BRANCHES are still uncovered, by file and line.
//
// The text reporter lists uncovered LINES, which for a file at 100% lines and
// 89% branches tells you nothing at all — the line ran, one arm of it did not.
// Run `vitest run --coverage` first; this reads what it wrote.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const filter = process.argv[2];
const coverage = JSON.parse(readFileSync(join(root, 'coverage/coverage-final.json'), 'utf8'));

let total = 0;
for (const [file, data] of Object.entries(coverage).sort()) {
  const short = file.split('/src/')[1] ?? file;
  if (filter && !short.includes(filter)) continue;
  const src = readFileSync(file, 'utf8').split('\n');
  const misses = [];
  for (const [id, counts] of Object.entries(data.b)) {
    counts.forEach((count, arm) => {
      if (count !== 0) return;
      const { start, end } = data.branchMap[id].locations[arm];
      // The arm's own source, which is what tells you what to write a test
      // for — a line number alone leaves you guessing which half is missing.
      const text = start.line === end.line
        ? src[start.line - 1].slice(start.column, end.column)
        : `${src[start.line - 1].slice(start.column)} …`;
      misses.push({ line: data.branchMap[id].loc.start.line, text: text.trim() });
    });
  }
  if (!misses.length) continue;
  total += misses.length;
  console.log(`\n${short}`);
  for (const { line, text } of misses.sort((a, b) => a.line - b.line)) {
    console.log(`  ${String(line).padStart(4)}  ${text.slice(0, 90)}`);
  }
}
console.log(total ? `\n${total} uncovered branch(es).` : 'Every branch covered.');
