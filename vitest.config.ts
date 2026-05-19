import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'e2e/**',
      'packages/cli/**',
      // `tests/published/**` is the built-artifact suite. It runs
      // against `packages/*/dist` after `npm run build` via
      // `npm run test:published`, with its own `vitest.published.config.ts`.
      'tests/published/**',
    ],
    setupFiles: ['./vitest.setup.ts'],
  },
});
