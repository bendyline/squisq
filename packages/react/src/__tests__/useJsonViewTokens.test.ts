import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { DARK_SURFACE, LIGHT_SURFACE, DEFAULT_THEME } from '@bendyline/squisq/schemas';
import { useJsonViewTokens } from '../jsonView/useJsonViewTokens';

type StyleBag = Record<string, string>;

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

describe('useJsonViewTokens', () => {
  afterEach(() => vi.restoreAllMocks());

  it('emits json-prefixed tokens for a static surface', () => {
    const { result } = renderHook(() => useJsonViewTokens(DEFAULT_THEME, LIGHT_SURFACE));
    const style = result.current.style as StyleBag;
    expect(style['--squisq-json-bg']).toBe(LIGHT_SURFACE.background);
    expect(style['--squisq-json-text']).toBe(LIGHT_SURFACE.text);
  });

  it("tracks a dark OS preference under surface='auto'", () => {
    mockPrefersDark(true);
    const { result } = renderHook(() => useJsonViewTokens(DEFAULT_THEME, 'auto'));
    const style = result.current.style as StyleBag;
    expect(style['--squisq-json-bg']).toBe(DARK_SURFACE.background);
    expect(result.current.theme.colors.background).toBe(DARK_SURFACE.background);
  });
});
