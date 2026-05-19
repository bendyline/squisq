/**
 * Test 3 — scan every `.js` file under every published package's
 * `dist/` for relative imports that lack an extension. Strict ESM
 * resolvers (Node's native loader, Vite's bundler-mode strict
 * resolver) require an explicit `.js` extension on every relative
 * specifier; the loose forms compile in TS but fail at runtime in
 * pure-ESM consumers.
 *
 * Concretely, this catches the failure mode where `tsc -b` is
 * allowed to emit into the same `outDir` that tsup writes to: the
 * per-file tsc shadow tree overlays the bundled `dist/index.js`
 * with extensionless imports (TS doesn't rewrite specifiers without
 * an explicit `rewriteRelativeImportExtensions` flag), and a
 * downstream consumer's strict resolver rejects the package on load.
 * That bug shipped in editor-react 1.5.1 — keep this test green to
 * prevent the next one.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPublicPackages } from './_packages';

/**
 * Recursively yield every regular file path under `root` whose name
 * matches `predicate`. Skips symlinks and hidden directories so we
 * don't accidentally walk into `.tsbuildinfo` siblings or vendored
 * worker copies that some packages emit beside `dist/`.
 */
function* walkFiles(root: string, predicate: (name: string) => boolean): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const abs = join(root, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      yield* walkFiles(abs, predicate);
    } else if (stat.isFile() && predicate(entry)) {
      yield abs;
    }
  }
}

/**
 * Capture every relative import / export specifier (the part in
 * quotes) from a JS file. Static-import / re-export forms only —
 * dynamic `import(...)` calls usually represent intentional paths
 * the author wrote, so we skip them here to keep the diagnostic
 * focused on the bug class this test exists to catch (tsc shadow
 * trees, where every emitted file gets extensionless static imports).
 *
 * Group 1 captures the path itself (e.g. `./foo`, `../bar.js`).
 */
const RELATIVE_IMPORT = /(?:^|[\s;{}])(?:import|export)\b[^'";]*?['"](\.{1,2}\/[^'"]+)['"]/gm;

/**
 * A specifier is "extensionless" if its final path segment doesn't
 * contain a dot. We deliberately accept *any* extension (`.js`,
 * `.json`, `.css`, `.mjs`, `.wasm`, ...) so the test doesn't
 * false-positive on legitimate non-JS imports tsup might emit.
 */
function isExtensionless(specifier: string): boolean {
  const lastSegment = specifier.split('/').pop() ?? '';
  return !lastSegment.includes('.');
}

/** Collect every extensionless relative specifier in a source file. */
function findExtensionlessSpecifiers(source: string): string[] {
  const offenders: string[] = [];
  for (const match of source.matchAll(RELATIVE_IMPORT)) {
    const specifier = match[1];
    if (isExtensionless(specifier)) offenders.push(specifier);
  }
  return offenders;
}

describe('relative imports in dist files include an explicit extension', () => {
  const packages = loadPublicPackages();
  for (const pkg of packages) {
    it(`${pkg.name}: no extensionless relative imports anywhere in dist`, () => {
      const offenders: Array<{ file: string; specifiers: string[] }> = [];
      for (const file of walkFiles(pkg.dist, (name) => name.endsWith('.js'))) {
        const text = readFileSync(file, 'utf8');
        const found = findExtensionlessSpecifiers(text);
        if (found.length > 0) {
          offenders.push({
            file: file.slice(pkg.dist.length + 1),
            specifiers: Array.from(new Set(found)).slice(0, 8),
          });
        }
      }
      if (offenders.length > 0) {
        const detail = offenders
          .map(
            ({ file, specifiers }) =>
              `  - ${file}\n${specifiers.map((s) => `      from '${s}'`).join('\n')}`,
          )
          .join('\n');
        expect.fail(
          `${pkg.name}: ${offenders.length} dist file(s) contain extensionless relative imports — these break strict ESM resolvers (Node native ESM, Vite bundler mode). Likely cause: \`tsc -b\` is emitting a per-file shadow tree on top of tsup's bundled output. Verify the package's tsconfig has \`noEmit: true\` and re-run \`npm run clean && npm run build\`.\n${detail}`,
        );
      }
    });
  }
});

// Self-test the matcher so a future tweak that breaks detection
// surfaces as its own failure rather than silently passing every
// package.
describe('extensionless-import matcher sanity', () => {
  it.each([
    [`import { x } from './foo';`, ['./foo']],
    [`import x from "../bar";`, ['../bar']],
    [`export * from './baz';`, ['./baz']],
    [`export { a, b } from './nested/dir';`, ['./nested/dir']],
  ])('flags %s', (snippet, expected) => {
    expect(findExtensionlessSpecifiers(snippet)).toEqual(expected);
  });

  it.each([
    `import { x } from './foo.js';`,
    `import x from '../bar.js';`,
    `import data from './data.json';`,
    `import styles from './style.css';`,
    `import x from 'external-pkg';`,
    `import x from '@scope/pkg';`,
    `import { y } from './nested/dir.js';`,
    `import { z } from '../chunk-ABCD1234.js';`,
  ])('does not flag %s', (snippet) => {
    expect(findExtensionlessSpecifiers(snippet)).toEqual([]);
  });
});
