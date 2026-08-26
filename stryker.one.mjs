// Per-module mutation config, so several runs can go at once without fighting
// over one temp directory or one report file. Point it at a file with
// STRYKER_TARGET and give the run its own slug with STRYKER_SLUG.
const target = process.env.STRYKER_TARGET;
const slug = process.env.STRYKER_SLUG ?? 'one';
if (!target) throw new Error('set STRYKER_TARGET to the file to mutate');

export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.ts' },
  reporters: ['clear-text', 'json'],
  jsonReporter: { fileName: `reports/mutation/${slug}.json` },
  tempDirName: `.stryker-tmp-${slug}`,
  // Every parallel run's sandbox is a sibling directory, and Stryker only
  // ignores the DEFAULT temp dir by name — so without this each run copies
  // the others into its own sandbox and dies partway through.
  // NOT .wxt — tsconfig.json extends the tsconfig WXT generates in there, and
  // without it the sandbox cannot resolve a single type.
  ignorePatterns: ['.stryker-tmp-*', 'reports'],
  coverageAnalysis: 'perTest',
  mutate: [target],
  thresholds: { high: 100, low: 100, break: 100 },
  timeoutMS: 20000,
  concurrency: 2,
};
