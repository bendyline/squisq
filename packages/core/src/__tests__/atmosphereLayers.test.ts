import { describe, it, expect } from 'vitest';
import { expandPersistentLayer } from '../doc/templates/persistentLayers.js';
import { cssFilterForTreatment } from '../doc/utils/imageTreatment.js';
import { themedImageTreatment } from '../doc/utils/themeUtils.js';
import { createTemplateContext } from '../schemas/BlockTemplates.js';
import { DEFAULT_THEME, resolveTheme } from '../schemas/themeLibrary.js';
import { validateTheme } from '../schemas/themeValidator.js';
import { THEMES } from '../schemas/themeLibrary.js';
import type { ShapeLayer, ImageLayer } from '../schemas/Doc.js';
import type { TitleCaptionConfig } from '../schemas/BlockTemplates.js';

describe('atmosphere persistent layers', () => {
  it('patternBackground expands dots/grid/diagonal to an SVG pattern fill', () => {
    const [layer] = expandPersistentLayer({
      template: 'patternBackground',
      config: { type: 'patternBackground', pattern: 'grid', color: '#00e5ff', opacity: 0.04 },
    }) as ShapeLayer[];
    expect(layer.type).toBe('shape');
    expect(layer.content.pattern).toEqual({
      kind: 'grid',
      color: '#00e5ff',
      size: 24,
      opacity: 0.04,
    });
  });

  it('patternBackground noise expands to a grain filter rect', () => {
    const [layer] = expandPersistentLayer({
      template: 'patternBackground',
      config: { type: 'patternBackground', pattern: 'noise', opacity: 0.05 },
    }) as ShapeLayer[];
    expect(layer.content.filter).toEqual({ type: 'noise', opacity: 0.05 });
  });

  it('vignette expands to a radial gradient rect with strength-scaled edge', () => {
    const [layer] = expandPersistentLayer({
      template: 'vignette',
      config: { type: 'vignette', strength: 0.4 },
    }) as ShapeLayer[];
    expect(layer.content.fill).toContain('radial-gradient');
    expect(layer.content.fill).toContain('rgba(0, 0, 0, 0.4)');
  });

  it('ambientGradient derives colors from the theme and drifts slowly', () => {
    const theme = resolveTheme('gezellig');
    const [layer] = expandPersistentLayer(
      { template: 'ambientGradient', config: { type: 'ambientGradient' } },
      theme,
    ) as ShapeLayer[];
    expect(layer.content.fill).toContain(theme.colors.backgroundLight);
    expect(layer.animation?.type).toBe('slowZoom');
    expect(layer.animation?.duration).toBe(40);
    // Oversized so the pan never reveals the frame edge
    expect(layer.position.width).toBe('110%');
  });

  it('imageBackground passes blur through to the image layer', () => {
    const [image] = expandPersistentLayer({
      template: 'imageBackground',
      config: { type: 'imageBackground', src: 'bg.jpg', blur: 12 },
    }) as ImageLayer[];
    expect(image.content.blur).toBe(12);
  });

  it('every built-in theme still validates with its atmosphere layers', () => {
    for (const [id, theme] of Object.entries(THEMES)) {
      const result = validateTheme(theme);
      expect(result.valid, `theme ${id}: ${JSON.stringify(result.errors)}`).toBe(true);
    }
  });
});

describe('image treatments', () => {
  it('mono produces a grayscale filter scaled by strength', () => {
    expect(cssFilterForTreatment({ type: 'mono', strength: 1 })).toContain('grayscale(1)');
    expect(cssFilterForTreatment({ type: 'mono', strength: 0.5 })).toContain('grayscale(0.5)');
  });

  it('duotone rotates hue toward the tint color', () => {
    // #ff0000 has hue 0 → rotation 0 - 40 = -40deg
    const f = cssFilterForTreatment({ type: 'duotone', color: '#ff0000' });
    expect(f).toContain('grayscale(1)');
    expect(f).toContain('hue-rotate(-40deg)');
  });

  it('none / absent treatments produce no filter', () => {
    expect(cssFilterForTreatment({ type: 'none' })).toBeUndefined();
    expect(cssFilterForTreatment(undefined)).toBeUndefined();
  });

  it('blur composes with (or without) a treatment', () => {
    expect(cssFilterForTreatment(undefined, 12)).toBe('blur(12px)');
    expect(cssFilterForTreatment({ type: 'mono' }, 8)).toMatch(/^blur\(8px\) grayscale/);
  });

  it('themedImageTreatment: block override wins, none opts out, duotone tints from primary', () => {
    const documentary = resolveTheme('documentary');
    const ctx = createTemplateContext(documentary, 0, 1);
    // Theme authors mono
    expect(themedImageTreatment(ctx)?.type).toBe('mono');
    // Block opts out
    expect(themedImageTreatment(ctx, 'none')).toBeUndefined();
    // Block forces duotone → tint defaults to theme primary
    expect(themedImageTreatment(ctx, 'duotone')?.color).toBe(documentary.colors.primary);
    // Standard theme has no treatment
    const plainCtx = createTemplateContext(DEFAULT_THEME, 0, 1);
    expect(themedImageTreatment(plainCtx)).toBeUndefined();
  });
});

// ── titleCaption geometry ───────────────────────────────────────────

/**
 * Expand a titleCaption and return each layer's horizontal extent as a
 * [left, right] pair in viewport-percent.
 */
function captionSpans(config: Partial<TitleCaptionConfig> & { position: CaptionPosition }) {
  const layers = expandPersistentLayer({
    template: 'titleCaption',
    config: {
      type: 'titleCaption',
      title: 'An article title',
      ...config,
    } as TitleCaptionConfig,
  });
  const span = (id: string): [number, number] | undefined => {
    const layer = layers.find((l) => l.id === id);
    if (!layer) return undefined;
    const x = parseFloat(String(layer.position.x));
    const w = parseFloat(String(layer.position.width ?? '0'));
    return [x, x + w];
  };
  return {
    pill: span('persistent-caption-bg')!,
    title: span('persistent-caption-title')!,
    subtitle: span('persistent-caption-subtitle'),
    thumb: span('persistent-caption-thumb'),
  };
}

type CaptionPosition = TitleCaptionConfig['position'];

describe('titleCaption geometry', () => {
  const POSITIONS: CaptionPosition[] = ['bottom-left', 'bottom-right', 'top-left', 'top-right'];

  // Regression: `bgXPos` mirrored to the right at 68% but `textX` had no
  // right-side branch — it stayed at the left-edge offset (4.5%). A
  // bottom-right/top-right caption drew the pill at 68–96% while the title
  // sat at 4.5–28.5%: text floating over the slide with no backing, and an
  // empty pill on the right.
  it('keeps title text inside the pill on both sides', () => {
    for (const position of POSITIONS) {
      const { pill, title } = captionSpans({ position });
      expect(title[0], `${position} title left edge vs pill`).toBeGreaterThanOrEqual(pill[0]);
      expect(title[1], `${position} title right edge vs pill`).toBeLessThanOrEqual(pill[1]);
    }
  });

  it('keeps title and subtitle inside the pill on both sides', () => {
    for (const position of POSITIONS) {
      const { pill, title, subtitle } = captionSpans({ position, subtitle: 'qual.la/slug' });
      expect(subtitle, `${position} subtitle exists`).toBeDefined();
      for (const [label, span] of [
        ['title', title],
        ['subtitle', subtitle!],
      ] as const) {
        expect(span[0], `${position} ${label} left edge vs pill`).toBeGreaterThanOrEqual(pill[0]);
        expect(span[1], `${position} ${label} right edge vs pill`).toBeLessThanOrEqual(pill[1]);
      }
    }
  });

  it('keeps the thumbnail inside the pill on both sides', () => {
    // Regression: the right-side thumbnail was pinned at x 93% width 6% → 99%,
    // overhanging the pill's right edge.
    for (const position of POSITIONS) {
      for (const subtitle of [undefined, 'qual.la/slug']) {
        const { pill, thumb } = captionSpans({
          position,
          subtitle,
          showThumbnail: true,
          thumbnailSrc: 'thumb.jpg',
        });
        expect(thumb, `${position} thumb exists`).toBeDefined();
        expect(thumb![0], `${position} thumb left edge vs pill`).toBeGreaterThanOrEqual(pill[0]);
        expect(thumb![1], `${position} thumb right edge vs pill`).toBeLessThanOrEqual(pill[1]);
      }
    }
  });

  it('never overlaps the thumbnail with the text, on either side', () => {
    for (const position of POSITIONS) {
      const { title, thumb } = captionSpans({
        position,
        subtitle: 'qual.la/slug',
        showThumbnail: true,
        thumbnailSrc: 'thumb.jpg',
      });
      const overlaps = title[0] < thumb![1] && thumb![0] < title[1];
      expect(overlaps, `${position} title overlaps thumbnail`).toBe(false);
    }
  });

  it('mirrors the pill around the same edge padding on both sides', () => {
    for (const showThumbnail of [false, true]) {
      const left = captionSpans({
        position: 'bottom-left',
        showThumbnail,
        thumbnailSrc: 'thumb.jpg',
      }).pill;
      const right = captionSpans({
        position: 'bottom-right',
        showThumbnail,
        thumbnailSrc: 'thumb.jpg',
      }).pill;
      // Same width, and the same 3% gap to their respective frame edges.
      expect(right[1] - right[0]).toBeCloseTo(left[1] - left[0]);
      expect(left[0]).toBeCloseTo(3);
      expect(100 - right[1]).toBeCloseTo(3);
      // Both sit fully inside the frame.
      expect(right[1]).toBeLessThanOrEqual(100);
    }
  });

  it('puts the thumbnail on the pill’s outer edge and the text away from it', () => {
    const left = captionSpans({
      position: 'bottom-left',
      showThumbnail: true,
      thumbnailSrc: 'thumb.jpg',
    });
    const right = captionSpans({
      position: 'bottom-right',
      showThumbnail: true,
      thumbnailSrc: 'thumb.jpg',
    });
    // Left caption: thumb hugs the left edge, text to its right.
    expect(left.thumb![0]).toBeLessThan(left.title[0]);
    // Right caption: thumb hugs the right edge, text to its left.
    expect(right.thumb![0]).toBeGreaterThan(right.title[1] - 0.001);
  });
});
