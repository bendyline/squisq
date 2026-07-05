/**
 * Custom themes round-trip through frontmatter.
 *
 * The theme analog of customTemplatesFrontmatter.test.ts: verifies that a
 * Theme stored in markdown frontmatter under `squisq-custom-themes` is
 * faithfully reconstructed by `markdownToDoc` and serialized back by
 * `docToMarkdown` without loss, and that the reader is tolerant of malformed
 * entries.
 */

import { describe, it, expect } from 'vitest';
import { markdownToDoc } from '../doc/markdownToDoc';
import { docToMarkdown } from '../doc/docToMarkdown';
import {
  readCustomThemesFromFrontmatter,
  writeCustomThemesToFrontmatter,
  FRONTMATTER_CUSTOM_THEMES_KEY,
} from '../doc/customThemesFrontmatter';
import { parseMarkdown } from '../markdown/parse';
import { compileTheme } from '../schemas/themeCompile';
import type { Doc } from '../schemas/Doc.js';
import type { Theme } from '../schemas/Theme.js';

const brand: Theme = compileTheme({
  id: 'my-brand',
  name: 'My Brand',
  seedColors: { primary: '#3182ce', secondary: '#805ad5' },
});

describe('writeCustomThemesToFrontmatter → readCustomThemesFromFrontmatter', () => {
  it('round-trips a single theme through the compact JSON wire format', () => {
    const payload = writeCustomThemesToFrontmatter([brand]);
    expect(typeof payload).toBe('string');
    expect(payload!.startsWith('{"my-brand":')).toBe(true);
    const out = readCustomThemesFromFrontmatter({ [FRONTMATTER_CUSTOM_THEMES_KEY]: payload });
    expect(out).toHaveLength(1);
    expect(out![0]).toEqual(brand);
  });

  it('default output is compact (single line) and byte-unchanged', () => {
    const payload = writeCustomThemesToFrontmatter([brand])!;
    expect(payload).not.toContain('\n');
    expect(writeCustomThemesToFrontmatter([brand], { pretty: false })).toBe(payload);
  });

  it('pretty:true emits multi-line JSON that still reads back', () => {
    const payload = writeCustomThemesToFrontmatter([brand], { pretty: true })!;
    expect(payload).toContain('\n');
    const out = readCustomThemesFromFrontmatter({ [FRONTMATTER_CUSTOM_THEMES_KEY]: payload });
    expect(out).toHaveLength(1);
    expect(out![0]).toEqual(brand);
  });

  it('a hand-written block-scalar frontmatter parses back into the theme', () => {
    const payload = writeCustomThemesToFrontmatter([brand], { pretty: true })!;
    const body = payload
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n');
    const md = `---\n${FRONTMATTER_CUSTOM_THEMES_KEY}: |-\n${body}\n---\n\n# Hi\n`;
    const parsed = parseMarkdown(md);
    const out = readCustomThemesFromFrontmatter(parsed.frontmatter);
    expect(out).toHaveLength(1);
    expect(out![0]).toEqual(brand);
  });

  it('round-trips multiple themes keyed by id', () => {
    const second = compileTheme({
      id: 'second',
      name: 'Second',
      seedColors: { primary: '#e53e3e' },
    });
    const payload = writeCustomThemesToFrontmatter([brand, second]);
    const out = readCustomThemesFromFrontmatter({ [FRONTMATTER_CUSTOM_THEMES_KEY]: payload });
    expect(out!.map((t) => t.id).sort()).toEqual(['my-brand', 'second']);
  });

  it('also accepts an already-decoded object map (forward-compatible)', () => {
    const out = readCustomThemesFromFrontmatter({
      [FRONTMATTER_CUSTOM_THEMES_KEY]: { 'my-brand': brand },
    });
    expect(out).toHaveLength(1);
    expect(out![0].id).toBe('my-brand');
  });

  it('drops invalid themes rather than failing the whole load', () => {
    const payload = JSON.stringify({ 'my-brand': brand, junk: { id: 'junk' } });
    const out = readCustomThemesFromFrontmatter({ [FRONTMATTER_CUSTOM_THEMES_KEY]: payload });
    expect(out).toHaveLength(1);
    expect(out![0].id).toBe('my-brand');
  });

  it('returns undefined when the key is absent or unparseable', () => {
    expect(readCustomThemesFromFrontmatter({})).toBeUndefined();
    expect(readCustomThemesFromFrontmatter(undefined)).toBeUndefined();
    expect(
      readCustomThemesFromFrontmatter({ [FRONTMATTER_CUSTOM_THEMES_KEY]: 'not json' }),
    ).toBeUndefined();
  });
});

describe('Doc.customThemes round-trip via markdownToDoc + docToMarkdown', () => {
  it('survives a markdownToDoc → docToMarkdown cycle and keeps the selection', () => {
    const encoded = writeCustomThemesToFrontmatter([brand])!;
    // Compact JSON is stored unquoted — it round-trips verbatim through the
    // line-based frontmatter parser, exactly like custom templates.
    const sourceMd = `---
title: My Doc
squisq-theme: my-brand
squisq-custom-themes: ${encoded}
---

# Welcome

A small editor for big ideas.
`;
    const doc = markdownToDoc(parseMarkdown(sourceMd));
    expect(doc.customThemes).toHaveLength(1);
    expect(doc.customThemes![0]).toEqual(brand);

    const mdOut = docToMarkdown(doc);
    const payload = mdOut.frontmatter![FRONTMATTER_CUSTOM_THEMES_KEY];
    expect(typeof payload).toBe('string');
    const reread = readCustomThemesFromFrontmatter({ [FRONTMATTER_CUSTOM_THEMES_KEY]: payload });
    expect(reread).toEqual(doc.customThemes);
    // The active selection is preserved untouched.
    expect(mdOut.frontmatter!['squisq-theme']).toBe('my-brand');
  });

  it('drops the frontmatter key when the doc has no custom themes anymore', () => {
    const doc: Doc = {
      articleId: 'd',
      duration: 0,
      blocks: [],
      audio: { segments: [] },
      frontmatter: {
        title: 'Doc',
        [FRONTMATTER_CUSTOM_THEMES_KEY]: 'stale-blob',
      },
    };
    const md = docToMarkdown(doc);
    expect(md.frontmatter).not.toHaveProperty(FRONTMATTER_CUSTOM_THEMES_KEY);
    expect(md.frontmatter!.title).toBe('Doc');
  });
});
