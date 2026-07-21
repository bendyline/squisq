import { describe, it, expect } from 'vitest';
import { pipStyleVars } from '../schemas/pipStyle.js';
import { createTheme } from '../schemas/Theme.js';
import { DEFAULT_THEME } from '../schemas/themeLibrary.js';
import { withAlpha } from '../schemas/colorUtils.js';

describe('pipStyleVars', () => {
  describe('derived from the theme (no explicit pip block)', () => {
    it('derives a proportional corner radius from the card border-radius', () => {
      const theme = createTheme(DEFAULT_THEME, { style: { borderRadius: 12 } });
      expect(pipStyleVars(theme)['--squisq-pip-radius']).toBe('12%');
    });

    it('keeps square corners when the theme has no border-radius', () => {
      const theme = createTheme(DEFAULT_THEME, { style: { borderRadius: 0 } });
      expect(pipStyleVars(theme)['--squisq-pip-radius']).toBe('0');
    });

    it('caps the derived radius short of a circle', () => {
      const theme = createTheme(DEFAULT_THEME, { style: { borderRadius: 999 } });
      expect(pipStyleVars(theme)['--squisq-pip-radius']).toBe('28%');
    });

    it('derives a subtle rim from the theme text color', () => {
      const theme = createTheme(DEFAULT_THEME, { colors: { text: '#123456' } });
      const border = pipStyleVars(theme)['--squisq-pip-border'];
      expect(border).toContain('solid');
      expect(border).toContain(withAlpha('#123456', 0.35));
    });

    it('applies a soft themed shadow by default', () => {
      expect(pipStyleVars(DEFAULT_THEME)['--squisq-pip-shadow']).toContain('rgba(0, 0, 0');
    });
  });

  describe('explicit theme.style.pip overrides', () => {
    it('accepts a numeric corner radius in px', () => {
      const theme = createTheme(DEFAULT_THEME, { style: { pip: { cornerRadius: 20 } } });
      expect(pipStyleVars(theme)['--squisq-pip-radius']).toBe('20px');
    });

    it('accepts a string corner radius verbatim', () => {
      const theme = createTheme(DEFAULT_THEME, { style: { pip: { cornerRadius: '50%' } } });
      expect(pipStyleVars(theme)['--squisq-pip-radius']).toBe('50%');
    });

    it('removes the border when set to none', () => {
      const theme = createTheme(DEFAULT_THEME, { style: { pip: { border: 'none' } } });
      expect(pipStyleVars(theme)['--squisq-pip-border']).toBe('none');
    });

    it('honors an explicit border width + color', () => {
      const theme = createTheme(DEFAULT_THEME, {
        style: { pip: { border: { width: 3, color: '#ff0000' } } },
      });
      expect(pipStyleVars(theme)['--squisq-pip-border']).toBe('3px solid #ff0000');
    });

    it('removes the shadow when disabled', () => {
      const theme = createTheme(DEFAULT_THEME, { style: { pip: { shadow: false } } });
      expect(pipStyleVars(theme)['--squisq-pip-shadow']).toBe('none');
    });

    it('honors an explicit shadow string', () => {
      const theme = createTheme(DEFAULT_THEME, {
        style: { pip: { shadow: '0 2px 4px black' } },
      });
      expect(pipStyleVars(theme)['--squisq-pip-shadow']).toBe('0 2px 4px black');
    });
  });
});
