import { describe, expect, it } from 'vitest';
import { platformShortcut } from '../platformShortcuts';

describe('platformShortcut', () => {
  it('uses the Command glyph on Apple platforms', () => {
    expect(platformShortcut('2', 'MacIntel')).toBe('⌘2');
    expect(platformShortcut('3', 'iPhone')).toBe('⌘3');
  });

  it('uses Ctrl on Windows and Linux', () => {
    expect(platformShortcut('1', 'Win32')).toBe('Ctrl+1');
    expect(platformShortcut('2', 'Linux x86_64')).toBe('Ctrl+2');
  });
});
