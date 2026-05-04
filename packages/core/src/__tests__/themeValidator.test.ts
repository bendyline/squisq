import { describe, it, expect } from 'vitest';
import { validateTheme, assertTheme } from '../schemas/themeValidator.js';
import { THEMES, DEFAULT_THEME } from '../schemas/themeLibrary.js';
import type { Theme } from '../schemas/Theme.js';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

describe('validateTheme', () => {
  it('accepts every built-in theme', () => {
    for (const [id, theme] of Object.entries(THEMES)) {
      const result = validateTheme(theme);
      if (!result.valid) {
        throw new Error(
          `Built-in theme "${id}" failed validation:\n${result.errors
            .map((e) => `  ${e.path}: ${e.message}`)
            .join('\n')}`,
        );
      }
      expect(result.valid).toBe(true);
    }
  });

  it('rejects non-objects', () => {
    expect(validateTheme(null).valid).toBe(false);
    expect(validateTheme('a string').valid).toBe(false);
    expect(validateTheme(42).valid).toBe(false);
  });

  it('flags missing required fields', () => {
    const result = validateTheme({ schemaVersion: '1', id: 'x', name: 'X' });
    expect(result.valid).toBe(false);
    const paths = result.errors.map((e) => e.path);
    expect(paths).toContain('colors');
    expect(paths).toContain('typography');
    expect(paths).toContain('renderStyle');
    expect(paths).toContain('colorSchemes');
  });

  it('flags raw font strings (legacy shape)', () => {
    const bad = clone(DEFAULT_THEME) as unknown as Record<string, unknown>;
    (bad.typography as Record<string, unknown>).bodyFont = 'Inter, sans-serif';
    const result = validateTheme(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'typography.bodyFont')).toBe(true);
  });

  it('flags raw CSS gradient strings in persistentLayers', () => {
    const bad = clone(DEFAULT_THEME) as Theme;
    bad.persistentLayers = {
      bottomLayers: [
        // intentionally invalid: raw `gradient` string is not allowed
        {
          template: 'gradientBackground',
          config: {
            type: 'gradientBackground',
            gradient: 'linear-gradient(...)' as never,
          },
        },
      ],
    };
    const result = validateTheme(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.path.endsWith('config.gradient') && /raw CSS/i.test(e.message)),
    ).toBe(true);
  });

  it('flags malformed hex colors', () => {
    const bad = clone(DEFAULT_THEME);
    bad.colors.primary = 'rgb(0,0,0)';
    const result = validateTheme(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'colors.primary')).toBe(true);
  });

  it('flags wrong schemaVersion', () => {
    const bad = clone(DEFAULT_THEME) as unknown as Record<string, unknown>;
    bad.schemaVersion = '2';
    const result = validateTheme(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'schemaVersion')).toBe(true);
  });

  it('accepts FontFamily { custom } shape', () => {
    const t = clone(DEFAULT_THEME);
    t.typography.bodyFont = { custom: { name: 'Georgia', fallback: 'serif' } };
    expect(validateTheme(t).valid).toBe(true);
  });

  it('rejects FontFamily.custom with bad fallback', () => {
    const bad = clone(DEFAULT_THEME) as unknown as Record<string, unknown>;
    (bad.typography as Record<string, unknown>).bodyFont = {
      custom: { name: 'Georgia', fallback: 'invalid' },
    };
    const result = validateTheme(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'typography.bodyFont.custom.fallback')).toBe(true);
  });

  it('accepts theme with seedColors', () => {
    const t = clone(DEFAULT_THEME);
    t.seedColors = { primary: '#3182ce', accent: '#63b3ed' };
    expect(validateTheme(t).valid).toBe(true);
  });

  it('rejects seedColors without primary', () => {
    const bad = clone(DEFAULT_THEME);
    bad.seedColors = { accent: '#63b3ed' } as never;
    const result = validateTheme(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'seedColors.primary')).toBe(true);
  });
});

describe('assertTheme', () => {
  it('returns the theme unchanged when valid', () => {
    expect(assertTheme(DEFAULT_THEME)).toBe(DEFAULT_THEME);
  });

  it('throws with a readable error summary on invalid input', () => {
    expect(() => assertTheme({}, 'test theme')).toThrow(/Invalid test theme/);
  });
});
