import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { DARK_SURFACE, LIGHT_SURFACE, DEFAULT_THEME } from '@bendyline/squisq/schemas';
import { useJsonEditorTokens } from '../jsonEditor/useJsonEditorTokens';

type StyleBag = Record<string, string>;

/** Install a matchMedia stub whose `(prefers-color-scheme: dark)` resolves to `dark`. */
function mockPrefersDark(dark: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: dark && query.includes('dark'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }),
  });
}

describe('useJsonEditorTokens', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits jsonform-prefixed tokens', () => {
    mockPrefersDark(false);
    const { result } = renderHook(() => useJsonEditorTokens(DEFAULT_THEME, LIGHT_SURFACE));
    const style = result.current.style as StyleBag;
    expect(style['--squisq-jsonform-bg']).toBe(LIGHT_SURFACE.background);
    expect(style).toHaveProperty('--squisq-jsonform-warning');
    expect(style).toHaveProperty('--squisq-jsonform-input-bg');
  });

  it("responds to a dark OS preference under surface='auto' (reactive via useAutoSurface)", () => {
    mockPrefersDark(true);
    const { result } = renderHook(() => useJsonEditorTokens(DEFAULT_THEME, 'auto'));
    const style = result.current.style as StyleBag;
    expect(style['--squisq-jsonform-bg']).toBe(DARK_SURFACE.background);
    expect(style['--squisq-jsonform-text']).toBe(DARK_SURFACE.text);
    expect(result.current.theme.colors.background).toBe(DARK_SURFACE.background);
  });

  it("uses light surface under surface='auto' when the OS prefers light", () => {
    mockPrefersDark(false);
    const { result } = renderHook(() => useJsonEditorTokens(DEFAULT_THEME, 'auto'));
    const style = result.current.style as StyleBag;
    expect(style['--squisq-jsonform-bg']).toBe(LIGHT_SURFACE.background);
  });

  beforeEach(() => {
    // Default to a defined matchMedia so the hook's useAutoSurface can subscribe.
    mockPrefersDark(false);
  });
});
