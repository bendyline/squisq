import { describe, expect, it } from 'vitest';
import { createTemplateContext } from '../../../schemas/BlockTemplates.js';
import type { Layer, TextLayer } from '../../../schemas/Doc.js';
import { DEFAULT_THEME, THEMES } from '../../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../../../schemas/Viewport.js';
import { themedFontSize } from '../../utils/themeUtils.js';
import { sectionHeader } from '../sectionHeader.js';

const LONG_TITLE =
  'How the Harbor Waterfront Redesign Doubled Weekend Foot Traffic Without Slowing the Bypass or Cutting Evening Ferry Service';
const ABSURD_TITLE = Array.from({ length: 6 }, () => LONG_TITLE).join(' ');

const pct = (v: string | number | undefined): number => parseFloat(String(v));

function extent(layer: Layer): { top: number; bottom: number } {
  const y = pct(layer.position.y);
  const h = pct(layer.position.height ?? '0%');
  return { top: y - h / 2, bottom: y + h / 2 };
}

function render(title: string, themeId = DEFAULT_THEME.id, imageSrc?: string) {
  const context = createTemplateContext(THEMES[themeId], 0, 1, VIEWPORT_PRESETS.landscape);
  const layers = sectionHeader(
    { template: 'sectionHeader', id: 's', duration: 5, audioSegment: 0, title, imageSrc },
    context,
  );
  const title_ = layers.find((l): l is TextLayer => l.type === 'text' && l.id === 'title')!;
  const top = layers.find((l) => l.id === 'line-top');
  const bottom = layers.find((l) => l.id === 'line-bottom');
  return { context, layers, title: title_, lineTop: top, lineBottom: bottom };
}

describe('sectionHeader lockup geometry', () => {
  it('keeps the 40/60 rule composition for a short title', () => {
    const { title, lineTop, lineBottom } = render('Signals Worth Keeping');
    expect(pct(lineTop!.position.y)).toBe(40);
    expect(pct(lineBottom!.position.y)).toBe(60);
    expect(pct(title.position.y)).toBe(50);
    expect(title.content.style.shrinkToFit).toBe(true);
    expect(title.content.style.lineHeight).toBe(1.4);
  });

  it('gives the title an explicit centred box', () => {
    const { title } = render(LONG_TITLE);
    expect(title.position.anchor).toBe('center');
    expect(title.position.height).toMatch(/%$/);
    const e = extent(title);
    expect((e.top + e.bottom) / 2).toBeCloseTo(50, 6);
  });

  it.each(Object.keys(THEMES))(
    'brackets a long title with rules clear of its box in the %s theme',
    (themeId) => {
      const { title, lineTop, lineBottom } = render(LONG_TITLE, themeId);
      const e = extent(title);
      expect(pct(lineTop!.position.y)).toBeLessThan(e.top);
      expect(pct(lineBottom!.position.y)).toBeGreaterThan(e.bottom);
      expect(pct(lineTop!.position.y)).toBeGreaterThanOrEqual(0);
      expect(pct(lineBottom!.position.y)).toBeLessThanOrEqual(100);
      // The title box never exceeds half the frame.
      expect(e.bottom - e.top).toBeLessThanOrEqual(50 + 1e-6);
      expect(title.content.style.maxLines).toBeUndefined();
    },
  );

  it('steps the title size down for a very long heading and clamps at the floor', () => {
    const { context, title, lineTop, lineBottom } = render(ABSURD_TITLE);
    const base = themedFontSize(84, context, true);
    expect(title.content.style.fontSize).toBeLessThan(base);
    expect(title.content.style.fontSize).toBeGreaterThanOrEqual(Math.round(base * 0.55));
    expect(title.content.style.maxLines).toBeGreaterThan(0);
    const e = extent(title);
    expect(e.top).toBeGreaterThanOrEqual(20);
    expect(e.bottom).toBeLessThanOrEqual(80);
    expect(pct(lineTop!.position.y)).toBeLessThan(e.top);
    expect(pct(lineBottom!.position.y)).toBeGreaterThan(e.bottom);
  });

  it('keeps the bold long title inside the frame', () => {
    const { title } = render(LONG_TITLE, 'bold');
    const e = extent(title);
    expect(e.top).toBeGreaterThanOrEqual(20);
    expect(e.bottom).toBeLessThanOrEqual(80);
  });

  it('keeps the same fitted box on the image variant (no rules, theme text)', () => {
    const plain = render(LONG_TITLE);
    const image = render(LONG_TITLE, DEFAULT_THEME.id, '/swatch-assets/hero.svg');
    expect(image.lineTop).toBeUndefined();
    expect(image.title.position.height).toBe(plain.title.position.height);
    expect(image.title.content.style.fontSize).toBe(plain.title.content.style.fontSize);
    expect(image.title.content.style.shrinkToFit).toBe(true);
  });

  it('renders a title layer even for an empty heading (never a blank frame)', () => {
    const { layers, title } = render('');
    expect(layers.length).toBeGreaterThan(1);
    expect(title).toBeDefined();
    expect(extent(title).top).toBeGreaterThan(0);
  });
});
