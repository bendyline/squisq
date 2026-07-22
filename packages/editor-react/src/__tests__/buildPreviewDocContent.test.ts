import { describe, expect, it } from 'vitest';
import { markdownToDoc, materializeBlockLayers } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { DocBlock, TextLayer } from '@bendyline/squisq/schemas';
import { buildPreviewDoc, documentTitleFromFileName } from '../buildPreviewDoc';

function firstPreviewSlide(markdown: string): Record<string, unknown> {
  const source = markdownToDoc(parseMarkdown(markdown), {
    articleId: 'stat-content-test',
    generateCoverBlock: false,
  });
  return buildPreviewDoc(source).blocks[0] as unknown as Record<string, unknown>;
}

function previewSlides(markdown: string): Record<string, unknown>[] {
  const source = markdownToDoc(parseMarkdown(markdown), {
    articleId: 'content-first-test',
    generateCoverBlock: false,
  });
  return buildPreviewDoc(source).blocks as unknown as Record<string, unknown>[];
}

describe('buildPreviewDoc content mapping', () => {
  it('uses the complete-body content template for unannotated mixed Markdown blocks', () => {
    const slides = previewSlides(`# Ship Review

A **bold** statement with an [example link](https://example.com).

## Checklist

- First item
- Second item

> A quoted note.

\`inline code\``);

    expect(slides.map((slide) => slide.template)).toEqual(['content', 'content']);

    const { layers } = materializeBlockLayers(slides[1] as unknown as DocBlock);
    const renderedText = layers
      .filter((layer): layer is TextLayer => layer.type === 'text')
      .map((layer) => layer.content.text)
      .join('\n');
    expect(renderedText).toContain('Checklist');
    expect(renderedText).toContain('First item');
    expect(renderedText).toContain('Second item');
    expect(renderedText).toContain('A quoted note.');
    expect(renderedText).toContain('inline code');
  });

  it('keeps an explicitly authored section header as a title-only divider', () => {
    const slide = firstPreviewSlide('# Chapter {[sectionHeader]}\n\nSupporting body.');
    expect(slide.template).toBe('sectionHeader');
  });

  it('does not treat an authored transition as permission to hide body content', () => {
    const slide = firstPreviewSlide('# Chapter {transition=dissolve}\n\nSupporting body.');
    expect(slide.template).toBe('content');
    expect(slide.transition).toEqual({ type: 'dissolve' });
  });

  it('preserves a lossless content-aware auto template', () => {
    const slide = firstPreviewSlide('# Steps\n\n- First\n- Second');
    expect(slide.template).toBe('list');
  });

  it('maps the leading bold metric to the large stat layer', () => {
    const slide = firstPreviewSlide(`### The Big Number {[statHighlight colorScheme=green]}

**42%** of teams prefer visual blocks over raw slides.`);

    expect(slide).toMatchObject({
      title: 'The Big Number',
      stat: '42%',
      description: 'of teams prefer visual blocks over raw slides.',
      colorScheme: 'green',
    });

    const { layers } = materializeBlockLayers(slide as unknown as DocBlock);
    const stat = layers.find((layer) => layer.id === 'stat') as TextLayer;
    const description = layers.find((layer) => layer.id === 'description') as TextLayer;

    expect(stat.content.text).toBe('42%');
    expect(description.content.text).toBe('of teams prefer visual blocks over raw slides.');
    expect(stat.content.style.fontSize).toBeGreaterThan(description.content.style.fontSize);
  });

  it('lets explicit annotation inputs override Markdown-derived defaults', () => {
    const slide = firstPreviewSlide(
      '### The Big Number {[statHighlight stat="99%" description="Pinned description"]}\n\n' +
        '**42%** derived description.',
    );

    expect(slide).toMatchObject({
      stat: '99%',
      description: 'Pinned description',
    });
  });

  it('coerces structured annotation inputs before materializing a preview slide', () => {
    const slide = firstPreviewSlide(
      '## Local or installed {[twoColumn header="Work where files make sense" ' +
        'left="Web|Browser-local workspaces" right="Desktop|Real folders and native menus"]}',
    );

    expect(slide).toMatchObject({
      template: 'twoColumn',
      left: { label: 'Web', sublabel: 'Browser-local workspaces' },
      right: { label: 'Desktop', sublabel: 'Real folders and native menus' },
    });

    const { layers } = materializeBlockLayers(slide as unknown as DocBlock);
    expect(layers.map((layer) => layer.id)).toEqual(
      expect.arrayContaining([
        'header',
        'left-label',
        'left-sublabel',
        'right-label',
        'right-sublabel',
      ]),
    );
  });

  it('keeps Mermaid source available to the slide materializer for every template', () => {
    const slide = firstPreviewSlide(
      '# Architecture\n\n```mermaid\nflowchart LR\n  client --> server\n```',
    );
    expect(slide.contents).toEqual([expect.objectContaining({ type: 'code', lang: 'mermaid' })]);

    const { layers } = materializeBlockLayers(slide as unknown as DocBlock, {
      persistentLayers: false,
    });
    expect(layers.some((layer) => layer.type === 'mermaid')).toBe(true);
    const narrativeText = layers
      .filter((layer): layer is TextLayer => layer.type === 'text')
      .map((layer) => layer.content.text)
      .join('\n');
    expect(narrativeText).not.toContain('flowchart LR');
  });
});

describe('buildPreviewDoc preamble header', () => {
  function preambleDoc(markdown: string) {
    return markdownToDoc(parseMarkdown(markdown), {
      articleId: 'preamble-test',
      generateCoverBlock: false,
    });
  }

  it('does not surface the synthetic block id as a header for heading-less content', () => {
    const slide = buildPreviewDoc(preambleDoc('Just some raw text before any heading.'))
      .blocks[0] as unknown as Record<string, unknown>;
    // Regression: the preamble block id is literally 'preamble' and must never
    // become the visible header.
    expect(slide.id).toBe('preamble');
    expect(slide.title).toBe('');
  });

  it('uses the frontmatter title as the preamble header when present', () => {
    const slide = buildPreviewDoc(
      preambleDoc('---\ntitle: Quarterly Plan\n---\n\nRaw text before any heading.'),
    ).blocks[0] as unknown as Record<string, unknown>;
    expect(slide.title).toBe('Quarterly Plan');
  });

  it('uses a host-provided document title (e.g. file name) when there is no heading', () => {
    const slide = buildPreviewDoc(preambleDoc('Raw text before any heading.'), {
      documentTitle: 'Longview Plan',
    }).blocks[0] as unknown as Record<string, unknown>;
    expect(slide.title).toBe('Longview Plan');
  });

  it('prefers an authored frontmatter title over the host-provided one', () => {
    const slide = buildPreviewDoc(preambleDoc('---\ntitle: Authored Title\n---\n\nRaw text.'), {
      documentTitle: 'file-name',
    }).blocks[0] as unknown as Record<string, unknown>;
    expect(slide.title).toBe('Authored Title');
  });
});

describe('documentTitleFromFileName', () => {
  it('strips directory prefixes and the trailing extension', () => {
    expect(documentTitleFromFileName('docs/Longview Plan.md')).toBe('Longview Plan');
    expect(documentTitleFromFileName('C:\\notes\\draft.markdown')).toBe('draft');
    expect(documentTitleFromFileName('README')).toBe('README');
    expect(documentTitleFromFileName(undefined)).toBe('');
  });
});
