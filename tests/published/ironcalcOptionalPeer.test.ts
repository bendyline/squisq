/**
 * The optional-peer contract for @ironcalc/wasm — now living inside
 * `@bendyline/squisq-calc` behind the `/ironcalc` subpath (Mike's call:
 * one calc package; the contract/backend separation is a MODULE boundary,
 * not an npm boundary — the harper.js-inside-editor-react precedent):
 *
 *  1. no dist JavaScript statically imports `@ironcalc/wasm`;
 *  2. the dynamic-import literal survives in the `/ironcalc` entry
 *     (tsup must not inline or rewrite it);
 *  3. the ROOT entry (`dist/index.js` + chunks outside `dist/ironcalc/`)
 *     never mentions `@ironcalc/wasm` at all — the subpath isolation that
 *     keeps contract+in-house consumers at zero adapter bytes;
 *  4. no published declaration references `@ironcalc/wasm` in type
 *     position (the monacoSubpath rule);
 *  5. the manifest declares an optional peer plus a pinned devDep, and
 *     never a regular dependency.
 *
 * Requires `npm run build` first (runs against dist/).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const calcDir = resolve(root, 'packages/calc');

function walk(dir: string, extension: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, extension));
    else if (entry.name.endsWith(extension)) files.push(full);
  }
  return files;
}

const STATIC_IMPORT_RE =
  /^import\b[^;]*from\s*['"]@ironcalc\/wasm(?:\/[^'"]*)?['"]|^import\s*['"]@ironcalc\/wasm(?:\/[^'"]*)?['"]/m;

describe('@ironcalc/wasm optional-peer contract (calc /ironcalc subpath)', () => {
  it('no dist JavaScript statically imports @ironcalc/wasm', () => {
    for (const file of walk(join(calcDir, 'dist'), '.js')) {
      const source = readFileSync(file, 'utf8');
      expect(STATIC_IMPORT_RE.test(source), `static @ironcalc/wasm import in ${file}`).toBe(false);
    }
  });

  it('the dynamic import survives in the /ironcalc entry', () => {
    const found = walk(join(calcDir, 'dist', 'ironcalc'), '.js').some((file) =>
      /import\(\s*['"]@ironcalc\/wasm['"]\s*\)/.test(readFileSync(file, 'utf8')),
    );
    expect(found, 'expected a dynamic import("@ironcalc/wasm") in dist/ironcalc').toBe(true);
  });

  it('the ROOT entry never mentions @ironcalc/wasm (subpath isolation)', () => {
    const ironcalcDir = `${join(calcDir, 'dist', 'ironcalc')}${sep}`;
    for (const file of walk(join(calcDir, 'dist'), '.js')) {
      if (file.startsWith(ironcalcDir)) continue;
      expect(
        readFileSync(file, 'utf8').includes('@ironcalc/wasm'),
        `@ironcalc/wasm reference outside dist/ironcalc: ${file}`,
      ).toBe(false);
    }
  });

  it('no published declaration references @ironcalc/wasm outside comments', () => {
    for (const file of walk(join(calcDir, 'dist'), '.d.ts')) {
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(source.includes("'@ironcalc/wasm'"), `type reference in ${file}`).toBe(false);
      expect(source.includes('"@ironcalc/wasm"'), `type reference in ${file}`).toBe(false);
    }
  });

  it('the manifest declares an optional peer plus a pinned devDep', () => {
    const manifest = JSON.parse(readFileSync(join(calcDir, 'package.json'), 'utf8')) as {
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
      exports?: Record<string, unknown>;
    };
    expect(manifest.peerDependencies?.['@ironcalc/wasm']).toBeTruthy();
    expect(manifest.peerDependenciesMeta?.['@ironcalc/wasm']?.optional).toBe(true);
    expect(manifest.devDependencies?.['@ironcalc/wasm']).toMatch(/^\d+\.\d+\.\d+$/);
    // Never a regular dependency — that would defeat the whole contract.
    expect(manifest.dependencies?.['@ironcalc/wasm']).toBeUndefined();
    // The adapter stays behind its subpath.
    expect(manifest.exports?.['./ironcalc']).toBeTruthy();
  });
});
