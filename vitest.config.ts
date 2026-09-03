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
  },
});
