/**
 * vitest.published.config.ts — separate config for the "library shape"
 * test suite at `tests/published/`.
 *
 * The tests here run against the freshly-built `packages/<pkg>/dist`
 * artifacts, not against `src/`. They catch publishing-shape bugs
 * that the in-tree vitest suite can't see — e.g. extensionless ESM
 * imports, accidental top-level heavy-dep imports, broken
 * `package.json#exports` entries.
 *
 * Run after `npm run build`:
 *   npm run test:published
 *
 * The companion `vitest.config.ts` excludes `tests/published/**` so
 * the normal `npm test` flow stays fast and source-only.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // jsdom so browser-only globals (window, document, URL) are
    // present when a published bundle is dynamic-imported and its
    // top-level code touches them. Node-only globals still work.
    environment: 'jsdom',
    include: ['tests/published/**/*.test.ts'],
    // Don't pull in the normal exclude rules — we want these tests to
    // run regardless of any per-package opt-outs.
    exclude: ['**/node_modules/**'],
    // Each test file owns its own dist scan; parallelizing across
    // files is fine.
    //
    // Nearly every test here cold-imports one or more built bundles,
    // and parallel files contend for those imports — a single
    // `import()` of a large entry routinely takes 3-5s on a busy
    // machine. vitest's 5s default turns that load time into spurious
    // timeouts, so the whole tier gets a load-bound budget instead.
    testTimeout: 30_000,
  },
});
