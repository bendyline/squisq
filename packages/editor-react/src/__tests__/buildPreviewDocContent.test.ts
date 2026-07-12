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
});
