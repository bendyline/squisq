/**
 * Test 4 — for the `@bendyline/squisq` (core) package, dynamic-import
 * every subpath listed in its `package.json#exports` and verify the
 * module loads with at least one named export.
 *
 * The other three tests in this directory cover artifact shape;
 * this one is the most consumer-realistic check we can run: it
 * actually exercises the resolver against the built file the way
 * an external app would after `import '@bendyline/squisq/storage'`.
 *
 * Core gets the dedicated treatment because it has the richest
 * subpath surface in the monorepo (16 entries today) and is the
 * package where adding a subpath without wiring the corresponding
 * tsup entry has historically been easiest to overlook.
 */

import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { flattenExports, loadPublicPackages } from './_packages';

const corePkg = loadPublicPackages().find((p) => p.name === '@bendyline/squisq');

describe('@bendyline/squisq subpath imports load and expose named exports', () => {
  if (!corePkg) {
    it.fails('core package missing from registry', () => {});
    return;
  }

  // Each subpath surfaces multiple times in `flattenExports` — once
  // per conditional key (`types`, `import`, `default`). For a load
  // smoke test we want exactly one entry per subpath, and we want
  // the one pointing at the JS file. Prefer `import`, fall back to
  // `default`.
  const allLeaves = flattenExports(corePkg.pkg);
  const subpaths = Array.from(new Set(allLeaves.map((l) => l.subpath)));
  const jsLeaves = subpaths
    .map(
      (subpath) =>
        allLeaves.find((l) => l.subpath === subpath && l.condition === 'import') ??
        allLeaves.find((l) => l.subpath === subpath && l.condition === 'default'),
    )
    .filter(
      (leaf): leaf is NonNullable<typeof leaf> =>
        leaf !== undefined && leaf.relativeFile.endsWith('.js'),
    );

  for (const leaf of jsLeaves) {
    it(`@bendyline/squisq${leaf.subpath === '.' ? '' : leaf.subpath} loads via dynamic import`, async () => {
      const abs = resolve(corePkg.dir, leaf.relativeFile);
      expect(
        existsSync(abs),
        `${leaf.relativeFile} does not exist on disk. Run \`npm run build\` first.`,
      ).toBe(true);

      // Import the file by URL so Node's ESM resolver is what's
      // doing the work — same code path an external consumer hits.
      // Mod-cache hits across tests are fine; we want the load to
      // succeed, not measure cold-start cost.
      const mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;

      const exportNames = Object.keys(mod).filter((k) => k !== 'default');
      expect(
        exportNames.length,
        `${leaf.relativeFile} loaded but has no named exports — likely a wiring bug (the subpath points at the wrong tsup entry).`,
      ).toBeGreaterThan(0);
    });
  }
});
