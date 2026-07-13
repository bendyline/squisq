/**
 * customThemeLibrary — localStorage-backed library of user-defined themes.
 * The theme analog of customTemplates' library test. Uses jsdom's localStorage.
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import {
  listLibraryThemes,
  saveLibraryTheme,
  deleteLibraryTheme,
  clearThemeLibrary,
  THEME_LIBRARY_STORAGE_KEY,
} from '../customThemeLibrary';
import { compileTheme } from '@bendyline/squisq/schemas';
import type { Theme } from '@bendyline/squisq/schemas';

function theme(id: string, name = id): Theme {
  return compileTheme({ id, name, seedColors: { primary: '#3182ce' } });
}

describe('customThemeLibrary', () => {
  beforeEach(() => clearThemeLibrary());

  it('save → list round-trips, sorted by name', () => {
    saveLibraryTheme(theme('b', 'Beta'));
    saveLibraryTheme(theme('a', 'Alpha'));
    expect(listLibraryThemes().map((t) => t.name)).toEqual(['Alpha', 'Beta']);
  });

  it('save replaces by id', () => {
    saveLibraryTheme(theme('a', 'Alpha'));
    saveLibraryTheme(theme('a', 'Alpha 2'));
    const list = listLibraryThemes();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Alpha 2');
  });

  it('delete removes by id', () => {
    saveLibraryTheme(theme('a'));
    saveLibraryTheme(theme('b'));
    deleteLibraryTheme('a');
    expect(listLibraryThemes().map((t) => t.id)).toEqual(['b']);
  });

  it('clear empties the library', () => {
    saveLibraryTheme(theme('a'));
    clearThemeLibrary();
    expect(listLibraryThemes()).toEqual([]);
  });

  it('filters invalid stored entries instead of crashing sort', () => {
    window.localStorage.setItem(
      THEME_LIBRARY_STORAGE_KEY,
      JSON.stringify({ version: 1, themes: [null, {}, theme('valid')] }),
    );
    expect(listLibraryThemes().map((entry) => entry.id)).toEqual(['valid']);
  });
});
