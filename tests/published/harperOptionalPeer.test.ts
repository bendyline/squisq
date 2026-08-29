/**
 * The optional-peer contract for harper.js — the proof that consumers
 * who never enable proofing pay nothing:
 *
 *  1. no STATIC `harper.js` import anywhere in editor-react's dist
 *     (the engine is reached only via dynamic import, which host
 *     bundlers keep as a separate lazily-fetched chunk);
 *  2. the dynamic-import literal DOES survive in dist (tsup must not
 *     inline or rewrite it);
 *  3. no published declaration file mentions `harper.js` — the rule
 *     established by monacoSubpath.test.ts is "public d.ts names the
 *     module ⇒ required peer", so an optional peer must keep its types
 *     out of every emitted .d.ts;
 *  4. the manifest declares the peer as optional (with a pinned devDep
 *     for local builds/tests).
 *
 * Requires `npm run build` first (runs against dist/).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const editorDir = resolve(root, 'packages/editor-react');

function walk(dir: string, extension: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, extension));
    else if (entry.name.endsWith(extension)) files.push(full);
  }
  return files;
}

/** Line-anchored static import forms (same shape as forbiddenImports). */
const STATIC_IMPORT_RE =
  /^import\b[^;]*from\s*['"]harper\.js(?:\/[^'"]*)?['"]|^import\s*['"]harper\.js(?:\/[^'"]*)?['"]/m;

describe('harper.js optional-peer contract', () => {
  it('no dist JavaScript statically imports harper.js', () => {
    for (const file of walk(join(editorDir, 'dist'), '.js')) {
      const source = readFileSync(file, 'utf8');
      expect(STATIC_IMPORT_RE.test(source), `static harper.js import in ${file}`).toBe(false);
    }
  });

  it('the dynamic import survives in the proofing entry graph', () => {
    const found = walk(join(editorDir, 'dist'), '.js').some((file) =>
      /import\(\s*['"]harper\.js['"]\s*\)/.test(readFileSync(file, 'utf8')),
    );
    expect(found, 'expected a dynamic import("harper.js") somewhere in dist').toBe(true);
  });

  it('no published declaration mentions harper.js outside comments', () => {
    for (const file of walk(join(editorDir, 'dist'), '.d.ts')) {
      // Doc comments legitimately DESCRIBE the optional peer; only a
      // type-position module reference (import type, typeof import,
      // declare module) would force it to become a required peer.
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(source.includes("'harper.js'"), `harper.js type reference in ${file}`).toBe(false);
      expect(source.includes('"harper.js"'), `harper.js type reference in ${file}`).toBe(false);
    }
  });

  it('the manifest declares an optional peer plus a pinned devDep', () => {
    const manifest = JSON.parse(readFileSync(join(editorDir, 'package.json'), 'utf8')) as {
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
      devDependencies?: Record<string, string>;
    };
    expect(manifest.peerDependencies?.['harper.js']).toBeTruthy();
    expect(manifest.peerDependenciesMeta?.['harper.js']?.optional).toBe(true);
    // Exact pin (repo save-exact convention) so builds/tests are reproducible.
    expect(manifest.devDependencies?.['harper.js']).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
