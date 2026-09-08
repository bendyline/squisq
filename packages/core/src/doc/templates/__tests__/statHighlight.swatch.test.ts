import { describe, expect, it } from 'vitest';
import { createTemplateContext } from '../../../schemas/BlockTemplates.js';
import type { StatHighlightInput } from '../../../schemas/BlockTemplates.js';
import type { Layer, TextLayer } from '../../../schemas/Doc.js';
import { DEFAULT_THEME, THEMES } from '../../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../../../schemas/Viewport.js';
import { themedFontSize } from '../../utils/themeUtils.js';
import { statHighlight } from '../statHighlight.js';

const SENTENCE =
  'The waterfront redesign opened to the public in June, and weekend foot traffic doubled within a month.';
const PARAGRAPH = Array.from({ length: 4 }, () => SENTENCE).join(' ');
/** ~180 words in two paragraphs, like the swatch "long" variant. */
const LONG_BODY = `${PARAGRAPH}\n${PARAGRAPH}`;
/** Far more than any slide can hold at the readable floor. */
const ABSURD_BODY = Array.from({ length: 60 }, () => SENTENCE).join(' ');
const BULLETS_MANY = [
  'Weekend foot traffic doubled within the first month',
  'Vehicle throughput on the bypass held steady at 1,900 per hour',
  'Median dwell time rose from 14 to 31 minutes',
  'Ferry service extended to 11 pm on Fridays and Saturdays',
  'The tidal garden survived its first storm season',
  'Roughly a third of arterial trips disappeared rather than diverting, absorbed by the ferry, the cycle track, and people walking the last kilometre',
  'Merchants voted to extend evening hours after dwell times more than doubled',
  'Noise at the promenade edge fell from 71 dB to 58 dB at the evening peak',
  'Cycle counts on the protected track average 2,400 per weekday and 3,900 on weekends',
  'The north-shore fishing quay is next: the authority is drafting the same shared-surface treatment for a 2027 start',
].join('\n');
const LONG_TITLE =
  'How the Harbor Waterfront Redesign Doubled Weekend Foot Traffic Without Slowing the Bypass or Cutting Evening Ferry Service';

function block(overrides: Partial<StatHighlightInput> = {}): StatHighlightInput {
  return {
    template: 'statHighlight',
    id: 'sh',
    duration: 8,
    audioSegment: 0,
    stat: '73%',
    description: SENTENCE,
    colorScheme: 'green',
    ...overrides,
  };
}

function textLayers(layers: Layer[]): TextLayer[] {
  return layers.filter((l): l is TextLayer => l.type === 'text');
}

function find(layers: Layer[], id: string): TextLayer | undefined {
  return textLayers(layers).find((l) => l.id === id);
}

/** Top/bottom (percent of frame) of a centre-anchored text box. */
function bounds(layer: TextLayer): { top: number; bottom: number; centre: number } {
  const y = parseFloat(String(layer.position.y));
  const h = parseFloat(String(layer.position.height));
  expect(Number.isFinite(y), `${layer.id} y`).toBe(true);
  expect(Number.isFinite(h), `${layer.id} height`).toBe(true);
  return { top: y - h / 2, bottom: y + h / 2, centre: y };
}

function expectInFrame(layers: Layer[], bottomLimit = 92) {
  for (const layer of textLayers(layers)) {
    const b = bounds(layer);
    expect(b.top, `${layer.id} top`).toBeGreaterThanOrEqual(8 - 0.01);
    expect(b.bottom, `${layer.id} bottom`).toBeLessThanOrEqual(bottomLimit + 0.01);
  }
}

function expectStacked(layers: Layer[], order: string[]) {
  const present = order.map((id) => find(layers, id)).filter((l): l is TextLayer => Boolean(l));
  for (let i = 1; i < present.length; i += 1) {
    const above = bounds(present[i - 1]);
    const below = bounds(present[i]);
    expect(below.top, `${present[i].id} below ${present[i - 1].id}`).toBeGreaterThan(above.bottom);
  }
}

const landscape = () => createTemplateContext(DEFAULT_THEME, 0, 5, VIEWPORT_PRESETS.landscape);

describe('statHighlight swatch geometry', () => {
  it('keeps the left-aligned centred-column contract on every text layer', () => {
    const layers = statHighlight(
      block({ detail: 'Measured at the counting station.' }),
      landscape(),
    );
    expect(textLayers(layers).map((l) => l.id)).toEqual(['stat', 'description', 'detail']);
    for (const layer of textLayers(layers)) {
      expect(layer.content.style.textAlign, layer.id).toBe('left');
      expect(layer.position.anchor, layer.id).toBe('center');
      // The box keeps the column's left edge (7.5%) and never exceeds its width.
      const width = parseFloat(String(layer.position.width));
      const left = parseFloat(String(layer.position.x)) - width / 2;
      expect(width, layer.id + ' width').toBeGreaterThan(0);
      expect(width, layer.id + ' width').toBeLessThanOrEqual(85);
      expect(left, layer.id + ' left edge').toBeCloseTo(7.5, 1);
      expect(layer.position.height, layer.id).toBeDefined();
      expect(layer.content.style.shrinkToFit, layer.id).toBe(true);
    }
  });

  it('keeps a real stat at full size and places the description right under it', () => {
    const context = landscape();
    const layers = statHighlight(block(), context);
    const stat = find(layers, 'stat')!;
    expect(stat.content.style.fontSize).toBe(themedFontSize(148, context, true));
    expect(stat.content.style.maxLines).toBeUndefined();
    expectStacked(layers, ['stat', 'description']);
    const gap = bounds(find(layers, 'description')!).top - bounds(stat).bottom;
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(8);
  });

  it('keeps ten bullets and a 180-word body inside the frame with the detail below', () => {
    for (const description of [BULLETS_MANY, LONG_BODY]) {
      const layers = statHighlight(
        block({ description, detail: 'Measured at the counting station.' }),
        landscape(),
      );
      expectStacked(layers, ['stat', 'description', 'detail']);
      expectInFrame(layers);
    }
  });

  it('steps the description size down and clamps at the floor for an absurd body', () => {
    const context = landscape();
    const layers = statHighlight(block({ description: ABSURD_BODY }), context);
    const description = find(layers, 'description')!;
    expect(description.content.style.fontSize).toBeLessThan(themedFontSize(32, context, false));
    expect(description.content.style.fontSize).toBeGreaterThanOrEqual(18);
    expect(description.content.style.maxLines).toBeGreaterThan(1);
    expectInFrame(layers);
  });

  it('steps a sixteen-word heading in the stat slot down instead of leaving the frame', () => {
    const context = landscape();
    const base = themedFontSize(148, context, true);
    const layers = statHighlight(block({ stat: LONG_TITLE }), context);
    const stat = find(layers, 'stat')!;
    expect(stat.content.style.fontSize).toBeLessThan(base);
    expect(stat.content.style.fontSize).toBeGreaterThanOrEqual(Math.round(base * 0.4));
    expect(stat.content.style.shrinkToFit).toBe(true);
    expectStacked(layers, ['stat', 'description']);
    expectInFrame(layers);
  });

  it('drops a description that merely echoes the stat and never returns an empty slide', () => {
    for (const description of ['', '73%', ' 73% ']) {
      const layers = statHighlight(block({ description }), landscape());
      expect(layers.length).toBeGreaterThan(1);
      expect(find(layers, 'description')).toBeUndefined();
      const stat = find(layers, 'stat')!;
      expect(bounds(stat).centre).toBeGreaterThan(40);
      expect(bounds(stat).centre).toBeLessThan(54);
    }
  });

  it('keeps a short lockup composed around the optical centre', () => {
    const layers = statHighlight(block({ detail: 'Counting station' }), landscape());
    const top = bounds(find(layers, 'stat')!).top;
    const bottom = bounds(find(layers, 'detail')!).bottom;
    const centre = (top + bottom) / 2;
    expect(centre).toBeGreaterThan(44);
    expect(centre).toBeLessThan(50);
    expect(bottom).toBeLessThan(75);
  });

  it('keeps every theme in frame and non-overlapping for the heavy variants', () => {
    const variants: Array<Partial<StatHighlightInput>> = [
      { description: LONG_BODY, detail: 'Measured at the counting station.' },
      { description: BULLETS_MANY },
      { description: ABSURD_BODY, detail: 'Detail' },
      { stat: LONG_TITLE, description: SENTENCE },
      { stat: `${LONG_TITLE} ${LONG_TITLE}`, description: LONG_BODY, detail: 'Detail' },
    ];
    for (const theme of Object.values(THEMES)) {
      for (const viewport of [VIEWPORT_PRESETS.landscape, VIEWPORT_PRESETS.portrait]) {
        const context = createTemplateContext(theme, 0, 5, viewport);
        for (const variant of variants) {
          const layers = statHighlight(block(variant), context);
          expectStacked(layers, ['stat', 'description', 'detail']);
          expectInFrame(layers);
        }
      }
    }
  });

  it('keeps the lockup above a bottom accent strip', () => {
    const layers = statHighlight(
      block({
        description: LONG_BODY,
        detail: 'Detail',
        accentImage: { src: 'hero.svg', alt: 'Hero', position: 'bottom-strip' },
      }),
      landscape(),
    );
    expectStacked(layers, ['stat', 'description', 'detail']);
    expectInFrame(layers, 82);
  });
});
