import { describe, expect, it } from 'vitest';
import { markdownToDoc, materializeBlockLayers } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { DocBlock, TextLayer } from '@bendyline/squisq/schemas';
import { buildPreviewDoc } from '../buildPreviewDoc';

function firstPreviewSlide(markdown: string): Record<string, unknown> {
  const source = markdownToDoc(parseMarkdown(markdown), {
    articleId: 'stat-content-test',
    generateCoverBlock: false,
  });
  return buildPreviewDoc(source).blocks[0] as unknown as Record<string, unknown>;
}

describe('buildPreviewDoc content mapping', () => {
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
