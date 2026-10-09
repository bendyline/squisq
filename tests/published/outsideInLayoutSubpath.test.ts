/**
 * `@bendyline/squisq-formats/outside-in-layout` is the registry-free half of
 * the outside-in contract. Hosts bundle it into places where the format
 * runtimes must never land (a CJS editor-extension host, a file-tree walker),
 * so the BUILT entry — not just its source — must reach only its own code:
 * no bare-specifier imports (`@bendyline/squisq`, jszip, pdf-lib, …) and no
 * shared chunk that drags in the registry.
 *
 * Walks every static and dynamic relative import reachable from the entry.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadPublicPackages } from './_packages';

const formats = loadPublicPackages().find((p) => p.name === '@bendyline/squisq-formats')!;

const SPECIFIER_RE =
  /(?:^|[\s;])(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

function specifiersOf(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(SPECIFIER_RE)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) found.push(specifier);
  }
  return found;
}

function reachableFiles(entry: string): { files: string[]; bare: string[] } {
  const files: string[] = [];
  const bare: string[] = [];
  const queue = [entry];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(file);
    for (const specifier of specifiersOf(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('.')) queue.push(resolve(dirname(file), specifier));
      else bare.push(`${relative(formats.dir, file)} → ${specifier}`);
    }
  }
  return { files, bare };
}

describe('@bendyline/squisq-formats/outside-in-layout', () => {
  const exportsEntry = formats.pkg.exports?.['./outside-in-layout'];
  const runtime =
    typeof exportsEntry === 'object' ? (exportsEntry.import ?? exportsEntry.default) : undefined;

  it('is declared in the exports map with runtime and types', () => {
    expect(typeof exportsEntry).toBe('object');
    expect(runtime).toBeDefined();
    if (typeof exportsEntry === 'object') {
      expect(existsSync(resolve(formats.dir, exportsEntry.types!))).toBe(true);
    }
  });

  it('reaches no package import and no registry code', () => {
    const entry = resolve(formats.dir, runtime!);
    expect(existsSync(entry), `${runtime} missing — run \`npm run build\` first.`).toBe(true);
    const { files, bare } = reachableFiles(entry);
    // The walk must actually reach the implementation (proves it follows
    // tsup's shared-chunk re-exports rather than stopping at the stub).
    expect(
      files.some((file) => /function resolveOutsideInLayout\b/.test(readFileSync(file, 'utf8'))),
    ).toBe(true);
    expect(bare).toEqual([]);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, relative(formats.dir, file)).not.toMatch(
        /\b(?:defaultRegistry|createRegistry|ConversionError)\b/,
      );
    }
  });

  it('loads and exposes the synchronous path rules', async () => {
    const mod = (await import(pathToFileURL(resolve(formats.dir, runtime!)).href)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(mod).sort()).toEqual([
      'OUTSIDE_IN_FORMAT_IDS',
      'chooseOutsideInMarkdownPath',
      'isOutsideInTargetPath',
      'resolveOutsideInLayout',
    ]);
    const isTarget = mod.isOutsideInTargetPath as (path: string) => boolean;
    expect(isTarget('decks/Tucson.pptx')).toBe(true);
    expect(isTarget('notes/readme.md')).toBe(false);
  });
});
