import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.stryker-tmp/**',
      'e2e/**',
      'packages/cli/**',
      // `tests/published/**` is the built-artifact suite. It runs
      // against `packages/*/dist` after `npm run build` via
      // `npm run test:published`, with its own `vitest.published.config.ts`.
      'tests/published/**',
      // `tests/corpus/**` is the opt-in real-world-file tier (fetched
      // content, minutes-long) — run via `npm run test:corpus`.
      'tests/corpus/**',
    ],
    setupFiles: ['./vitest.setup.ts'],
    // Vitest forks one worker per core (minus one) and talks to each over an
    // IPC pipe. On a many-core Windows machine that load can make a pipe write
    // fail with a quota/resource error libuv reports as `write UNKNOWN`; Vitest
    // then drops that worker's test file and fails the run with "Worker forks
    // emitted error". Halving the workers relieves that pressure; a CLI
    // `--maxWorkers` still wins.
    maxWorkers: process.platform === 'win32' ? '50%' : undefined,
  },
});
