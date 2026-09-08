import { describe, expect, it } from 'vitest';
import { createTemplateContext } from '../../../schemas/BlockTemplates.js';
import type { Layer, TextLayer } from '../../../schemas/Doc.js';
import { DEFAULT_THEME, getAvailableThemes, resolveTheme } from '../../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../../../schemas/Viewport.js';
import { themedFontSize } from '../../utils/themeUtils.js';
import { estimateProseLineCount } from '../captionUtils.js';
import { pullQuote } from '../pullQuote.js';

const SHORT =
  'The waterfront redesign opened to the public in June, and weekend foot traffic doubled within a month.';

const LONG = [
  'When the harbor authority first proposed closing the arterial, the loudest objection was congestion: four lanes of traffic had to go somewhere, and the bypass was already busy at the evening peak. The counts told a different story. Roughly a third of the trips simply disappeared, absorbed by the ferry, the new cycle track, and people choosing to walk the last kilometre. The bypass gained about two hundred vehicles an hour, well inside its capacity, and average speeds there did not change in a measurable way.',
  'What changed most was how long people stayed. Before the redesign the median visit to the promenade lasted fourteen minutes; afterwards it stretched to thirty-one, and the evening ferry — once nearly empty after nine — now runs full on Fridays and Saturdays. The tidal garden survived its first storm season with minor planting losses, the merchants voted to extend their hours, and the authority is now drafting the same treatment for the fishing quay on the north shore.',
].join('\n');

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

const ABSURD = Array.from({ length: 12 }, () => LONG).join('\n');

const landscape = VIEWPORT_PRESETS.landscape;

function render(
  text: string,
  extra: Partial<Parameters<typeof pullQuote>[0]> = {},
  theme = DEFAULT_THEME,
) {
  const context = createTemplateContext(theme, 0, 1, landscape);
  const layers = pullQuote(
    {
      template: 'pullQuote',
      id: 'pq',
      duration: 10,
      audioSegment: 0,
      text,
      attribution: 'Template review',
      ...extra,
    },
    context,
  );
  return { context, layers };
}

function textLayer(layers: Layer[], id: string): TextLayer {
  const layer = layers.find((l): l is TextLayer => l.type === 'text' && l.id === id);
  expect(layer, `text layer ${id}`).toBeDefined();
  return layer!;
}

function pctOf(value: string | number | undefined): number {
  return parseFloat(String(value));
}

/** Estimated bottom edge (percent of viewport height) of a top-left anchored text layer. */
function estimatedBottomPct(
  layer: TextLayer,
  viewportWidth: number,
  viewportHeight: number,
): number {
  const { fontSize, lineHeight = 1.4, maxLines } = layer.content.style;
  const widthPx = (pctOf(layer.position.width) / 100) * viewportWidth;
  const lines = Math.min(
    estimateProseLineCount(layer.content.text, fontSize, widthPx),
    maxLines ?? Number.POSITIVE_INFINITY,
  );
  return pctOf(layer.position.y) + ((lines * fontSize * lineHeight) / viewportHeight) * 100;
}

describe('pullQuote swatch geometry', () => {
  it('renders the quote on a theme surface when no background image is supplied', () => {
    const { layers } = render(SHORT);
    expect(layers.length).toBeGreaterThan(0);
    expect(layers[0].type).toBe('shape');
    expect(layers[0].id).toBe('bg');
    expect(layers.find((l) => l.id === 'bg-image')).toBeUndefined();
    expect(layers.find((l) => l.id === 'overlay')).toBeUndefined();

    const quote = textLayer(layers, 'quote-text');
    expect(quote.content.text).toBe(SHORT);
    // Theme text colour, not the over-photo white.
    expect(quote.content.style.color).toBe(DEFAULT_THEME.colors.text);
    expect(textLayer(layers, 'attribution').content.text).toBe('— Template review');
  });

  it('keeps the full-bleed image, overlay and white text when an image is present', () => {
    const { layers } = render(SHORT, { backgroundImage: { src: 'hero.jpg', alt: 'Harbor' } });
    expect(layers[0].id).toBe('bg-image');
    expect(layers[1].id).toBe('overlay');
    expect(layers.find((l) => l.id === 'bg')).toBeUndefined();
    expect(textLayer(layers, 'quote-text').content.style.color).toBe('#ffffff');
  });

  it('never returns an empty layer list, even for empty text', () => {
    const { layers } = render('', { attribution: undefined });
    expect(layers.length).toBeGreaterThan(0);
    expect(textLayer(layers, 'quote-text')).toBeDefined();
  });

  it('keeps a short quote composed around the centre of the block', () => {
    const { context, layers } = render(SHORT);
    const quote = textLayer(layers, 'quote-text');
    expect(quote.content.style.fontSize).toBe(themedFontSize(52, context, true));
    const top = pctOf(quote.position.y);
    expect(top).toBeGreaterThan(30);
    expect(top).toBeLessThan(50);
    // The attribution hangs directly under the quote, not near the bottom.
    const attribution = textLayer(layers, 'attribution');
    expect(pctOf(attribution.position.y)).toBeLessThan(70);
  });

  it('steps the quote size down for a long body and keeps the attribution below it', () => {
    const { context, layers } = render(LONG);
    const quote = textLayer(layers, 'quote-text');
    const attribution = textLayer(layers, 'attribution');

    expect(quote.content.style.fontSize).toBeLessThan(themedFontSize(52, context, true));
    expect(quote.content.style.maxLines).toBeUndefined();

    const quoteBottom = estimatedBottomPct(quote, landscape.width, landscape.height);
    expect(pctOf(attribution.position.y)).toBeGreaterThan(quoteBottom);
    const attrBottom = estimatedBottomPct(attribution, landscape.width, landscape.height);
    expect(attrBottom).toBeLessThanOrEqual(92);
    expect(pctOf(quote.position.y)).toBeGreaterThanOrEqual(10);
  });

  it('honours forced line breaks from list bodies when fitting', () => {
    const { layers } = render(BULLETS_MANY);
    const quote = textLayer(layers, 'quote-text');
    const attribution = textLayer(layers, 'attribution');
    const quoteBottom = estimatedBottomPct(quote, landscape.width, landscape.height);
    expect(pctOf(attribution.position.y)).toBeGreaterThan(quoteBottom);
    expect(estimatedBottomPct(attribution, landscape.width, landscape.height)).toBeLessThanOrEqual(
      92,
    );
  });

  it('clamps with maxLines at the readable floor instead of overflowing', () => {
    const { context, layers } = render(ABSURD);
    const quote = textLayer(layers, 'quote-text');
    const floor = Math.max(18, themedFontSize(24, context, true));
    expect(quote.content.style.fontSize).toBe(floor);
    expect(quote.content.style.maxLines).toBeGreaterThan(0);
    const attribution = textLayer(layers, 'attribution');
    expect(pctOf(attribution.position.y)).toBeGreaterThan(
      estimatedBottomPct(quote, landscape.width, landscape.height),
    );
    expect(estimatedBottomPct(attribution, landscape.width, landscape.height)).toBeLessThanOrEqual(
      92,
    );
  });

  it('asks the renderer to shrink the quote to the column for scripts the estimate cannot wrap', () => {
    const { layers } = render(SHORT);
    expect(textLayer(layers, 'quote-text').content.style.shrinkToFit).toBe(true);
  });

  it('keeps the ornament above the quote for short and tall stacks alike', () => {
    const short = render(SHORT);
    const deco = textLayer(short.layers, 'deco-quote');
    const quote = textLayer(short.layers, 'quote-text');
    expect(deco.content.style.fontSize).toBe(themedFontSize(200, short.context, true));
    expect(pctOf(deco.position.y)).toBeLessThan(pctOf(quote.position.y));
    expect(pctOf(deco.position.y)).toBeGreaterThan(0);

    const tall = render(ABSURD);
    const tallDeco = tall.layers.find((l) => l.id === 'deco-quote');
    if (tallDeco && tallDeco.type === 'text') {
      expect(pctOf(tallDeco.position.y)).toBeGreaterThan(0);
      expect(pctOf(tallDeco.position.y)).toBeLessThan(
        pctOf(textLayer(tall.layers, 'quote-text').position.y),
      );
    }
  });

  it('keeps every text layer inside the frame in every built-in theme and variant', () => {
    const variants = [SHORT, LONG, BULLETS_MANY, ABSURD, 'Pull Quote'];
    for (const id of getAvailableThemes()) {
      const theme = resolveTheme(id);
      for (const text of variants) {
        const { layers } = render(text, {}, theme);
        for (const layer of layers) {
          if (layer.type !== 'text') continue;
          const y = pctOf(layer.position.y);
          expect(y, `${id}: ${layer.id} y`).toBeGreaterThanOrEqual(0);
          expect(y, `${id}: ${layer.id} y`).toBeLessThan(100);
          if (layer.position.anchor === 'top-left') {
            expect(
              estimatedBottomPct(layer, landscape.width, landscape.height),
              `${id}: ${layer.id} bottom`,
            ).toBeLessThanOrEqual(92);
          }
        }
      }
    }
  });
});
