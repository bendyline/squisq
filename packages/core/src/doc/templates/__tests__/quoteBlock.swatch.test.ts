import { describe, expect, it } from 'vitest';
import { createTemplateContext } from '../../../schemas/BlockTemplates.js';
import type { QuoteBlockInput } from '../../../schemas/BlockTemplates.js';
import type { Layer, TextLayer } from '../../../schemas/Doc.js';
import { DEFAULT_THEME } from '../../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../../../schemas/Viewport.js';
import { themedFontSize } from '../../utils/themeUtils.js';
import { quoteBlock } from '../quoteBlock.js';

const context = () => createTemplateContext(DEFAULT_THEME, 0, 8, VIEWPORT_PRESETS.landscape);

const SENTENCE =
  'The waterfront redesign opened to the public in June, and weekend foot traffic doubled within a month.';
const PARAGRAPH =
  'The waterfront redesign replaced a four-lane arterial with a shared promenade, a protected cycle track, and a tidal garden that floods twice a day. Early counts show weekend foot traffic more than doubling, while vehicle throughput on the parallel bypass held steady. Merchants along the promenade report longer dwell times, and the harbor authority has already extended ferry hours to match the new evening crowds.';
const LONG = `When the harbor authority first proposed closing the arterial, the loudest objection was congestion: four lanes of traffic had to go somewhere, and the bypass was already busy at the evening peak. The counts told a different story. Roughly a third of the trips simply disappeared, absorbed by the ferry, the new cycle track, and people choosing to walk the last kilometre. The bypass gained about two hundred vehicles an hour, well inside its capacity, and average speeds there did not change in a measurable way.
What changed most was how long people stayed. Before the redesign the median visit to the promenade lasted fourteen minutes; afterwards it stretched to thirty-one, and the evening ferry — once nearly empty after nine — now runs full on Fridays and Saturdays. The tidal garden survived its first storm season with minor planting losses, the merchants voted to extend their hours, and the authority is now drafting the same treatment for the fishing quay on the north shore.`;
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

const base = {
  template: 'quote' as const,
  id: 'q-1',
  duration: 8,
  audioSegment: 0,
  title: 'On Public Space',
  attribution: 'Harbor Authority design notes',
};

const pctOf = (value: number | string | undefined): number => {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  return parseFloat(value);
};

interface Box {
  top: number;
  bottom: number;
  fontSize: number;
  layer: TextLayer;
}

const boxOf = (layers: Layer[], id: string): Box => {
  const layer = layers.find((l): l is TextLayer => l.type === 'text' && l.id === id);
  if (!layer) throw new Error(`missing text layer ${id}`);
  const top = pctOf(layer.position.y);
  return {
    top,
    bottom: top + pctOf(layer.position.height),
    fontSize: layer.content.style.fontSize,
    layer,
  };
};

const render = (overrides: Partial<QuoteBlockInput>): Layer[] =>
  quoteBlock({ ...base, quote: SENTENCE, ...overrides } as QuoteBlockInput, context());

const textLayers = (layers: Layer[]): TextLayer[] =>
  layers.filter((l): l is TextLayer => l.type === 'text');

describe('quoteBlock swatch geometry', () => {
  const baseQuoteSize = themedFontSize(48, context(), true);

  it('stacks title, quote and attribution top-left anchored inside the column', () => {
    const layers = render({});
    for (const id of ['quote-title', 'quote', 'attribution']) {
      const { layer } = boxOf(layers, id);
      expect(layer.position.anchor, id).toBe('top-left');
      expect(layer.position.x, id).toBe('7.5%');
      expect(layer.position.width, id).toBe('85%');
      expect(layer.position.height, id).toBeDefined();
      expect(layer.content.style.textAlign, id).toBe('center');
      expect(layer.content.style.shrinkToFit, id).toBe(true);
    }
  });

  it('keeps a short quote composed around the optical centre below the title', () => {
    const layers = render({});
    const title = boxOf(layers, 'quote-title');
    const quote = boxOf(layers, 'quote');
    const attr = boxOf(layers, 'attribution');
    expect(quote.fontSize).toBe(baseQuoteSize);
    expect(quote.top).toBeGreaterThan(title.bottom);
    expect(attr.top).toBeGreaterThan(quote.bottom);
    const lockupCentre = (quote.top + attr.bottom) / 2;
    expect(lockupCentre).toBeGreaterThan(42);
    expect(lockupCentre).toBeLessThan(58);
  });

  it('never lets the attribution overprint a multi-line quote', () => {
    for (const quote of [PARAGRAPH, LONG, BULLETS_MANY]) {
      const layers = render({ quote });
      const q = boxOf(layers, 'quote');
      const attr = boxOf(layers, 'attribution');
      expect(attr.top, quote.slice(0, 20)).toBeGreaterThan(q.bottom);
      expect(attr.bottom, quote.slice(0, 20)).toBeLessThanOrEqual(88.5);
    }
  });

  it('steps the quote size down for a long body instead of leaving the frame', () => {
    const layers = render({ quote: LONG });
    const quote = boxOf(layers, 'quote');
    expect(quote.fontSize).toBeLessThan(baseQuoteSize);
    expect(quote.fontSize).toBeGreaterThanOrEqual(22);
    expect(quote.layer.content.style.maxLines).toBeUndefined();
    expect(quote.bottom).toBeLessThan(88);
  });

  it('reserves a line for every forced break in list-derived bodies', () => {
    const layers = render({ quote: BULLETS_MANY });
    const quote = boxOf(layers, 'quote');
    const lineHeight = quote.layer.content.style.lineHeight ?? 1.4;
    const minHeightPct = ((10 * quote.fontSize * lineHeight) / 1080) * 100;
    expect(quote.bottom - quote.top).toBeGreaterThanOrEqual(minHeightPct - 0.01);
  });

  it('clamps with maxLines at the readable floor for a pathological body', () => {
    const absurd = Array.from({ length: 40 }, () => SENTENCE).join(' ');
    const layers = render({ quote: absurd });
    const quote = boxOf(layers, 'quote');
    expect(quote.layer.content.style.maxLines).toBeGreaterThan(0);
    expect(quote.fontSize).toBeGreaterThanOrEqual(22);
    const attr = boxOf(layers, 'attribution');
    expect(attr.top).toBeGreaterThan(quote.bottom);
    expect(attr.bottom).toBeLessThanOrEqual(88.5);
  });

  it('steps a long heading down and keeps it clear of the quote', () => {
    const layers = render({ title: LONG_TITLE });
    const title = boxOf(layers, 'quote-title');
    const quote = boxOf(layers, 'quote');
    expect(title.fontSize).toBeLessThanOrEqual(themedFontSize(34, context(), true));
    expect(title.bottom).toBeLessThan(quote.top);
  });

  it('keeps the decorative mark out of the text and drops it when there is no room', () => {
    const roomy = render({});
    const deco = roomy.find((l): l is TextLayer => l.type === 'text' && l.id === 'deco-quote');
    expect(deco).toBeDefined();
    const decoBottom =
      pctOf(deco!.position.y) + ((deco!.content.style.fontSize * 0.6) / 1080) * 100;
    expect(decoBottom).toBeLessThanOrEqual(boxOf(roomy, 'quote').top);
    const decoTop = pctOf(deco!.position.y) - ((deco!.content.style.fontSize * 0.6) / 1080) * 100;
    expect(decoTop).toBeGreaterThanOrEqual(boxOf(roomy, 'quote-title').bottom);

    const crowded = render({ quote: LONG });
    const decoOrNone = crowded.find((l) => l.id === 'deco-quote');
    if (decoOrNone && decoOrNone.type === 'text') {
      expect(decoOrNone.content.style.fontSize).toBeGreaterThanOrEqual(90);
      expect(
        pctOf(decoOrNone.position.y) + ((decoOrNone.content.style.fontSize * 0.6) / 1080) * 100,
      ).toBeLessThanOrEqual(boxOf(crowded, 'quote').top);
    }
  });

  it('positions nothing past the frame for any content shape', () => {
    const inputs: Array<Partial<QuoteBlockInput>> = [
      {},
      { quote: PARAGRAPH },
      { quote: LONG },
      { quote: BULLETS_MANY },
      { quote: LONG, title: LONG_TITLE },
      { quote: SENTENCE, title: undefined },
      { quote: SENTENCE, attribution: undefined },
      { quote: LONG, title: undefined, attribution: undefined },
      { quote: 'On Public Space', title: undefined },
      {
        quote: LONG,
        accentImage: { src: 'a.svg', alt: 'a', position: 'bottom-strip' },
      },
      {
        quote: LONG,
        accentImage: { src: 'a.svg', alt: 'a', position: 'right-strip' },
      },
    ];
    for (const input of inputs) {
      const layers = render(input);
      for (const layer of textLayers(layers)) {
        if (layer.id === 'deco-quote') continue;
        const top = pctOf(layer.position.y);
        const bottom = top + pctOf(layer.position.height);
        expect(top, layer.id).toBeGreaterThanOrEqual(0);
        expect(bottom, layer.id).toBeLessThanOrEqual(100);
        const left = pctOf(layer.position.x);
        expect(left + pctOf(layer.position.width), layer.id).toBeLessThanOrEqual(100.01);
      }
      // No two content text layers overlap vertically (they share a column).
      const boxes = textLayers(layers)
        .filter((l) => l.id !== 'deco-quote')
        .map((l) => ({
          id: l.id,
          top: pctOf(l.position.y),
          bottom: pctOf(l.position.y) + pctOf(l.position.height),
        }))
        .sort((a, b) => a.top - b.top);
      for (let i = 1; i < boxes.length; i += 1) {
        expect(boxes[i].top, `${boxes[i - 1].id} → ${boxes[i].id}`).toBeGreaterThanOrEqual(
          boxes[i - 1].bottom,
        );
      }
    }
  });

  it('lifts the band when a bottom strip takes the lower part of the frame', () => {
    const layers = render({
      quote: LONG,
      accentImage: { src: 'a.svg', alt: 'a', position: 'bottom-strip' },
    });
    expect(boxOf(layers, 'attribution').bottom).toBeLessThanOrEqual(78.5);
  });

  it('never returns an empty slide for a heading-only block', () => {
    const layers = quoteBlock(
      { template: 'quote', id: 'q', duration: 5, audioSegment: 0, quote: 'On Public Space' },
      context(),
    );
    expect(textLayers(layers).some((l) => l.id === 'quote' && l.content.text)).toBe(true);
  });
});
