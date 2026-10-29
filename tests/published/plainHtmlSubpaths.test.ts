/**
 * Plain HTML is three entries. `/html` renders and imports; `/html-prepare`
 * settles a document before rendering (data tables, pictures); `/html-icons`
 * outlines inline icons. Hosts bundle `/html` into places that only render (a
 * CJS editor-extension host writing workspace catalogs), and a one-file bundle
 * inlines even the dynamic imports it can reach — so the BUILT `/html` entry
 * must reach neither the data readers (an XML parser and zip code) nor the
 * icon outlines (`@pdf-lib/fontkit` and the Font Awesome faces, ~2.5 MB), and
 * `/html-prepare` takes the outliner from its host rather than reaching it.
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
/** The data-table materializer, which reaches every data reader. */
const DATA_MATERIALIZER = /\bfunction materializeDataReferences\b/;

function runtimeOf(subpath: string): string {
  const entry = formats.pkg.exports?.[subpath];
  const runtime = typeof entry === 'object' ? (entry.import ?? entry.default) : undefined;
  expect(runtime, `${subpath} has no runtime export`).toBeDefined();
  const file = resolve(formats.dir, runtime!);
  expect(existsSync(file), `${runtime} missing — run \`npm run build\` first.`).toBe(true);
  return file;
}

function declaresTypes(subpath: string): void {
  const entry = formats.pkg.exports?.[subpath];
  expect(typeof entry).toBe('object');
  if (typeof entry === 'object') {
    expect(existsSync(resolve(formats.dir, entry.types!))).toBe(true);
  }
}

function matching(files: string[], pattern: RegExp): string[] {
  return files
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => relative(formats.dir, file));
}

const importsOf = (bare: string[], specifier: string) =>
  bare.filter((edge) => edge.endsWith(`→ ${specifier}`));

async function exportNames(subpath: string): Promise<string[]> {
  const mod = (await import(pathToFileURL(runtimeOf(subpath)).href)) as Record<string, unknown>;
  return Object.keys(mod).sort();
}

describe('@bendyline/squisq-formats/html-icons', () => {
  it('is declared in the exports map with runtime and types', () => {
    declaresTypes('./html-icons');
  });

  it('reaches the Font Awesome faces and fontkit', () => {
    // Proves the markers find the faces where they are, so their absence
    // elsewhere means something.
    const { files, bare } = reachableFiles(runtimeOf('./html-icons'), formats.dir);
    expect(matching(files, FONT_AWESOME_FACES)).not.toEqual([]);
    expect(importsOf(bare, '@pdf-lib/fontkit')).not.toEqual([]);
  });

  it('exposes only the outliner', async () => {
    expect(await exportNames('./html-icons')).toEqual(['plainHtmlIcons']);
  });
});

describe('@bendyline/squisq-formats/html-prepare', () => {
  it('is declared in the exports map with runtime and types', () => {
    declaresTypes('./html-prepare');
  });

  it('reaches the data readers but takes icon outlines from its host', () => {
    const { files, bare } = reachableFiles(runtimeOf('./html-prepare'), formats.dir);
    // Proves the materializer marker finds it where it is.
    expect(matching(files, DATA_MATERIALIZER)).not.toEqual([]);
    expect(importsOf(bare, '@xmldom/xmldom')).not.toEqual([]);
    expect(matching(files, FONT_AWESOME_FACES)).toEqual([]);
    expect(importsOf(bare, '@pdf-lib/fontkit')).toEqual([]);
  });

  it('exposes the preparation step and its check', async () => {
    expect(await exportNames('./html-prepare')).toEqual([
      'needsPlainHtmlPreparation',
      'prepareMarkdownDocForPlainHtml',
    ]);
  });
});

describe('@bendyline/squisq-formats/html', () => {
  it('reaches neither the preparation step nor the icon outlines', () => {
    const { files, bare } = reachableFiles(runtimeOf('./html'), formats.dir);
    // The walk must reach the renderer (proves it follows tsup's shared-chunk
    // re-exports rather than stopping at the stub).
    expect(matching(files, /\bfunction markdownDocToPlainHtml\b/)).not.toEqual([]);
    expect(matching(files, /\bfunction prepareMarkdownDocForPlainHtml\b/)).toEqual([]);
    expect(matching(files, DATA_MATERIALIZER)).toEqual([]);
    expect(importsOf(bare, '@xmldom/xmldom')).toEqual([]);
    expect(matching(files, FONT_AWESOME_FACES)).toEqual([]);
    expect(importsOf(bare, '@pdf-lib/fontkit')).toEqual([]);
  });
});
