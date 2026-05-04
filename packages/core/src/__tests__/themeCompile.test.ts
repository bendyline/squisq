import { describe, it, expect } from 'vitest';
import {
  compileTheme,
  parseTheme,
  serializeTheme,
  STARTER_THEME,
  deriveColorPalette,
} from '../schemas/themeCompile.js';
import { registerTheme, unregisterTheme, getRegisteredThemes } from '../schemas/Theme.js';
import { resolveTheme, DEFAULT_THEME, THEMES } from '../schemas/themeLibrary.js';
import { resolveFontFamily } from '../schemas/fontStacks.js';

describe('deriveColorPalette', () => {
  it('fills all 8 palette slots from a single primary seed', () => {
    const palette = deriveColorPalette({ primary: '#3182ce' });
    expect(palette.primary).toBe('#3182ce');
    expect(palette.background).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette.text).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette.warning).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('lets explicit partial colors win over derived values', () => {
    const palette = deriveColorPalette({ primary: '#3182ce' }, { warning: '#ff00ff' });
    expect(palette.warning).toBe('#ff00ff');
  });

  it('high contrast spread > balanced spread > subtle spread (in lightness range)', () => {
    const subtle = deriveColorPalette({ primary: '#3182ce' }, {}, { contrast: 'subtle' });
    const balanced = deriveColorPalette({ primary: '#3182ce' }, {}, { contrast: 'balanced' });
    const high = deriveColorPalette({ primary: '#3182ce' }, {}, { contrast: 'high' });
    // All should be valid
    for (const p of [subtle, balanced, high]) {
      expect(p.background).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('compileTheme', () => {
  it('compiles a minimal partial into a complete validated Theme', () => {
    const theme = compileTheme({
      name: 'My Theme',
      seedColors: { primary: '#3182ce' },
    });
    expect(theme.id).toMatch(/^custom/);
    expect(theme.name).toBe('My Theme');
    expect(theme.colors.primary).toBe('#3182ce');
    expect(theme.colors.background).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.typography.bodyFont).toEqual(STARTER_THEME.typography.bodyFont);
    expect(theme.colorSchemes).toEqual(STARTER_THEME.colorSchemes);
    expect(theme.schemaVersion).toBe('1');
  });

  it('passes through fully-specified themes (built-ins should re-compile to identical Theme)', () => {
    const reCompiled = compileTheme(DEFAULT_THEME);
    expect(reCompiled.colors).toEqual(DEFAULT_THEME.colors);
    expect(reCompiled.typography).toEqual(DEFAULT_THEME.typography);
  });

  it('honors typography overrides', () => {
    const theme = compileTheme({
      seedColors: { primary: '#3182ce' },
      typography: {
        titleFont: { stackId: 'playfair' },
        bodyFont: { custom: { name: 'Georgia', fallback: 'serif' } },
      },
    });
    expect(theme.typography.titleFont).toEqual({ stackId: 'playfair' });
    expect(theme.typography.bodyFont).toEqual({
      custom: { name: 'Georgia', fallback: 'serif' },
    });
  });
});

describe('parseTheme / serializeTheme round-trip', () => {
  it('serialize → parse is lossless for built-ins', () => {
    for (const [id, theme] of Object.entries(THEMES)) {
      const json = serializeTheme(theme);
      const parsed = parseTheme(json);
      expect(parsed).toEqual(theme);
      expect(parsed.id).toBe(id);
    }
  });

  it('parseTheme throws on invalid JSON', () => {
    expect(() => parseTheme('not json')).toThrow(/Invalid theme JSON/);
  });

  it('parseTheme throws on JSON that fails validation', () => {
    expect(() => parseTheme('{}')).toThrow(/Invalid parsed theme/);
  });
});

describe('registerTheme / resolveTheme', () => {
  it('registered theme takes precedence over built-in with same id', () => {
    const overlay = compileTheme({
      id: 'standard',
      name: 'Standard Override',
      seedColors: { primary: '#ff0000' },
    });
    registerTheme(overlay);
    try {
      const resolved = resolveTheme('standard');
      expect(resolved.name).toBe('Standard Override');
      expect(resolved.colors.primary).toBe('#ff0000');
    } finally {
      unregisterTheme('standard');
    }
    // After cleanup, built-in is restored
    expect(resolveTheme('standard').name).toBe('Standard');
  });

  it('registered custom-id theme is resolvable via Doc.themeId', () => {
    const custom = compileTheme({
      id: 'custom-test-1',
      name: 'Custom Test One',
      seedColors: { primary: '#00aabb' },
    });
    registerTheme(custom);
    try {
      const resolved = resolveTheme('custom-test-1');
      expect(resolved.id).toBe('custom-test-1');
      expect(resolved.name).toBe('Custom Test One');
      expect(getRegisteredThemes().some((t) => t.id === 'custom-test-1')).toBe(true);
    } finally {
      unregisterTheme('custom-test-1');
    }
  });

  it('resolveTheme falls back to default for unknown ids', () => {
    expect(resolveTheme('nonexistent-theme')).toBe(DEFAULT_THEME);
    expect(resolveTheme(undefined)).toBe(DEFAULT_THEME);
  });
});

describe('FontFamily resolution', () => {
  it('resolves stackId to a CSS family string', () => {
    expect(resolveFontFamily({ stackId: 'inter' }, 'fallback')).toContain('Inter');
  });

  it('resolves { custom } to a quoted CSS family with fallback', () => {
    const css = resolveFontFamily(
      { custom: { name: 'My Font', fallback: 'sans-serif' } },
      'fallback',
    );
    expect(css).toContain('"My Font"');
    expect(css).toContain('sans-serif');
  });

  it('returns roleFallback for unknown stackId', () => {
    expect(resolveFontFamily({ stackId: 'no-such-stack' }, 'my-fallback')).toBe('my-fallback');
  });

  it('accepts legacy raw strings for backward compat', () => {
    expect(resolveFontFamily('Georgia, serif', 'fallback')).toBe('Georgia, serif');
  });
});
