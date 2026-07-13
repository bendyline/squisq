/**
 * resolveThemeForDoc — pure, doc-scoped theme resolution.
 *
 * The theme analog of buildRegistry: an inline custom theme resolves from the
 * doc's own `customThemes` list. Explicit caller registries and built-ins are
 * fallback sources for non-inline ids.
 */

import { describe, it, expect } from 'vitest';
import { resolveThemeForDoc } from '../doc/resolveDocTheme';
import { compileTheme } from '../schemas/themeCompile';
import { createThemeRegistry } from '../schemas/Theme';
import { DEFAULT_THEME } from '../schemas/themeLibrary';
import type { Doc } from '../schemas/Doc.js';

const brand = compileTheme({
  id: 'my-brand',
  name: 'My Brand',
  seedColors: { primary: '#3182ce' },
});

function docWith(partial: Partial<Doc>): Doc {
  return {
    articleId: 'd',
    duration: 0,
    blocks: [],
    audio: { segments: [] },
    ...partial,
  } as Doc;
}

describe('resolveThemeForDoc', () => {
  it('resolves an inline custom theme doc-scoped (no global registration)', () => {
    const doc = docWith({ customThemes: [brand], frontmatter: { 'squisq-theme': 'my-brand' } });
    expect(resolveThemeForDoc(doc)).toEqual(brand);
  });

  it('honors an explicit id over the frontmatter selection', () => {
    const doc = docWith({ customThemes: [brand], frontmatter: { 'squisq-theme': 'cinematic' } });
    expect(resolveThemeForDoc(doc, 'my-brand')).toEqual(brand);
  });

  it('falls back to a built-in when the id is not an inline theme', () => {
    const doc = docWith({ customThemes: [brand], frontmatter: { 'squisq-theme': 'cinematic' } });
    expect(resolveThemeForDoc(doc).id).toBe('cinematic');
  });

  it('uses Doc.themeId when there is no explicit or frontmatter id', () => {
    const doc = docWith({ customThemes: [brand], themeId: 'my-brand' });
    expect(resolveThemeForDoc(doc)).toEqual(brand);
  });

  it('returns the default theme for a null doc', () => {
    expect(resolveThemeForDoc(null).id).toBe(DEFAULT_THEME.id);
  });

  it('uses an explicit registry only after document-scoped definitions', () => {
    const external = compileTheme({
      id: 'external-brand',
      name: 'External Brand',
      seedColors: { primary: '#8844aa' },
    });
    const registry = createThemeRegistry([external]);
    const doc = docWith({ themeId: 'external-brand' });

    expect(resolveThemeForDoc(doc)).toBe(DEFAULT_THEME);
    expect(resolveThemeForDoc(doc, undefined, registry)).toEqual(external);
  });
});
