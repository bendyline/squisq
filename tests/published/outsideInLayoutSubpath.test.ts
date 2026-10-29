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
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadPublicPackages } from './_packages';
import { reachableFiles } from './_reachable';

const formats = loadPublicPackages().find((p) => p.name === '@bendyline/squisq-formats')!;

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
    const { files, bare } = reachableFiles(entry, formats.dir);
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
      'OUTSIDE_IN_OUTPUT_TEMPLATE_KEY',
      'chooseOutsideInMarkdownPath',
      'isOutsideInTargetPath',
      'resolveOutsideInLayout',
    ]);
    const isTarget = mod.isOutsideInTargetPath as (path: string) => boolean;
    expect(isTarget('decks/Tucson.pptx')).toBe(true);
    expect(isTarget('notes/readme.md')).toBe(false);
  });
});
