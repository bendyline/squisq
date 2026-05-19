/**
 * Test 2 — guard against accidental top-level static imports of
 * "heavy" dependencies in a package's public barrel `dist/index.js`.
 *
 * The exact bug class this catches: someone writes
 * `import * as monaco from 'monaco-editor'` in any source file that
 * the barrel re-exports, and now every consumer of the package —
 * even one that only imports a type — pays for monaco's resolution
 * and (in strict ESM resolvers like Vite's import-analysis) chokes
 * on its malformed `package.json`.
 *
 * The check is intentionally simple: regex over the built bundle for
 * a static import statement targeting any HEAVY_DEP that isn't on
 * that package's allowlist. The allowlist exists because some
 * packages legitimately have a heavy dep at the top (e.g.,
 * `squisq-video` is a thin wrapper around `@ffmpeg/ffmpeg`).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPublicPackages } from './_packages';

/**
 * Dependencies large enough that an accidental static import in a
 * "light" barrel would silently degrade every downstream consumer.
 * Add to this list when a new heavyweight peer enters the codebase.
 */
const HEAVY_DEPS = [
  'monaco-editor',
  '@ffmpeg/ffmpeg',
  '@ffmpeg/util',
  'pdfjs-dist',
  'html2canvas',
] as const;

/**
 * Per-package allowlist of heavy deps that are *expected* to appear
 * as top-level static imports in `dist/index.js`. These are
 * packages where the heavy dep is the package's purpose.
 *
 * Keep this map tight — every entry here represents a deliberate
 * "yes, every consumer of this package pays this cost" decision.
 */
const ALLOWED_HEAVY: Record<string, readonly string[]> = {
  '@bendyline/squisq': [],
  '@bendyline/squisq-react': [],
  '@bendyline/squisq-formats': ['pdfjs-dist'],
  '@bendyline/squisq-video': ['@ffmpeg/ffmpeg', '@ffmpeg/util', 'html2canvas'],
  '@bendyline/squisq-video-react': ['@ffmpeg/ffmpeg', '@ffmpeg/util', 'html2canvas'],
  // editor-react deliberately keeps monaco-editor *off* this list —
  // the package lazy-loads monaco through `useMonacoLoader` so that
  // consumers who only import JsonEditor or a type don't drag in
  // monaco's ~9MB of language services. See
  // `packages/editor-react/src/useMonacoLoader.ts`.
  '@bendyline/squisq-editor-react': [],
  '@bendyline/squisq-cli': ['pdfjs-dist'],
};

/**
 * Detect a top-level static `import ... from "<dep>"` for a single
 * dep. We anchor to the start of a line so that occurrences inside
 * strings, comments mid-line, or other contexts don't false-positive.
 * `\\s` and `[^'"]*` are escaped for the RegExp constructor.
 */
function hasStaticImport(source: string, dep: string): boolean {
  const escaped = dep.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  // Matches: `import X from 'dep'`, `import * as X from "dep"`,
  // `import 'dep'`, `import { X } from 'dep'`, with single or double
  // quotes. The `^` + `m` flag pins it to a line start so the
  // expression is *top-level* in the bundle, not nested inside a
  // function body.
  const re = new RegExp(
    `^import\\b[^;]*from\\s*['"]${escaped}['"]|^import\\s*['"]${escaped}['"]`,
    'm',
  );
  return re.test(source);
}

describe('public barrels are free of accidental heavy static imports', () => {
  const packages = loadPublicPackages();
  for (const pkg of packages) {
    describe(pkg.name, () => {
      const barrelPath = resolve(pkg.dist, 'index.js');
      const allowed = ALLOWED_HEAVY[pkg.name] ?? [];

      for (const dep of HEAVY_DEPS) {
        const expectation = allowed.includes(dep) ? 'allowed' : 'forbidden';
        it(`${dep}: ${expectation}`, () => {
          // Skip — and clearly state why — if there's no barrel.
          // (Some packages may publish only subpaths in the future.)
          let source: string;
          try {
            source = readFileSync(barrelPath, 'utf8');
          } catch {
            expect.fail(
              `${pkg.name}: dist/index.js missing. Run \`npm run build\` before \`npm run test:published\`.`,
            );
            return;
          }
          const present = hasStaticImport(source, dep);
          if (allowed.includes(dep)) {
            // Allowed deps don't *have* to be present, but we don't
            // fail either way — they're documented expectations.
            return;
          }
          expect(
            present,
            `${pkg.name}'s dist/index.js contains a top-level \`import ... from '${dep}'\`. Heavy deps must be lazy-loaded (see useMonacoLoader for the pattern) or, if intentional, added to ALLOWED_HEAVY['${pkg.name}'] in this test file.`,
          ).toBe(false);
        });
      }
    });
  }
});
