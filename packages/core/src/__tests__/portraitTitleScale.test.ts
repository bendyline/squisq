import { describe, it, expect } from 'vitest';
import { getLayoutHints, titleTypeScale } from '../schemas/LayoutStrategy';
import { VIEWPORT_PRESETS } from '../schemas/Viewport';
import type { Layer, TextLayer } from '../schemas/Doc';
import { markdownToDoc, flattenRenderableBlocks } from '../doc/markdownToDoc';
import { materializeBlockLayers } from '../doc/materializeBlockLayers';
import { parseMarkdown } from '../markdown/parse';

describe('title type scale', () => {
  it('leaves landscape titles at their base size', () => {
    const landscape = getLayoutHints('landscape');
    expect(titleTypeScale(44, landscape)).toBe(1);
    expect(titleTypeScale(96, landscape)).toBe(1);
  });

  it('scales portrait headings like body text, up to the hero title size', () => {
    const portrait = getLayoutHints('portrait');
    expect(titleTypeScale(44, portrait)).toBe(portrait.bodyScale);
    expect(Math.round(64 * titleTypeScale(64, portrait))).toBe(67);
    // The hero title and larger display type keep the width-bound scale.
    expect(titleTypeScale(96, portrait)).toBe(portrait.titleScale);
    expect(titleTypeScale(280, portrait)).toBe(portrait.titleScale);
  });
});

describe('portrait slide hierarchy', () => {
  const markdown = [
    '## Write the way you already do {[list]}',
    '',
    '- Type to add text.',
    '- Choose **Insert** to add a table.',
    '',
    '## Present it or send it {[content]}',
    '',
    'Each heading starts a new slide, so this document is already a slideshow.',
    '',
    '## Your documents stay yours {[factCard]}',
    '',
    'There is no account to create.',
  ].join('\n');
  const blocks = flattenRenderableBlocks(markdownToDoc(parseMarkdown(markdown)).blocks);

  function fontSize(layers: Layer[], id: string): number {
    const layer = layers.find((candidate): candidate is TextLayer => candidate.id === id);
    if (!layer || layer.type !== 'text') throw new Error(`no text layer ${id}`);
    return layer.content.style.fontSize;
  }

  // Portrait used to scale titles by 0.7 and body text by 1.5, so a 44px
  // list heading drew at 31px over 51px items.
  it.each([
    ['list', 'list-title', 'item-0'],
    ['content', 'title', 'body'],
    ['factCard', 'fact', 'explanation'],
  ])('draws the %s heading larger than its body text', (template, headingId, bodyId) => {
    const block = blocks.find((candidate) => candidate.template === template);
    expect(block).toBeDefined();
    const { layers } = materializeBlockLayers(block!, { viewport: VIEWPORT_PRESETS.portrait });
    expect(fontSize(layers, headingId)).toBeGreaterThan(fontSize(layers, bodyId));
  });
});
