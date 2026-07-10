import { describe, it, expect } from 'vitest';
import { matchFontFamily, guessFontFallback } from '../schemas/fontStacks.js';
import { accentToColorScheme } from '../schemas/themeCompile.js';
import { deriveScale, isHex } from '../schemas/colorUtils.js';

describe('matchFontFamily', () => {
  it('matches curated stacks by label', () => {
    expect(matchFontFamily('Playfair Display')).toEqual({ stackId: 'playfair' });
    expect(matchFontFamily('JetBrains Mono')).toEqual({ stackId: 'jetbrains-mono' });
    expect(matchFontFamily('IBM Plex Sans')).toEqual({ stackId: 'ibm-plex-sans' });
    expect(matchFontFamily('Inter')).toEqual({ stackId: 'inter' });
  });

  it('matches case-insensitively and ignores surrounding quotes/whitespace', () => {
    expect(matchFontFamily('  playfair display  ')).toEqual({ stackId: 'playfair' });
    expect(matchFontFamily('"Merriweather"')).toEqual({ stackId: 'merriweather' });
    expect(matchFontFamily("'LORA'")).toEqual({ stackId: 'lora' });
  });

  it('matches explicit aliases and Google family names', () => {
    expect(matchFontFamily('Playfair')).toEqual({ stackId: 'playfair' });
    expect(matchFontFamily('Source Serif Pro')).toEqual({ stackId: 'source-serif' });
    expect(matchFontFamily('Source Serif 4')).toEqual({ stackId: 'source-serif' });
    expect(matchFontFamily('Crimson Pro')).toEqual({ stackId: 'crimson' });
    expect(matchFontFamily('Cormorant')).toEqual({ stackId: 'cormorant' });
  });

  it('maps web-safe faces onto the system stacks that already anchor them', () => {
    expect(matchFontFamily('Georgia')).toEqual({ stackId: 'system-serif' });
    expect(matchFontFamily('Times New Roman')).toEqual({ stackId: 'system-serif' });
    expect(matchFontFamily('Consolas')).toEqual({ stackId: 'system-mono' });
    expect(matchFontFamily('Courier New')).toEqual({ stackId: 'system-mono' });
    expect(matchFontFamily('Segoe UI')).toEqual({ stackId: 'system-sans' });
  });

  it('preserves unknown faces as custom fonts with a heuristic fallback', () => {
    expect(matchFontFamily('Calibri')).toEqual({
      custom: { name: 'Calibri', fallback: 'sans-serif' },
    });
    expect(matchFontFamily('Calibri Light')).toEqual({
      custom: { name: 'Calibri Light', fallback: 'sans-serif' },
    });
    expect(matchFontFamily('Cambria')).toEqual({
      custom: { name: 'Cambria', fallback: 'serif' },
    });
    expect(matchFontFamily('Aptos')).toEqual({
      custom: { name: 'Aptos', fallback: 'sans-serif' },
    });
  });

  it('keeps original casing but strips quotes on custom names', () => {
    expect(matchFontFamily('"Neue Haas Grotesk"')).toEqual({
      custom: { name: 'Neue Haas Grotesk', fallback: 'sans-serif' },
    });
  });

  it('resolves empty/blank names to system-sans', () => {
    expect(matchFontFamily('')).toEqual({ stackId: 'system-sans' });
    expect(matchFontFamily('   ')).toEqual({ stackId: 'system-sans' });
  });
});

describe('guessFontFallback', () => {
  it('detects monospace faces', () => {
    expect(guessFontFallback('Cascadia Code')).toBe('monospace');
    expect(guessFontFallback('Roboto Mono')).toBe('monospace');
    expect(guessFontFallback('Courier Prime')).toBe('monospace');
  });

  it('detects serif faces by keyword and by known serif names', () => {
    expect(guessFontFallback('Adobe Caslon Pro')).toBe('serif');
    expect(guessFontFallback('Bodoni Moda')).toBe('serif');
    expect(guessFontFallback('Palatino Linotype')).toBe('serif');
    expect(guessFontFallback('Awesome Serif')).toBe('serif');
  });

  it('does not treat sans-serif names as serif', () => {
    expect(guessFontFallback('PT Sans Serif Whatever')).toBe('sans-serif');
    expect(guessFontFallback('Open Sans')).toBe('sans-serif');
  });

  it('defaults to sans-serif and never guesses system-ui', () => {
    expect(guessFontFallback('Neue Haas Grotesk')).toBe('sans-serif');
    expect(guessFontFallback('Futura')).toBe('sans-serif');
  });
});

describe('accentToColorScheme', () => {
  it('derives the same scheme the editor previously derived inline', () => {
    // Parity with the original editor-react schemeFromAccent implementation.
    const accent = '#63b3ed';
    const scale = deriveScale(accent, 0.3);
    expect(accentToColorScheme(accent)).toEqual({
      bg: scale.darker2,
      text: scale.lighter2,
      accent: scale.base,
    });
  });

  it('returns valid hex colors for every slot', () => {
    const scheme = accentToColorScheme('#c05621');
    expect(isHex(scheme.bg)).toBe(true);
    expect(isHex(scheme.text)).toBe(true);
    expect(isHex(scheme.accent)).toBe(true);
  });

  it('falls back to a neutral scheme on invalid input', () => {
    expect(accentToColorScheme('not-a-color')).toEqual({
      bg: '#1a202c',
      text: '#e2e8f0',
      accent: '#63b3ed',
    });
  });
});
