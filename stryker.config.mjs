import process from 'node:process';

const isWindows = process.platform === 'win32';

/** @type {import('@stryker-mutator/api/core').StrykerOptions} */
export default {
  $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner'],
  mutate: [
    'packages/core/src/versions/snapshotStore.ts',
    'packages/formats/src/shared/officeHyperlinks.ts',
    'packages/formats/src/shared/zipSafety.ts',
    'packages/formats/src/csv/index.ts',
  ],
  vitest: {
    configFile: 'vitest.stryker.config.ts',
    related: true,
  },
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: {
    fileName: 'reports/mutation/index.html',
  },
  thresholds: {
    high: 85,
    low: 70,
    break: 60,
  },
  timeoutMS: 20000,
  // Concurrent Vitest child processes have intermittently terminated with
  // Windows access violations. Keep CI throughput while making local Windows
  // mutation runs deterministic; callers can still override this via the CLI.
  concurrency: isWindows ? 1 : 4,
};
