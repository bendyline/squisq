import { describe, expect, it } from 'vitest';
import { createTemplateContext } from '../../../schemas/BlockTemplates.js';
import type { FactCardInput } from '../../../schemas/BlockTemplates.js';
import type { Layer, TextLayer } from '../../../schemas/Doc.js';
import { DEFAULT_THEME, THEMES } from '../../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../../../schemas/Viewport.js';
import { themedFontSize } from '../../utils/themeUtils.js';
import { factCard } from '../factCard.js';

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

function block(overrides: Partial<FactCardInput> = {}): FactCardInput {
  return {
    template: 'factCard',
    id: 'fc',
    duration: 8,
    audioSegment: 0,
    fact: 'Reusable blocks make drift visible',
    explanation: SENTENCE,
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

describe('factCard swatch geometry', () => {
  it('keeps the left-aligned centred-column contract on every text layer', () => {
    const layers = factCard(block({ source: 'Harbor Authority counts' }), landscape());
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

  it('places the source below the measured bottom of a long explanation', () => {
    const layers = factCard(
      block({ explanation: LONG_BODY, source: 'Harbor Authority counts' }),
      landscape(),
    );
    expectStacked(layers, ['fact', 'explanation', 'source']);
    expectInFrame(layers);
    // A 180-word body still fits at the base size once the stack is measured.
    expect(find(layers, 'explanation')!.content.style.fontSize).toBe(
      themedFontSize(34, landscape(), false),
    );
  });

  it('keeps ten bullets and a code fence inside the frame', () => {
    for (const explanation of [
      BULLETS_MANY,
      Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n'),
    ]) {
      const layers = factCard(block({ explanation, source: 'Source' }), landscape());
      expectStacked(layers, ['fact', 'explanation', 'source']);
      expectInFrame(layers);
    }
  });

  it('steps the explanation size down and clamps at the floor for an absurd body', () => {
    const context = landscape();
    const layers = factCard(block({ explanation: ABSURD_BODY }), context);
    const explanation = find(layers, 'explanation')!;
    const base = themedFontSize(34, context, false);
    expect(explanation.content.style.fontSize).toBeLessThan(base);
    expect(explanation.content.style.fontSize).toBeGreaterThanOrEqual(18);
    expect(explanation.content.style.maxLines).toBeGreaterThan(1);
    expectInFrame(layers);
  });

  it('steps a long heading in the hero slot down instead of leaving the frame', () => {
    const context = landscape();
    const base = themedFontSize(56, context, true);
    const layers = factCard(
      block({ fact: `${LONG_TITLE} ${LONG_TITLE} ${LONG_TITLE}`, explanation: PARAGRAPH }),
      context,
    );
    const fact = find(layers, 'fact')!;
    expect(fact.content.style.fontSize).toBeLessThan(base);
    expect(fact.content.style.fontSize).toBeGreaterThanOrEqual(Math.round(base * 0.5));
    expect(fact.content.style.shrinkToFit).toBe(true);
    expectStacked(layers, ['fact', 'explanation']);
    expectInFrame(layers);
  });

  it('renders the fact alone when the block has no body and never returns an empty slide', () => {
    const layers = factCard(block({ explanation: '' }), landscape());
    expect(layers.length).toBeGreaterThan(1);
    expect(find(layers, 'explanation')).toBeUndefined();
    const fact = find(layers, 'fact')!;
    expect(fact.content.text).toBe('Reusable blocks make drift visible');
    // Centred on the optical centre rather than stranded at the top.
    expect(bounds(fact).centre).toBeGreaterThan(40);
    expect(bounds(fact).centre).toBeLessThan(54);
  });

  it('keeps a short lockup composed around the optical centre', () => {
    const layers = factCard(block({ source: 'Source' }), landscape());
    const top = bounds(find(layers, 'fact')!).top;
    const bottom = bounds(find(layers, 'source')!).bottom;
    const centre = (top + bottom) / 2;
    expect(centre).toBeGreaterThan(44);
    expect(centre).toBeLessThan(50);
    expect(bottom).toBeLessThan(70);
  });

  it('keeps every theme in frame and non-overlapping for the heavy variants', () => {
    const variants: Array<Partial<FactCardInput>> = [
      { explanation: LONG_BODY, source: 'Harbor Authority counts' },
      { explanation: BULLETS_MANY },
      { explanation: ABSURD_BODY, source: 'Source' },
      { fact: LONG_TITLE, explanation: SENTENCE },
      { fact: `${LONG_TITLE} ${LONG_TITLE}`, explanation: LONG_BODY, source: 'Source' },
    ];
    for (const theme of Object.values(THEMES)) {
      for (const viewport of [VIEWPORT_PRESETS.landscape, VIEWPORT_PRESETS.portrait]) {
        const context = createTemplateContext(theme, 0, 5, viewport);
        for (const variant of variants) {
          const layers = factCard(block(variant), context);
          expectStacked(layers, ['fact', 'explanation', 'source']);
          expectInFrame(layers);
        }
      }
    }
  });

  it('keeps the lockup above a bottom accent strip', () => {
    const layers = factCard(
      block({
        explanation: LONG_BODY,
        source: 'Source',
        accentImage: { src: 'hero.svg', alt: 'Hero', position: 'bottom-strip' },
      }),
      landscape(),
    );
    expectStacked(layers, ['fact', 'explanation', 'source']);
    expectInFrame(layers, 82);
  });
});
