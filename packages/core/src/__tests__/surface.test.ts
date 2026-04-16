import { describe, it, expect } from 'vitest';
import {
  applySurface,
  DARK_SURFACE,
  DEFAULT_THEME,
  LIGHT_SURFACE,
  type SurfaceScheme,
} from '../schemas/index.js';

describe('SurfaceScheme', () => {
  it('LIGHT_SURFACE and DARK_SURFACE expose the full field set', () => {
    for (const s of [LIGHT_SURFACE, DARK_SURFACE]) {
      expect(typeof s.id).toBe('string');
      expect(typeof s.background).toBe('string');
      expect(typeof s.backgroundLight).toBe('string');
      expect(typeof s.text).toBe('string');
      expect(typeof s.textMuted).toBe('string');
    }
  });
});

describe('applySurface', () => {
  it('overlays surface fields onto a theme', () => {
    const out = applySurface(DEFAULT_THEME, LIGHT_SURFACE);
    expect(out.colors.background).toBe(LIGHT_SURFACE.background);
    expect(out.colors.backgroundLight).toBe(LIGHT_SURFACE.backgroundLight);
    expect(out.colors.text).toBe(LIGHT_SURFACE.text);
    expect(out.colors.textMuted).toBe(LIGHT_SURFACE.textMuted);
  });

  it('leaves editorial colors (primary, highlight, warning) untouched', () => {
    const out = applySurface(DEFAULT_THEME, DARK_SURFACE);
    expect(out.colors.primary).toBe(DEFAULT_THEME.colors.primary);
    expect(out.colors.secondary).toBe(DEFAULT_THEME.colors.secondary);
    expect(out.colors.highlight).toBe(DEFAULT_THEME.colors.highlight);
    expect(out.colors.warning).toBe(DEFAULT_THEME.colors.warning);
  });

  it('leaves typography, style, renderStyle, colorSchemes untouched', () => {
    const out = applySurface(DEFAULT_THEME, LIGHT_SURFACE);
    expect(out.typography).toBe(DEFAULT_THEME.typography);
    expect(out.style).toBe(DEFAULT_THEME.style);
    expect(out.renderStyle).toBe(DEFAULT_THEME.renderStyle);
    expect(out.colorSchemes).toBe(DEFAULT_THEME.colorSchemes);
  });

  it('returns a new theme (does not mutate the base)', () => {
    const frozenTheme = DEFAULT_THEME;
    const originalBg = frozenTheme.colors.background;
    const out = applySurface(frozenTheme, DARK_SURFACE);
    expect(out).not.toBe(frozenTheme);
    expect(out.colors).not.toBe(frozenTheme.colors);
    expect(frozenTheme.colors.background).toBe(originalBg);
  });

  it('accepts custom SurfaceScheme objects', () => {
    const custom: SurfaceScheme = {
      id: 'parchment',
      background: '#f4ecd8',
      backgroundLight: '#e8dfc4',
      text: '#2b2b2b',
      textMuted: '#6b6b6b',
    };
    const out = applySurface(DEFAULT_THEME, custom);
    expect(out.colors.background).toBe('#f4ecd8');
    expect(out.colors.textMuted).toBe('#6b6b6b');
  });
});
