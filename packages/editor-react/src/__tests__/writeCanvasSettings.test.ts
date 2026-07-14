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
});
