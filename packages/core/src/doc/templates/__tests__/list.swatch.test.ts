import { describe, expect, it } from 'vitest';
import { createTemplateContext } from '../../../schemas/BlockTemplates.js';
import type { TextLayer } from '../../../schemas/Doc.js';
import { DEFAULT_THEME } from '../../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../../../schemas/Viewport.js';
import { listBlock } from '../listBlock.js';

const context = () => createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);

const base = { template: 'list' as const, id: 'l', duration: 6, audioSegment: 0, title: 'Steps' };

const textLayers = (layers: ReturnType<typeof listBlock>, pattern: RegExp) =>
  layers.filter((l): l is TextLayer => l.type === 'text' && pattern.test(l.id));

describe('list swatch behaviour', () => {
  it('renders bullet markers for unordered lists and numbers otherwise', () => {
    const bullets = textLayers(
      listBlock({ ...base, items: ['One', 'Two'], ordered: false }, context()),
      /^item-\d+-marker$/,
    );
    expect(bullets.map((l) => l.content.text)).toEqual(['•', '•']);

    const numbered = textLayers(
      listBlock({ ...base, items: ['One', 'Two'], ordered: true }, context()),
      /^item-\d+-marker$/,
    );
    expect(numbered.map((l) => l.content.text)).toEqual(['1.', '2.']);

    // Legacy inputs without the flag keep their numbers.
    const legacy = textLayers(listBlock({ ...base, items: ['One'] }, context()), /-marker$/);
    expect(legacy[0]?.content.text).toBe('1.');
  });

  it('reserves a line for every nested sub-item so the next item starts below it', () => {
    const nested = 'Survey the arterial\nCount vehicles at six points\nMap the tidal range';
    const layers = listBlock({ ...base, items: [nested, 'Design the promenade'] }, context());
    const [first, second] = textLayers(layers, /^item-\d+$/);
    const ctx = context();
    const fontSize = first!.content.style.fontSize;
    const lineHeight = first!.content.style.lineHeight ?? 1.2;
    const firstTopPct = parseFloat(String(first!.position.y));
    const secondTopPct = parseFloat(String(second!.position.y));
    const threeLinesPct = ((3 * fontSize * lineHeight) / ctx.viewport.height) * 100;
    expect(secondTopPct - firstTopPct).toBeGreaterThanOrEqual(threeLinesPct);
  });
});
