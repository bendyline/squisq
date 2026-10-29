/**
 * Inline-icon outlines for plain HTML live behind their own entry,
 * `@bendyline/squisq-formats/html-icons`, because they are read with
 * `@pdf-lib/fontkit` from the Font Awesome faces (~2.5 MB together). Hosts
 * bundle `/html` into places that never draw an icon (a CJS editor-extension
 * host rendering workspace catalogs), and a one-file bundle inlines even the
 * dynamic imports it can reach — so the BUILT `/html` entry must reach neither.
 */

import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadPublicPackages } from './_packages';
import { reachableFiles } from './_reachable';

const formats = loadPublicPackages().find((p) => p.name === '@bendyline/squisq-formats')!;

/** Code that only the Font Awesome faces module (and the data it embeds) defines. */
const FONT_AWESOME_FACES = /\b(?:fontAwesomeFace|fontAwesomeSolidData)\b/;

function runtimeOf(subpath: string): string {
  const entry = formats.pkg.exports?.[subpath];
  const runtime = typeof entry === 'object' ? (entry.import ?? entry.default) : undefined;
  expect(runtime, `${subpath} has no runtime export`).toBeDefined();
  const file = resolve(formats.dir, runtime!);
  expect(existsSync(file), `${runtime} missing — run \`npm run build\` first.`).toBe(true);
  return file;
}

function facesIn(files: string[]): string[] {
  return files
    .filter((file) => FONT_AWESOME_FACES.test(readFileSync(file, 'utf8')))
    .map((file) => relative(formats.dir, file));
}

describe('@bendyline/squisq-formats/html-icons', () => {
  it('is declared in the exports map with runtime and types', () => {
    const entry = formats.pkg.exports?.['./html-icons'];
    expect(typeof entry).toBe('object');
    if (typeof entry === 'object') {
      expect(existsSync(resolve(formats.dir, entry.types!))).toBe(true);
    }
  });

  it('reaches the Font Awesome faces and fontkit', () => {
    // Proves the markers below find the faces where they are, so their
    // absence from `/html` means something.
    const { files, bare } = reachableFiles(runtimeOf('./html-icons'), formats.dir);
    expect(facesIn(files)).not.toEqual([]);
    expect(bare.some((edge) => edge.endsWith('→ @pdf-lib/fontkit'))).toBe(true);
  });

  it('exposes only the outliner', async () => {
    const mod = (await import(pathToFileURL(runtimeOf('./html-icons')).href)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(mod)).toEqual(['plainHtmlIcons']);
    expect(typeof mod.plainHtmlIcons).toBe('function');
  });
});

describe('@bendyline/squisq-formats/html', () => {
  it('reaches neither the Font Awesome faces nor fontkit', () => {
    const { files, bare } = reachableFiles(runtimeOf('./html'), formats.dir);
    // The walk must reach the preparation step that takes the outliner.
    expect(
      files.some((file) =>
        /function prepareMarkdownDocForPlainHtml\b/.test(readFileSync(file, 'utf8')),
      ),
    ).toBe(true);
    expect(facesIn(files)).toEqual([]);
    expect(bare.filter((edge) => edge.endsWith('→ @pdf-lib/fontkit'))).toEqual([]);
  });
});
