/**
 * SVG islands on slides: a ```svg fence becomes an `svg` layer through the
 * rich-media path every template shares, laid out at the island's own aspect
 * ratio, and drops out of the slide's text.
 */

import { describe, expect, it } from 'vitest';
import { markdownToDoc, materializeBlockLayers } from '../doc/index';
import { buildPreviewDoc } from '../doc/buildPreviewDoc';
import { parseMarkdown } from '../markdown/index';
import { validateDocSchema } from '../schemas/validateDoc';
import { validateCustomTemplateDefinition } from '../schemas/CustomTemplates';
import type { DocBlock, Layer, SvgLayer, TextLayer } from '../schemas/index';
import { DEFAULT_THEME } from '../schemas/themeLibrary';

const WIDE =
  '<svg viewBox="0 0 400 100"><rect width="400" height="100" fill="currentColor"/></svg>';
const TALL = '<svg viewBox="0 0 100 300"><circle cx="50" cy="150" r="40"/></svg>';

function slideLayers(markdown: string, index = 0): Layer[] {
  const doc = markdownToDoc(parseMarkdown(markdown), {
    articleId: 'svg-slides',
    generateCoverBlock: false,
  });
  const slide = buildPreviewDoc(doc).blocks[index] as DocBlock;
  return materializeBlockLayers(slide, { persistentLayers: false }).layers;
}

function islands(layers: Layer[]): SvgLayer[] {
  return layers.filter((layer): layer is SvgLayer => layer.type === 'svg');
}

function text(layers: Layer[]): string {
  return layers
    .filter((layer): layer is TextLayer => layer.type === 'text')
    .map((layer) => `${layer.content.text}\n${layer.content.html ?? ''}`)
    .join('\n');
}

function boxAspect(layer: SvgLayer): number {
  const { width, height } = layer.position as { width: number; height: number };
  return width / height;
}

describe('svg islands on slides', () => {
  it('turns a fence into an svg layer carrying the raw source and text color', () => {
    const layers = slideLayers(`## Logo\n\nOur mark.\n\n\`\`\`svg\n${WIDE}\n\`\`\``);
    const [island] = islands(layers);
    expect(island).toMatchObject({
      type: 'svg',
      content: { source: WIDE, color: DEFAULT_THEME.colors.text },
    });
    expect(text(layers)).toContain('Our mark.');
    expect(text(layers)).not.toContain('viewBox');
    expect(text(layers)).not.toContain('<rect');
  });

  it('lays an island out at its own aspect ratio', () => {
    // The title template gives wide media a band and tall media a column.
    const [wide] = islands(slideLayers(`## A {[title]}\n\n\`\`\`svg\n${WIDE}\n\`\`\``));
    const [tall] = islands(slideLayers(`## B {[title]}\n\n\`\`\`svg\n${TALL}\n\`\`\``));
    expect(boxAspect(wide!)).toBeGreaterThan(2);
    expect(boxAspect(tall!)).toBeLessThan(1);
  });

  it('places one layer per distinct island, beside other media', () => {
    const layers = slideLayers(
      `## Two\n\n\`\`\`svg\n${WIDE}\n\`\`\`\n\n\`\`\`svg\n${TALL}\n\`\`\`\n\n\`\`\`mermaid\nflowchart LR\n  a --> b\n\`\`\``,
    );
    expect(islands(layers).map((layer) => layer.content.source)).toEqual([WIDE, TALL]);
    expect(layers.some((layer) => layer.type === 'mermaid')).toBe(true);
  });

  it('still places a fence that does not sanitize, so the renderer can say so', () => {
    const layers = slideLayers('## Broken\n\n```svg\n<div>not svg</div>\n```');
    expect(islands(layers)).toHaveLength(1);
    expect(text(layers)).not.toContain('not svg');
  });

  it('leaves an xml fence as code', () => {
    const layers = slideLayers(`## Markup\n\n\`\`\`xml\n${WIDE}\n\`\`\``);
    expect(islands(layers)).toHaveLength(0);
  });
});

describe('svg layers in authored docs', () => {
  const doc = (content: unknown) => ({
    articleId: 'a',
    duration: 1,
    blocks: [
      {
        id: 'b',
        startTime: 0,
        duration: 1,
        audioSegment: 0,
        layers: [{ id: 's', type: 'svg', position: { x: 0, y: 0 }, content }],
      },
    ],
    audio: { segments: [] },
  });
  const issuesFor = (content: unknown) =>
    validateDocSchema(doc(content)).filter((issue) => issue.path.includes('layers'));

  it('validates the source', () => {
    expect(issuesFor({ source: WIDE, alt: 'Logo' })).toEqual([]);
    expect(issuesFor({ alt: 'no source' }).map((issue) => issue.path)).toContain(
      'blocks[0].layers[0].content.source',
    );
    expect(issuesFor({ source: 'x'.repeat(600 * 1024) }).length).toBeGreaterThan(0);
  });

  it('is not a custom-template layer type', () => {
    const result = validateCustomTemplateDefinition({
      name: 'withSvg',
      layers: [{ id: 's', type: 'svg', position: { x: 0, y: 0 }, content: { source: WIDE } }],
    });
    expect(result.valid).toBe(false);
  });
});
