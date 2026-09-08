import { describe, expect, it } from 'vitest';
import { createTemplateContext } from '../../../schemas/BlockTemplates.js';
import type { Layer, TextLayer } from '../../../schemas/Doc.js';
import { DEFAULT_THEME, getAvailableThemes, resolveTheme } from '../../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../../../schemas/Viewport.js';
import { themedFontSize } from '../../utils/themeUtils.js';
import { estimateProseLineCount } from '../captionUtils.js';
import { pullQuote } from '../pullQuote.js';
import { videoPullQuote } from '../videoPullQuote.js';

const SHORT =
  'The waterfront redesign opened to the public in June, and weekend foot traffic doubled within a month.';

const LONG = Array.from(
  { length: 8 },
  () =>
    'Roughly a third of the trips simply disappeared, absorbed by the ferry, the new cycle track, and people choosing to walk the last kilometre.',
).join(' ');

const landscape = VIEWPORT_PRESETS.landscape;
const VIDEO = { src: 'clip.mp4', posterSrc: 'poster.svg', alt: 'Harbor clip' };

function render(
  text: string,
  extra: Partial<Parameters<typeof videoPullQuote>[0]> = {},
  theme = DEFAULT_THEME,
) {
  const context = createTemplateContext(theme, 0, 1, landscape);
  const layers = videoPullQuote(
    {
      template: 'videoPullQuote',
      id: 'vpq',
      duration: 12,
      audioSegment: 0,
      text,
      attribution: 'Video QA fixture',
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

function estimatedBottomPct(layer: TextLayer): number {
  const { fontSize, lineHeight = 1.4, maxLines } = layer.content.style;
  const widthPx = (pctOf(layer.position.width) / 100) * landscape.width;
  const lines = Math.min(
    estimateProseLineCount(layer.content.text, fontSize, widthPx),
    maxLines ?? Number.POSITIVE_INFINITY,
  );
  return pctOf(layer.position.y) + ((lines * fontSize * lineHeight) / landscape.height) * 100;
}

describe('videoPullQuote swatch geometry', () => {
  it('renders the quote on a theme surface when no background video is supplied', () => {
    const { layers } = render(SHORT);
    expect(layers.length).toBeGreaterThan(0);
    expect(layers[0].id).toBe('bg');
    expect(layers.find((l) => l.type === 'video')).toBeUndefined();
    expect(layers.find((l) => l.id === 'overlay')).toBeUndefined();
    expect(textLayer(layers, 'quote-text').content.style.color).toBe(DEFAULT_THEME.colors.text);
    expect(textLayer(layers, 'attribution').content.text).toBe('— Video QA fixture');
  });

  it('keeps the video, overlay and white text when a clip is present', () => {
    const { layers } = render(SHORT, { backgroundVideo: VIDEO });
    expect(layers[0].type).toBe('video');
    expect(layers[0].id).toBe('bg-video');
    expect(layers[1].id).toBe('overlay');
    if (layers[0].type === 'video') {
      expect(layers[0].content.clipStart).toBe(0);
      expect(layers[0].content.clipEnd).toBe(12);
    }
    expect(textLayer(layers, 'quote-text').content.style.color).toBe('#ffffff');
  });

  it('shares the lockup geometry with pullQuote', () => {
    const context = createTemplateContext(DEFAULT_THEME, 0, 1, landscape);
    const video = render(LONG, { backgroundVideo: VIDEO }).layers;
    const image = pullQuote(
      {
        template: 'pullQuote',
        id: 'pq',
        duration: 12,
        audioSegment: 0,
        text: LONG,
        attribution: 'Video QA fixture',
        backgroundImage: { src: 'hero.jpg', alt: 'Harbor' },
      },
      context,
    );
    for (const id of ['quote-text', 'attribution']) {
      const a = textLayer(video, id);
      const b = textLayer(image, id);
      expect(a.position).toEqual(b.position);
      expect(a.content.style.fontSize).toBe(b.content.style.fontSize);
    }
  });

  it('steps the quote size down for a long body and keeps the attribution below it', () => {
    const { context, layers } = render(LONG, { backgroundVideo: VIDEO });
    const quote = textLayer(layers, 'quote-text');
    const attribution = textLayer(layers, 'attribution');
    expect(quote.content.style.fontSize).toBeLessThan(themedFontSize(52, context, true));
    expect(pctOf(attribution.position.y)).toBeGreaterThan(estimatedBottomPct(quote));
    expect(estimatedBottomPct(attribution)).toBeLessThanOrEqual(92);
  });

  it('keeps every text layer inside the frame in every built-in theme', () => {
    for (const id of getAvailableThemes()) {
      const theme = resolveTheme(id);
      for (const text of [SHORT, LONG, `${LONG}\n${LONG}\n${LONG}`]) {
        for (const backgroundVideo of [VIDEO, undefined]) {
          const { layers } = render(text, { backgroundVideo }, theme);
          for (const layer of layers) {
            if (layer.type !== 'text') continue;
            const y = pctOf(layer.position.y);
            expect(y, `${id}: ${layer.id} y`).toBeGreaterThanOrEqual(0);
            expect(y, `${id}: ${layer.id} y`).toBeLessThan(100);
            if (layer.position.anchor === 'top-left') {
              expect(estimatedBottomPct(layer), `${id}: ${layer.id} bottom`).toBeLessThanOrEqual(
                92,
              );
            }
          }
        }
      }
    }
  });
});
