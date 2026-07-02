import { describe, it, expect } from 'vitest';
import { expandPersistentLayer } from '../doc/templates/persistentLayers.js';
import { cssFilterForTreatment } from '../doc/utils/imageTreatment.js';
import { themedImageTreatment } from '../doc/utils/themeUtils.js';
import { createTemplateContext } from '../schemas/BlockTemplates.js';
import { DEFAULT_THEME, resolveTheme } from '../schemas/themeLibrary.js';
import { validateTheme } from '../schemas/themeValidator.js';
import { THEMES } from '../schemas/themeLibrary.js';
import type { ShapeLayer, ImageLayer } from '../schemas/Doc.js';

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
