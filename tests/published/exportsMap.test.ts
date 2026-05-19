/**
 * Test 1 — every `package.json#exports` entry of every public
 * package points to a file that exists in the freshly-built `dist/`.
 *
 * Catches: subpath added to the exports map but the corresponding
 * tsup entry forgotten ("./X added but ./dist/X/index.js missing"),
 * stale paths after a refactor, typos in the conditional-export
 * object, deletions that didn't update the manifest.
 *
 * Each export leaf is asserted independently so a single missing
 * file surfaces as one named failure rather than tanking the whole
 * package check.
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flattenExports, loadPublicPackages } from './_packages';

const packages = loadPublicPackages();

describe('package.json#exports entries resolve to real files', () => {
  for (const pkg of packages) {
    describe(pkg.name, () => {
      const leaves = flattenExports(pkg.pkg);

      it('declares an exports map (or main + types)', () => {
        // A published package without `exports` is legal but a foot-gun;
        // every Squisq package uses one. If this ever becomes
        // intentional, drop the package from the registry instead.
        expect(pkg.pkg.exports, `${pkg.name} has no "exports" entry`).toBeDefined();
      });

      for (const leaf of leaves) {
        it(`${leaf.subpath} (${leaf.condition}) → ${leaf.relativeFile}`, () => {
          const absolute = resolve(pkg.dir, leaf.relativeFile);
          expect(
            existsSync(absolute),
            `${pkg.name}#exports["${leaf.subpath}"].${leaf.condition} → ${leaf.relativeFile} does not exist after build. Run \`npm run build\` first, or fix the manifest / tsup entries.`,
          ).toBe(true);
          // Sanity: it's a file, not a directory.
          if (existsSync(absolute)) {
            expect(
              statSync(absolute).isFile(),
              `${leaf.relativeFile} is a directory, not a file`,
            ).toBe(true);
          }
        });
      }
    });
  }
});
