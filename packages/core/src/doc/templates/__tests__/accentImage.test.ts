import { describe, expect, it } from 'vitest';
import { createTemplateContext } from '../../../schemas/BlockTemplates.js';
import type { AccentImage, AccentPosition, TemplateBlock } from '../../../schemas/BlockTemplates.js';
import type { ImageLayer, Layer } from '../../../schemas/Doc.js';
import { DEFAULT_THEME } from '../../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS, type ViewportConfig } from '../../../schemas/Viewport.js';
import { accentForViewport } from '../accentImage.js';
import { dateEvent } from '../dateEvent.js';
import { definitionCard } from '../definitionCard.js';
import { factCard } from '../factCard.js';
import { listBlock } from '../listBlock.js';
import { quoteBlock } from '../quoteBlock.js';
import { statHighlight } from '../statHighlight.js';

const accent = (position: AccentPosition): AccentImage => ({ src: 'mill.jpg', alt: 'Mill', position });
const POSITIONS: AccentPosition[] = ['left-strip', 'right-strip', 'bottom-strip', 'corner-inset'];

describe('accentForViewport', () => {
  it('keeps the authored position on landscape and square frames', () => {
    for (const viewport of [VIEWPORT_PRESETS.landscape, VIEWPORT_PRESETS.square]) {
      for (const position of POSITIONS) {
        expect(accentForViewport(accent(position), viewport)?.position).toBe(position);
      }
    }
  });

  it('moves every accent to the bottom strip on a portrait frame', () => {
    for (const position of POSITIONS) {
      const oriented = accentForViewport(accent(position), VIEWPORT_PRESETS.portrait);
      expect(oriented).toEqual({ ...accent(position), position: 'bottom-strip' });
    }
  });

  it('passes a missing accent through', () => {
    expect(accentForViewport(undefined, VIEWPORT_PRESETS.portrait)).toBeUndefined();
  });
});

/** Pixel box of the block's accent image layer. */
function accentBox(layers: Layer[], viewport: ViewportConfig) {
  const image = layers.find((l): l is ImageLayer => l.type === 'image');
  expect(image, 'accent image layer').toBeDefined();
  const px = (v: string | number | undefined, axis: number) =>
    typeof v === 'number' ? v : (parseFloat(String(v ?? 0)) / 100) * axis;
  return {
    width: px(image!.position.width, viewport.width),
    height: px(image!.position.height, viewport.height),
  };
}

const base = { id: 'b', duration: 8, audioSegment: 0 };
const TEMPLATES: Array<[string, (a: AccentImage, ctx: ReturnType<typeof createTemplateContext>) => Layer[]]> = [
  ['dateEvent', (a, ctx) => dateEvent({ ...base, template: 'dateEvent', date: '1888', description: 'Kirk arrives.', accentImage: a }, ctx)],
  ['factCard', (a, ctx) => factCard({ ...base, template: 'factCard', fact: 'The mill never rolled steel.', explanation: 'The Panic of 1893 hit first.', accentImage: a }, ctx)],
  ['statHighlight', (a, ctx) => statHighlight({ ...base, template: 'statHighlight', stat: '120 acres', description: 'around Forbes Lake', accentImage: a }, ctx)],
  ['quote', (a, ctx) => quoteBlock({ ...base, template: 'quote', quote: 'A practical monopoly of the Pacific Coast', accentImage: a }, ctx)],
  ['definitionCard', (a, ctx) => definitionCard({ ...base, template: 'definitionCard', term: 'Pig iron', definition: 'Crude iron from a blast furnace.', accentImage: a }, ctx)],
  ['list', (a, ctx) => listBlock({ ...base, template: 'list', title: 'Works', items: ['Foundry', 'Machine shops'], accentImage: a } as TemplateBlock & { template: 'list' }, ctx)],
];

describe('accent templates on a portrait frame', () => {
  const portrait = VIEWPORT_PRESETS.portrait;
  const context = createTemplateContext(DEFAULT_THEME, 0, 1, portrait);

  for (const [name, render] of TEMPLATES) {
    it(`${name} gives a side-strip accent the full width, not a sliver`, () => {
      const box = accentBox(render(accent('left-strip'), context), portrait);
      expect(box.width).toBe(portrait.width);
      // Wider than tall, like the photos accents carry.
      expect(box.width / box.height).toBeGreaterThan(1.2);
    });
  }

  it('keeps the side strip on a landscape frame', () => {
    const landscape = VIEWPORT_PRESETS.landscape;
    const ctx = createTemplateContext(DEFAULT_THEME, 0, 1, landscape);
    const box = accentBox(TEMPLATES[0][1](accent('left-strip'), ctx), landscape);
    expect(box.width).toBeCloseTo(0.35 * landscape.width);
    expect(box.height).toBe(landscape.height);
  });
});
