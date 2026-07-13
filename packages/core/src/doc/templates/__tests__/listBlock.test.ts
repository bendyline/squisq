import { describe, expect, it } from 'vitest';
import { createTemplateContext } from '../../../schemas/BlockTemplates.js';
import type { TextLayer } from '../../../schemas/Doc.js';
import { DEFAULT_THEME } from '../../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../../../schemas/Viewport.js';
import { listBlock } from '../listBlock.js';

const ITEMS = [
  'We launched the scripting platform for Minecraft, which was essential for launching new categories of content for Minecraft (add-ons)',
  "I spec'ed and largely built the Minecraft Creator Tools suite, including a website for beginning to advanced creators and set of NPM commands and tools.",
  'I manage and craft the Minecraft samples and documentation suite',
  'I produce and create the Minecraft Creator Channel on YouTube',
];

describe('listBlock', () => {
  it('reserves vertical space for wrapped list items', () => {
    const context = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
    const layers = listBlock(
      {
        template: 'list',
        id: 'minecraft-platform',
        duration: 10,
        audioSegment: 0,
        title: 'Minecraft Platform',
        items: ITEMS,
      },
      context,
    );
    const itemLayers = layers.filter(
      (layer): layer is TextLayer => layer.type === 'text' && /^item-\d+$/.test(layer.id),
    );
    const markerLayers = layers.filter(
      (layer): layer is TextLayer => layer.type === 'text' && /^item-\d+-marker$/.test(layer.id),
    );
    const yPositions = itemLayers.map((layer) => parseFloat(String(layer.position.y)));

    expect(itemLayers).toHaveLength(4);
    expect(markerLayers).toHaveLength(4);
    expect(yPositions[0]).toBe(34);

    // The marker has its own right-aligned column, while all body lines are
    // rendered by one layer beginning after that column (a hanging indent).
    expect(markerLayers[0]!.content.text).toBe('1.');
    expect(markerLayers[0]!.content.style.textAlign).toBe('right');
    expect(itemLayers[0]!.content.text).toBe(ITEMS[0]);
    const markerRightPx =
      (parseFloat(String(markerLayers[0]!.position.x)) / 100) * context.viewport.width +
      Number(markerLayers[0]!.position.width);
    const bodyLeftPx =
      (parseFloat(String(itemLayers[0]!.position.x)) / 100) * context.viewport.width;
    expect(bodyLeftPx).toBeGreaterThan(markerRightPx);

    // The first two entries wrap to two lines. Their following baselines
    // therefore advance by two line-heights plus the inter-item gap.
    const fontSize = itemLayers[0]!.content.style.fontSize;
    const twoLineAdvance = ((2 * fontSize * 1.2 + 18) / context.viewport.height) * 100;
    expect(yPositions[1]! - yPositions[0]!).toBeCloseTo(twoLineAdvance);
    expect(yPositions[2]! - yPositions[1]!).toBeCloseTo(twoLineAdvance);

    // The third entry fits on one line, so the final advance is compact.
    const oneLineAdvance = ((fontSize * 1.2 + 18) / context.viewport.height) * 100;
    expect(yPositions[3]! - yPositions[2]!).toBeCloseTo(oneLineAdvance);
  });
});
