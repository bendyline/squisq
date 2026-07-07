import { describe, it, expect } from 'vitest';
import { buildJsonFormTokens, resolveJsonFormTheme } from '../jsonForm/index.js';
import { DARK_SURFACE, LIGHT_SURFACE, DEFAULT_THEME, applySurface } from '../schemas/index.js';

const EXPECTED_SUFFIXES = [
  'bg',
  'text',
  'muted',
  'primary',
  'accent',
  'warning',
  'border',
  'input-bg',
  'title-font',
  'body-font',
  'mono-font',
  'radius',
];

describe('buildJsonFormTokens', () => {
  it('emits the full token set for the viewer prefix', () => {
    const tokens = buildJsonFormTokens(DEFAULT_THEME, LIGHT_SURFACE, { prefix: '--squisq-json' });
    for (const suffix of EXPECTED_SUFFIXES) {
      expect(tokens).toHaveProperty(`--squisq-json-${suffix}`);
    }
    expect(Object.keys(tokens)).toHaveLength(EXPECTED_SUFFIXES.length);
  });

  it('emits the full token set for the editor prefix', () => {
    const tokens = buildJsonFormTokens(DEFAULT_THEME, LIGHT_SURFACE, {
      prefix: '--squisq-jsonform',
    });
    for (const suffix of EXPECTED_SUFFIXES) {
      expect(tokens).toHaveProperty(`--squisq-jsonform-${suffix}`);
    }
    expect(Object.keys(tokens)).toHaveLength(EXPECTED_SUFFIXES.length);
  });

  it('resolves colors from the applied surface (light vs dark differ)', () => {
    const light = buildJsonFormTokens(DEFAULT_THEME, LIGHT_SURFACE, { prefix: '--squisq-json' });
    const dark = buildJsonFormTokens(DEFAULT_THEME, DARK_SURFACE, { prefix: '--squisq-json' });
    const lightTheme = applySurface(DEFAULT_THEME, LIGHT_SURFACE);
    const darkTheme = applySurface(DEFAULT_THEME, DARK_SURFACE);
    expect(light['--squisq-json-bg']).toBe(lightTheme.colors.background);
    expect(dark['--squisq-json-bg']).toBe(darkTheme.colors.background);
    // The two surfaces should not produce an identical background.
    expect(light['--squisq-json-bg']).not.toBe(dark['--squisq-json-bg']);
  });

  it('falls back to DEFAULT_THEME when theme is undefined', () => {
    const tokens = buildJsonFormTokens(undefined, undefined, { prefix: '--squisq-json' });
    expect(tokens['--squisq-json-bg']).toBe(DEFAULT_THEME.colors.background);
  });

  it('does not apply surface when surface is undefined', () => {
    const tokens = buildJsonFormTokens(DEFAULT_THEME, undefined, { prefix: '--squisq-json' });
    expect(tokens['--squisq-json-bg']).toBe(DEFAULT_THEME.colors.background);
    expect(tokens['--squisq-json-radius']).toBe(`${DEFAULT_THEME.style.borderRadius ?? 8}px`);
  });

  it('is pure — no window/matchMedia access required', () => {
    // Runs fine even if window is momentarily undefined-like; the function
    // never touches globals.
    expect(() =>
      buildJsonFormTokens(DEFAULT_THEME, DARK_SURFACE, { prefix: '--squisq-json' }),
    ).not.toThrow();
  });
});

describe('resolveJsonFormTheme', () => {
  it('applies the surface to the theme', () => {
    expect(resolveJsonFormTheme(DEFAULT_THEME, DARK_SURFACE)).toEqual(
      applySurface(DEFAULT_THEME, DARK_SURFACE),
    );
  });

  it('returns the base theme untouched when surface is undefined', () => {
    expect(resolveJsonFormTheme(DEFAULT_THEME, undefined)).toBe(DEFAULT_THEME);
  });

  it('falls back to DEFAULT_THEME when theme is undefined', () => {
    expect(resolveJsonFormTheme(undefined, undefined)).toBe(DEFAULT_THEME);
  });
});
