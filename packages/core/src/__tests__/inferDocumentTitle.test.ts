import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../markdown/parse.js';
import { inferDocumentTitle } from '../markdown/utils.js';

describe('inferDocumentTitle', () => {
  it('returns the frontmatter title when set', () => {
    const doc = parseMarkdown('---\ntitle: My Doc\n---\n\n# Heading\n');
    expect(inferDocumentTitle(doc)).toBe('My Doc');
  });

  it('trims surrounding whitespace from frontmatter title', () => {
    const doc = parseMarkdown('---\ntitle: "  Spaced  "\n---\n\n# Heading\n');
    expect(inferDocumentTitle(doc)).toBe('Spaced');
  });

  it('falls back to the first H1 when frontmatter title is absent', () => {
    const doc = parseMarkdown('# Welcome\n\n## Details');
    expect(inferDocumentTitle(doc)).toBe('Welcome');
  });

  it('falls back to the first H2 when no H1 is present', () => {
    const doc = parseMarkdown('## Section\n\n### Detail');
    expect(inferDocumentTitle(doc)).toBe('Section');
  });

  it('prefers the shallowest heading regardless of source order', () => {
    const doc = parseMarkdown('## Earlier H2\n\n# Real Title\n\n### Nested');
    expect(inferDocumentTitle(doc)).toBe('Real Title');
  });

  it('skips empty frontmatter title and falls back to headings', () => {
    const doc = parseMarkdown('---\ntitle: ""\n---\n\n# Real\n');
    expect(inferDocumentTitle(doc)).toBe('Real');
  });

  it('returns undefined when there is no frontmatter and no heading', () => {
    const doc = parseMarkdown('Just a paragraph.\n\nAnother one.');
    expect(inferDocumentTitle(doc)).toBeUndefined();
  });

  it('strips inline formatting from heading text', () => {
    const doc = parseMarkdown('# **Bold** and *italic*');
    expect(inferDocumentTitle(doc)).toBe('Bold and italic');
  });

  it('skips headings that contain only whitespace', () => {
    const doc = parseMarkdown('#  \n\n## Real Heading');
    expect(inferDocumentTitle(doc)).toBe('Real Heading');
  });
});
