import { describe, expect, it } from 'vitest';
import { createTemplateContext } from '../../../schemas/BlockTemplates.js';
import type { LeftFeatureInput } from '../../../schemas/BlockTemplates.js';
import type { TextLayer } from '../../../schemas/Doc.js';
import { DEFAULT_THEME, THEMES } from '../../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../../../schemas/Viewport.js';
import { themedFontSize } from '../../utils/themeUtils.js';
import { fitWrapWidth, leftFeature } from '../featureBlock.js';

const VIEWPORT = VIEWPORT_PRESETS.landscape;
const context = (themeId = 'standard') =>
  createTemplateContext(THEMES[themeId] ?? DEFAULT_THEME, 0, 1, VIEWPORT);

const base: Omit<LeftFeatureInput, 'title' | 'body'> = {
  template: 'leftFeature',
  id: 'lf',
  duration: 6,
  audioSegment: 0,
  imageSrc: '/swatch-assets/detail.svg',
  imageAlt: 'Field notes',
};

const SENTENCE =
  'The waterfront redesign opened to the public in June, and weekend foot traffic doubled within a month.';
const LONG_BODY = Array.from({ length: 9 }, () => SENTENCE).join(' ');
const LONG_TITLE =
  'How the Harbor Waterfront Redesign Doubled Weekend Foot Traffic Without Slowing the Bypass or Cutting Evening Ferry Service';
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
const INTL_BODY =
  '港の再設計は六月に一般公開され、週末の歩行者数は一か月で倍増した。 أعيد تصميم الواجهة البحرية وافتُتحت للجمهور في يونيو. Die Neugestaltung der Uferpromenade wurde im Juni eröffnet.';

const pct = (value: string | number | undefined): number => {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  return parseFloat(value.replace('%', ''));
};

function textLayer(layers: ReturnType<typeof leftFeature>, id: string): TextLayer {
  const layer = layers.find((l): l is TextLayer => l.type === 'text' && l.id === id);
  if (!layer) throw new Error(`missing text layer ${id}`);
  return layer;
}

/** Bottom edge (in % of viewport height) implied by the layer's estimated line count. */
function estimatedBottomPct(layer: TextLayer, lines: number): number {
  const { fontSize, lineHeight = 1.4 } = layer.content.style;
  return pct(layer.position.y) + ((lines * fontSize * lineHeight) / VIEWPORT.height) * 100;
}

/** Same character model the renderer uses: floor(width / (0.5 · fontSize)) chars per line. */
function rendererLineCount(layer: TextLayer): number {
  const widthPx = (pct(layer.position.width) / 100) * VIEWPORT.width;
  const { fontSize, maxLines } = layer.content.style;
  const charsPerLine = Math.floor(widthPx / (fontSize * 0.5));
  let count = 0;
  for (const segment of layer.content.text.split('\n')) {
    let current = 0;
    for (const word of segment.split(/\s+/)) {
      const test = current ? current + 1 + word.length : word.length;
      if (test <= charsPerLine) {
        current = test;
        continue;
      }
      if (current) count += 1;
      let remaining = word.length;
      while (remaining > charsPerLine) {
        count += 1;
        remaining -= charsPerLine;
      }
      current = remaining;
    }
    count += current ? 1 : 0;
  }
  return Math.min(Math.max(1, count), maxLines ?? Number.POSITIVE_INFINITY);
}

describe('leftFeature swatch geometry', () => {
  const themeIds = Object.keys(THEMES);
  const variants: Record<string, Pick<LeftFeatureInput, 'title' | 'body'>> = {
    short: { title: 'Image-led explanation', body: SENTENCE },
    long: { title: 'Image-led explanation', body: LONG_BODY },
    'bullets-many': { title: 'Image-led explanation', body: BULLETS_MANY },
    'long-title': { title: LONG_TITLE, body: SENTENCE },
    'long-title-long-body': { title: LONG_TITLE, body: LONG_BODY },
    intl: { title: 'Image-led explanation', body: INTL_BODY },
  };

  it('keeps every text layer inside the frame and the body below the title in all themes', () => {
    for (const themeId of themeIds) {
      for (const [variant, input] of Object.entries(variants)) {
        const label = `${themeId}/${variant}`;
        const layers = leftFeature({ ...base, ...input }, context(themeId));
        const title = textLayer(layers, 'feature-title');
        const body = textLayer(layers, 'feature-body');

        const titleBottom = estimatedBottomPct(title, rendererLineCount(title));
        const bodyBottom = estimatedBottomPct(body, rendererLineCount(body));

        expect(pct(title.position.y), `${label} title top`).toBeGreaterThanOrEqual(8);
        expect(pct(body.position.y), `${label} body starts below title`).toBeGreaterThan(
          titleBottom,
        );
        expect(bodyBottom, `${label} body bottom`).toBeLessThanOrEqual(90.5);
        // Column never crosses the frame edge: left edge + wrap width ≤ 96%.
        expect(
          pct(title.position.x) + pct(title.position.width),
          `${label} title right edge`,
        ).toBeLessThanOrEqual(96);
        expect(
          pct(body.position.x) + pct(body.position.width),
          `${label} body right edge`,
        ).toBeLessThanOrEqual(96);
      }
    }
  });

  it('keeps a one-line title + short body composed around the old 42% slot', () => {
    const layers = leftFeature({ ...base, ...variants.short }, context());
    const title = textLayer(layers, 'feature-title');
    const body = textLayer(layers, 'feature-body');
    expect(pct(title.position.y)).toBeGreaterThan(36);
    expect(pct(title.position.y)).toBeLessThan(48);
    expect(title.content.style.fontSize).toBe(themedFontSize(48, context(), true));
    expect(body.content.style.fontSize).toBe(themedFontSize(24, context(), false));
    expect(title.content.style.maxLines).toBeUndefined();
    expect(body.content.style.maxLines).toBeUndefined();
  });

  it('keeps a ~180-word body inside the text band, stepping the font down only when needed', () => {
    const ctx = context();
    const layers = leftFeature({ ...base, ...variants.long }, ctx);
    const body = textLayer(layers, 'feature-body');
    expect(body.content.style.fontSize).toBeLessThanOrEqual(themedFontSize(24, ctx, false));
    expect(body.content.style.fontSize).toBeGreaterThanOrEqual(themedFontSize(18, ctx, false));
    expect(estimatedBottomPct(body, rendererLineCount(body))).toBeLessThanOrEqual(90.5);
  });

  it('clamps with maxLines at the readable floor for an absurd body', () => {
    const ctx = context();
    const absurd = Array.from({ length: 40 }, () => SENTENCE).join(' ');
    const layers = leftFeature({ ...base, title: 'Image-led explanation', body: absurd }, ctx);
    const body = textLayer(layers, 'feature-body');
    expect(body.content.style.fontSize).toBe(themedFontSize(18, ctx, false));
    expect(body.content.style.maxLines).toBeGreaterThan(1);
    expect(estimatedBottomPct(body, body.content.style.maxLines!)).toBeLessThanOrEqual(90.5);
  });

  it('keeps a long title to at most ~45% of the text band with the body below it', () => {
    const ctx = context();
    const layers = leftFeature({ ...base, ...variants['long-title'] }, ctx);
    const title = textLayer(layers, 'feature-title');
    const body = textLayer(layers, 'feature-body');
    expect(title.content.style.fontSize).toBeLessThanOrEqual(themedFontSize(48, ctx, true));
    expect(title.content.style.fontSize).toBeGreaterThanOrEqual(themedFontSize(30, ctx, true));
    const titleBottom = estimatedBottomPct(title, rendererLineCount(title));
    expect(titleBottom - pct(title.position.y)).toBeLessThanOrEqual(0.45 * 82 + 0.01);
    expect(pct(body.position.y)).toBeGreaterThan(titleBottom);
  });

  it('narrows the wrap box for wide-glyph (CJK / emoji) text so painted lines stay in the column', () => {
    const column = 0.42 * VIEWPORT.width;
    expect(fitWrapWidth(SENTENCE, 24, column, 'Inter, sans-serif')).toBe(column);
    const wide = fitWrapWidth(INTL_BODY, 24, column, 'Inter, sans-serif');
    expect(wide).toBeLessThan(column);
    expect(wide).toBeGreaterThanOrEqual(column * 0.5);

    const layers = leftFeature({ ...base, ...variants.intl }, context());
    const body = textLayer(layers, 'feature-body');
    expect(pct(body.position.width)).toBeLessThan(42);
    const latin = textLayer(leftFeature({ ...base, ...variants.short }, context()), 'feature-body');
    expect(latin.position.width).toBe('42%');
  });

  it('narrows the wrap box for a monospace title face (tech-dark)', () => {
    const column = 0.42 * VIEWPORT.width;
    const mono = fitWrapWidth(LONG_TITLE, 48, column, '"JetBrains Mono", monospace');
    expect(mono).toBeLessThan(column);
    // 0.6em glyphs at floor(width / 0.5em) chars per line → ≤ column/1.2 is enough.
    expect(mono).toBeLessThanOrEqual(column / 1.2 + column * 0.03);

    const layers = leftFeature({ ...base, ...variants['long-title'] }, context('tech-dark'));
    const title = textLayer(layers, 'feature-title');
    expect(pct(title.position.width)).toBeLessThan(42);
    expect(pct(title.position.x) + pct(title.position.width)).toBeLessThanOrEqual(96);
  });

  it('still renders the text on the theme surface when the image is missing', () => {
    const layers = leftFeature(
      { ...base, imageSrc: '', title: 'Image-led explanation', body: SENTENCE },
      context(),
    );
    expect(layers.length).toBeGreaterThan(0);
    expect(layers[0].id).toBe('feature-bg');
    expect(layers.some((l) => l.type === 'image')).toBe(false);
    expect(layers.some((l) => l.id === 'feature-title')).toBe(true);
    expect(layers.some((l) => l.id === 'feature-body')).toBe(true);
  });

  it('keeps the text column anchored top-left at 54% on the right half', () => {
    const layers = leftFeature({ ...base, ...variants.long }, context());
    for (const layer of layers.filter((l): l is TextLayer => l.type === 'text')) {
      expect(layer.position.x).toBe('54%');
      expect(layer.position.anchor).toBe('top-left');
      expect(layer.content.style.textAlign).toBe('left');
    }
  });
});
