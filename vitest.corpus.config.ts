/**
 * vitest.corpus.config.ts — separate config for the data-corpus test tier
 * at `tests/corpus/`.
 *
 * These tests sweep real-world files (government open-data XLSX/CSV, fetched
 * by `scripts/corpus-fetch.mjs` into the gitignored `.corpus/` directory —
 * see `tests/corpus/manifest.json` for the committed URL+hash manifest)
 * through the importers and extract the cached-value oracle dataset. They
 * are network-fetched content and take minutes, so they are OPT-IN:
 *
 *   node scripts/corpus-fetch.mjs   # once, to populate .corpus/
 *   npm run test:corpus
 *
 * Without a populated `.corpus/` the suite SKIPS with a warning (set
 * SQUISQ_CORPUS=required to make absence a failure, for corpus-CI jobs).
 * `vitest.config.ts` excludes `tests/corpus/**` so `npm test` never touches
 * this tier.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/corpus/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    // A full sweep parses hundreds of real workbooks.
    testTimeout: 120_000,
  },
});
