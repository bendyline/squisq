import { describe, expect, it } from 'vitest';
import { THEMES, contrastRatio } from '@bendyline/squisq/schemas';
import { paperPalette } from '../shared/paperPalette';

describe('paperPalette', () => {
  it('turns a dark theme over onto white paper, its background becoming the ink', () => {
    const palette = paperPalette(
      { background: '#1F1A17', text: '#F3EDE0', primary: '#B0724C' },
      { paintPage: true },
    );
    expect(palette.turned).toBe(true);
    expect(palette.page).toBeUndefined();
    expect(palette.text).toBe('#1F1A17');
    // The accent is 4.0:1 on white, short of legible; the ink stands in.
    expect(palette.heading).toBe('#1F1A17');
  });

  it('keeps a light theme’s page tint and inks', () => {
    const palette = paperPalette(
      { background: '#FBF7EF', text: '#2B2A26', primary: '#7A3E12' },
      { paintPage: true },
    );
    expect(palette.turned).toBe(false);
    expect(palette.page).toBe('#FBF7EF');
    expect(palette.text).toBe('#2B2A26');
    expect(palette.heading).toBe('#7A3E12');
  });

  it('never paints a page where the format cannot (PDF)', () => {
    expect(paperPalette({ background: '#FBF7EF', text: '#2B2A26' }).page).toBeUndefined();
  });

  it('gives every built-in theme legible inks on its paper page', () => {
    for (const [id, theme] of Object.entries(THEMES)) {
      const palette = paperPalette(theme.colors, { paintPage: true });
      const page = palette.page ?? '#FFFFFF';
      for (const ink of [palette.text, palette.heading, palette.muted, palette.link]) {
        if (ink)
          expect(contrastRatio(ink, page), `${id} ${ink} on ${page}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('ignores malformed colours instead of passing them on', () => {
    const palette = paperPalette({ background: 'oklch(20% 0 0)', text: '"/><x', primary: '#fff' });
    expect(palette.text).toBeUndefined();
    expect(palette.heading).toBeUndefined();
  });
});
