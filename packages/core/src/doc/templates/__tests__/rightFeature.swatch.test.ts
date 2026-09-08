import { describe, expect, it } from 'vitest';
import { createTemplateContext } from '../../../schemas/BlockTemplates.js';
import type { LeftFeatureInput, RightFeatureInput } from '../../../schemas/BlockTemplates.js';
import type { TextLayer } from '../../../schemas/Doc.js';
import { DEFAULT_THEME, THEMES } from '../../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../../../schemas/Viewport.js';
import { leftFeature, rightFeature } from '../featureBlock.js';

const VIEWPORT = VIEWPORT_PRESETS.landscape;
const context = (themeId = 'standard') =>
  createTemplateContext(THEMES[themeId] ?? DEFAULT_THEME, 0, 1, VIEWPORT);

const base: Omit<RightFeatureInput, 'title' | 'body'> = {
  template: 'rightFeature',
  id: 'rf',
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
const INTL_BODY =
  '港の再設計は六月に一般公開され、週末の歩行者数は一か月で倍増した。 أعيد تصميم الواجهة البحرية وافتُتحت للجمهور في يونيو. Die Neugestaltung der Uferpromenade wurde im Juni eröffnet.';

const pct = (value: string | number | undefined): number => {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  return parseFloat(value.replace('%', ''));
};

function textLayer(layers: ReturnType<typeof rightFeature>, id: string): TextLayer {
  const layer = layers.find((l): l is TextLayer => l.type === 'text' && l.id === id);
  if (!layer) throw new Error(`missing text layer ${id}`);
  return layer;
}

describe('rightFeature swatch geometry', () => {
  it('mirrors leftFeature: same vertical geometry and sizes, column on the left half', () => {
    for (const themeId of Object.keys(THEMES)) {
      for (const input of [
        { title: 'Text-led comparison', body: SENTENCE },
        { title: 'Text-led comparison', body: LONG_BODY },
        { title: LONG_TITLE, body: SENTENCE },
        { title: 'Text-led comparison', body: INTL_BODY },
      ]) {
        const right = rightFeature({ ...base, ...input }, context(themeId));
        const left = leftFeature(
          {
            ...(base as unknown as Omit<LeftFeatureInput, 'title' | 'body'>),
            template: 'leftFeature',
            ...input,
          },
          context(themeId),
        );
        for (const id of ['feature-title', 'feature-body']) {
          const r = textLayer(right, id);
          const l = textLayer(left, id);
          expect(r.position.y, `${themeId} ${id} y`).toBe(l.position.y);
          expect(r.position.width, `${themeId} ${id} width`).toBe(l.position.width);
          expect(r.content.style.fontSize, `${themeId} ${id} size`).toBe(l.content.style.fontSize);
          expect(r.content.style.maxLines, `${themeId} ${id} maxLines`).toBe(
            l.content.style.maxLines,
          );
          expect(r.position.x, `${themeId} ${id} x`).toBe('6%');
          expect(r.position.anchor).toBe('top-left');
          expect(r.content.style.textAlign).toBe('left');
          // The column must stay on the text half: never past the 50% divider.
          expect(
            pct(r.position.x) + pct(r.position.width),
            `${themeId} ${id} right edge`,
          ).toBeLessThanOrEqual(48);
        }
        const image = right.find((l) => l.type === 'image');
        expect(image?.position.x).toBe('50%');
        expect(image?.position.width).toBe('50%');
      }
    }
  });

  it('keeps a wide-glyph body from spilling across the divider onto the image half', () => {
    const layers = rightFeature(
      { ...base, title: 'Text-led comparison', body: INTL_BODY },
      context(),
    );
    const body = textLayer(layers, 'feature-body');
    const widthPx = (pct(body.position.width) / 100) * VIEWPORT.width;
    // Renderer chars per line at the narrowed box; a pure-ideograph line at
    // 1em per glyph must fit the 42% column.
    expect(widthPx).toBeLessThan(0.42 * VIEWPORT.width);
    expect(pct(body.position.x) + pct(body.position.width)).toBeLessThanOrEqual(48);
  });

  it('never returns an empty layer list when the image is missing', () => {
    const layers = rightFeature(
      { ...base, imageSrc: '', title: 'Text-led comparison', body: SENTENCE },
      context(),
    );
    expect(layers.length).toBeGreaterThanOrEqual(3);
    expect(layers.map((l) => l.id)).toEqual(['feature-bg', 'feature-title', 'feature-body']);
  });
});
