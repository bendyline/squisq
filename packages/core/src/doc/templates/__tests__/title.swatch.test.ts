import { describe, expect, it } from 'vitest';
import { createTemplateContext } from '../../../schemas/BlockTemplates.js';
import type { Layer, TextLayer } from '../../../schemas/Doc.js';
import { DEFAULT_THEME, THEMES } from '../../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../../../schemas/Viewport.js';
import { themedFontSize } from '../../utils/themeUtils.js';
import { titleBlock } from '../titleBlock.js';

const SUBTITLE = 'A compact visual audit across every built-in theme';
const LONG_TITLE =
  'How the Harbor Waterfront Redesign Doubled Weekend Foot Traffic Without Slowing the Bypass or Cutting Evening Ferry Service';
const ABSURD_TITLE = Array.from({ length: 6 }, () => LONG_TITLE).join(' ');

const pct = (v: string | number | undefined): number => parseFloat(String(v));

/** Vertical extent of a centre-anchored boxed layer, in viewport percent. */
function extent(layer: Layer): { top: number; bottom: number } {
  const y = pct(layer.position.y);
  const h = pct(layer.position.height ?? '0%');
  return layer.position.anchor === 'center'
    ? { top: y - h / 2, bottom: y + h / 2 }
    : { top: y, bottom: y + h };
}

function render(title: string, themeId = DEFAULT_THEME.id, subtitle: string | null = SUBTITLE) {
  const context = createTemplateContext(THEMES[themeId], 0, 1, VIEWPORT_PRESETS.landscape);
  const layers = titleBlock(
    {
      template: 'title',
      id: 't',
      duration: 5,
      audioSegment: 0,
      title,
      ...(subtitle === null ? {} : { subtitle }),
    },
    context,
  );
  const text = (id: string) =>
    layers.find((l): l is TextLayer => l.type === 'text' && l.id === id)!;
  return {
    context,
    layers,
    title: text('title'),
    subtitle: text('subtitle'),
    accent: layers.find((l) => l.id === 'accent-line'),
  };
}

describe('titleBlock lockup geometry', () => {
  it('keeps the historic composition for a one-line title and subtitle', () => {
    const { title, subtitle } = render('Designing Better Blocks');
    // The one-line title used to sit centred at 42%; the measured stack
    // keeps it there (within a fraction of a percent).
    expect(pct(title.position.y)).toBeCloseTo(42, 0);
    expect(pct(title.position.height)).toBeGreaterThan(0);
    expect(extent(subtitle).top).toBeGreaterThan(extent(title).bottom);
    expect(title.content.style.shrinkToFit).toBe(true);
    expect(title.content.style.lineHeight).toBe(1.15);
  });

  it('gives the title an explicit box so the renderer centres the wrapped block', () => {
    const { title } = render(LONG_TITLE);
    expect(title.position.anchor).toBe('center');
    expect(title.position.height).toMatch(/%$/);
    expect(title.content.style.shrinkToFit).toBe(true);
  });

  it.each(Object.keys(THEMES))(
    'places the subtitle below a long title without overlap in the %s theme',
    (themeId) => {
      const { title, subtitle, accent } = render(LONG_TITLE, themeId);
      const t = extent(title);
      const s = extent(subtitle);
      expect(s.top).toBeGreaterThan(t.bottom);
      expect(t.top).toBeGreaterThanOrEqual(5);
      expect(s.bottom).toBeLessThanOrEqual(95);
      if (accent) {
        expect(pct(accent.position.y)).toBeLessThan(t.top);
        expect(pct(accent.position.y)).toBeGreaterThanOrEqual(2);
      }
      expect(title.content.style.maxLines).toBeUndefined();
    },
  );

  it('steps the title size down for a very long heading instead of leaving the frame', () => {
    const { context, title, subtitle } = render(ABSURD_TITLE);
    const base = themedFontSize(96, context, true);
    expect(title.content.style.fontSize).toBeLessThan(base);
    expect(title.content.style.fontSize).toBeGreaterThanOrEqual(Math.round(base * 0.55));
    // At the readable floor the layer clamps its line count.
    expect(title.content.style.maxLines).toBeGreaterThan(0);
    const t = extent(title);
    const s = extent(subtitle);
    expect(t.top).toBeGreaterThanOrEqual(5);
    expect(s.top).toBeGreaterThan(t.bottom);
    expect(s.bottom).toBeLessThanOrEqual(95);
  });

  it('keeps the bold (wide face, larger title scale) long title inside the frame', () => {
    const { title, subtitle } = render(LONG_TITLE, 'bold');
    expect(extent(title).top).toBeGreaterThanOrEqual(5);
    expect(extent(subtitle).bottom).toBeLessThanOrEqual(95);
  });

  it('grows the stack symmetrically around the same centre for long content', () => {
    const short = render('Designing Better Blocks');
    const long = render(LONG_TITLE);
    const centre = (r: ReturnType<typeof render>) =>
      (extent(r.title).top + extent(r.subtitle).bottom) / 2;
    expect(centre(long)).toBeCloseTo(centre(short), 0);
  });

  it('centres a title without subtitle at 48% and never emits a subtitle layer', () => {
    const { layers, title } = render('Designing Better Blocks', DEFAULT_THEME.id, null);
    expect(pct(title.position.y)).toBeCloseTo(48, 0);
    expect(layers.some((l) => l.id === 'subtitle')).toBe(false);
  });

  it('positions nothing past the frame edges for any theme', () => {
    for (const themeId of Object.keys(THEMES)) {
      for (const text of ['Short', LONG_TITLE, ABSURD_TITLE]) {
        const { layers } = render(text, themeId);
        for (const layer of layers) {
          if (layer.type !== 'text') continue;
          const e = extent(layer);
          expect(e.top).toBeGreaterThanOrEqual(0);
          expect(e.bottom).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});
