import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as layout from '../outside-in/layout.js';
import * as outsideIn from '../outside-in/index.js';
import {
  OUTSIDE_IN_FORMAT_IDS,
  chooseOutsideInMarkdownPath,
  isOutsideInTargetPath,
  resolveOutsideInLayout,
  type OutsideInFormatId,
} from '../outside-in/layout.js';

const layoutSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../outside-in/layout.ts'),
  'utf8',
);

describe('outside-in layout subpath', () => {
  it('imports nothing, so bundling it never reaches the registry or a format runtime', () => {
    // Any static or dynamic import — the registry, core's markdown, a format
    // module — would defeat the point of the lightweight entry.
    expect(layoutSource).not.toMatch(/^\s*import\b/m);
    expect(layoutSource).not.toMatch(/^\s*export\s+(?:\*|\{[^}]*\})\s+from\b/m);
    expect(layoutSource).not.toMatch(/\bimport\s*\(/);
    expect(layoutSource).not.toMatch(/\brequire\s*\(/);
  });

  it('is re-exported unchanged by /outside-in', () => {
    expect(outsideIn.resolveOutsideInLayout).toBe(layout.resolveOutsideInLayout);
    expect(outsideIn.chooseOutsideInMarkdownPath).toBe(layout.chooseOutsideInMarkdownPath);
    expect(outsideIn.isOutsideInTargetPath).toBe(layout.isOutsideInTargetPath);
    expect(outsideIn.OUTSIDE_IN_FORMAT_IDS).toBe(layout.OUTSIDE_IN_FORMAT_IDS);
  });

  it('exposes exactly the synchronous path rules', () => {
    expect(Object.keys(layout).sort()).toEqual([
      'OUTSIDE_IN_FORMAT_IDS',
      'chooseOutsideInMarkdownPath',
      'isOutsideInTargetPath',
      'resolveOutsideInLayout',
    ]);
    const ids: readonly OutsideInFormatId[] = OUTSIDE_IN_FORMAT_IDS;
    expect(ids).toEqual(['html', 'docx', 'pdf', 'pptx', 'xlsx', 'csv']);
  });
});

describe('isOutsideInTargetPath', () => {
  it('accepts every supported rendered extension, case-insensitively', () => {
    for (const format of OUTSIDE_IN_FORMAT_IDS) {
      expect(isOutsideInTargetPath(`reports/Q3.${format}`), format).toBe(true);
      expect(isOutsideInTargetPath(`reports/Q3.${format.toUpperCase()}`), format).toBe(true);
    }
    expect(isOutsideInTargetPath('site/Index.htm')).toBe(true);
  });

  it('rejects Markdown, unsupported formats, dotfiles, and extensionless names', () => {
    expect(isOutsideInTargetPath('notes/readme.md')).toBe(false);
    expect(isOutsideInTargetPath('book.epub')).toBe(false);
    expect(isOutsideInTargetPath('.pptx')).toBe(false);
    expect(isOutsideInTargetPath('Makefile')).toBe(false);
    expect(isOutsideInTargetPath('deck.')).toBe(false);
  });

  it('agrees with resolveOutsideInLayout', () => {
    for (const path of ['a/b.pptx', 'x.htm', 'y.md', 'z', 'C:\\docs\\Plan.docx']) {
      expect(isOutsideInTargetPath(path), path).toBe(resolveOutsideInLayout(path) !== null);
    }
  });

  it('refuses non-canonical paths instead of guessing', () => {
    expect(() => isOutsideInTargetPath('../escape.pptx')).toThrow(/canonical/);
  });
});

describe('resolveOutsideInLayout (layout subpath)', () => {
  it('normalizes separators and maps .htm to the html format', () => {
    const resolved = resolveOutsideInLayout('site\\pages\\Über Uns.htm');
    expect(resolved).toMatchObject({
      targetPath: 'site/pages/Über Uns.htm',
      format: 'html',
      parentDirectory: 'site/pages',
      companionDirectory: 'site/pages/Über Uns_files',
      markdownPath: 'site/pages/Über Uns_files/uber-uns.md',
      relativeTargetPath: '../Über Uns.htm',
      backupPath: 'site/pages/Über Uns_files/.original/original.html',
    });
  });

  it('keeps root-level and absolute targets rooted', () => {
    expect(resolveOutsideInLayout('Deck.pptx')?.markdownPath).toBe('Deck_files/deck.md');
    expect(resolveOutsideInLayout('/Deck.pptx')?.markdownPath).toBe('/Deck_files/deck.md');
  });

  it('chooses the canonical source over a case-folded or sole legacy file', () => {
    const resolved = resolveOutsideInLayout('Deck.pptx')!;
    expect(
      chooseOutsideInMarkdownPath(resolved, ['Deck_files/DECK.md', 'Deck_files/deck.md']),
    ).toBe('Deck_files/deck.md');
    expect(chooseOutsideInMarkdownPath(resolved, ['Deck_files/DECK.md'])).toBe(
      'Deck_files/DECK.md',
    );
    expect(chooseOutsideInMarkdownPath(resolved, ['Deck_files/a.md', 'Deck_files/b.md'])).toBe(
      null,
    );
  });
});
