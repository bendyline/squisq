import { renderHook } from '@testing-library/react';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/doc';
import { afterEach, describe, expect, it } from 'vitest';
import { useViewportOrientation } from '../hooks/useViewportOrientation';

const originalWidth = window.innerWidth;
const originalHeight = window.innerHeight;

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
});

describe('useViewportOrientation', () => {
  it('uses the square preset for near-square viewports', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });
    const { result } = renderHook(() => useViewportOrientation());
    expect(result.current.orientation).toBe('square');
    expect(result.current.viewport).toBe(VIEWPORT_PRESETS.square);
  });
});
