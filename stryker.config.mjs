// Mutation testing: does the suite CONSTRAIN the code, or only execute it?
//
// Line coverage sat at 100% beside six shipped bugs, three of which had tests
// asserting the broken behaviour as correct. This asks the harder question —
// change the code, and does anything fail?
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.ts' },
  reporters: ['progress', 'clear-text', 'json'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  coverageAnalysis: 'perTest',
  mutate: [
    'src/**/*.ts',
    // Entrypoint glue: page bootstrap and message wiring, excluded from line
    // coverage for the same reason and on the same list.
    '!src/entrypoints/*/index.ts',
    '!src/entrypoints/*/main.ts',
    '!src/entrypoints/*.chrome/main.ts',
    '!src/entrypoints/background/quick.ts',
    '!src/entrypoints/background/alarms.ts',
    '!src/**/types.ts',
    '!src/**/*.d.ts',
  ],
  thresholds: { high: 100, low: 100, break: 100 },
  timeoutMS: 20000,
  concurrency: 4,
};
