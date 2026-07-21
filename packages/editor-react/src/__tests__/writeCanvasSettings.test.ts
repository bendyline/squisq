import { describe, expect, it } from 'vitest';
import { writeCanvasSettingsStyle } from '../writeCanvasSettings';

describe('writeCanvasSettingsStyle', () => {
  it('maps serializable settings to Write canvas CSS variables', () => {
    expect(writeCanvasSettingsStyle({ textSize: 18, lineSpacing: 1.9 })).toEqual({
      '--squisq-write-text-size': '18px',
      '--squisq-write-line-spacing': '1.9',
    });
  });

  it('ignores invalid host values instead of emitting broken CSS', () => {
    expect(writeCanvasSettingsStyle({ textSize: 0, lineSpacing: Number.NaN })).toEqual({});
  });

  it('maps header and body font families to Write canvas CSS variables', () => {
    expect(
      writeCanvasSettingsStyle({
        headerFont: '"Playfair Display", Georgia, serif',
        bodyFont: '"PT Serif", Georgia, serif',
      }),
    ).toEqual({
      '--squisq-write-header-font': '"Playfair Display", Georgia, serif',
      '--squisq-write-body-font': '"PT Serif", Georgia, serif',
    });
  });

  it('trims font families and drops empty or unsafe values', () => {
    expect(writeCanvasSettingsStyle({ headerFont: '  Georgia, serif  ' })).toEqual({
      '--squisq-write-header-font': 'Georgia, serif',
    });
    expect(
      writeCanvasSettingsStyle({ headerFont: '   ', bodyFont: 'serif; color: red }' }),
    ).toEqual({});
  });
});
