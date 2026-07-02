/**
 * CustomThemeContext — dual-catalog (doc + library) behavior, mirroring the
 * custom-templates context: merged `allThemes`, doc/library upserts, and
 * `applyTheme` copying a library theme into the doc for self-sufficiency.
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { CustomThemeProvider, useCustomThemes } from '../CustomThemeContext';
import { clearThemeLibrary, saveLibraryTheme } from '../customThemeLibrary';
import { compileTheme } from '@bendyline/squisq/schemas';
import type { Theme } from '@bendyline/squisq/schemas';

const t = (id: string, name = id): Theme =>
  compileTheme({ id, name, seedColors: { primary: '#3182ce' } });

function makeWrapper(docThemes: Theme[], onDocThemesChange = vi.fn()) {
  return ({ children }: { children: ReactNode }) => (
    <CustomThemeProvider docThemes={docThemes} onDocThemesChange={onDocThemesChange}>
      {children}
    </CustomThemeProvider>
  );
}

describe('CustomThemeContext', () => {
  beforeEach(() => clearThemeLibrary());

  it('allThemes merges doc + library, doc wins on id clash', () => {
    saveLibraryTheme(t('lib', 'Library'));
    saveLibraryTheme(t('shared', 'Library Shared'));
    const { result } = renderHook(() => useCustomThemes(), {
      wrapper: makeWrapper([t('shared', 'Doc Shared')]),
    });
    expect(result.current!.allThemes.map((x) => x.id).sort()).toEqual(['lib', 'shared']);
    expect(result.current!.allThemes.find((x) => x.id === 'shared')!.name).toBe('Doc Shared');
  });

  it('upsertDocTheme calls onDocThemesChange with the appended list', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useCustomThemes(), { wrapper: makeWrapper([], onChange) });
    act(() => result.current!.upsertDocTheme(t('a')));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'a' })]);
  });

  it('applyTheme copies a library theme into the doc', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useCustomThemes(), { wrapper: makeWrapper([], onChange) });
    act(() => result.current!.applyTheme(t('lib')));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'lib' })]);
  });

  it('applyTheme is a no-op when the theme is already in the doc', () => {
    const onChange = vi.fn();
    const inDoc = t('a');
    const { result } = renderHook(() => useCustomThemes(), {
      wrapper: makeWrapper([inDoc], onChange),
    });
    act(() => result.current!.applyTheme(inDoc));
    expect(onChange).not.toHaveBeenCalled();
  });
});
