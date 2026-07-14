/**
 * useScenePanZoom — verify pan, zoom-at, fit, and screen↔viewport
 * coordinate conversions. The hook is pure state + math, so tests use
 * @testing-library/react's `renderHook` and don't need DOM events.
 */

import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useScenePanZoom, IDENTITY_TRANSFORM } from '../hooks/useScenePanZoom';

describe('useScenePanZoom', () => {
  it('starts at identity by default', () => {
    const { result } = renderHook(() => useScenePanZoom());
    expect(result.current.transform).toEqual(IDENTITY_TRANSFORM);
  });

  it('panBy adds to translation', () => {
    const { result } = renderHook(() => useScenePanZoom());
    act(() => result.current.panBy(50, 30));
    expect(result.current.transform.tx).toBe(50);
    expect(result.current.transform.ty).toBe(30);
    act(() => result.current.panBy(-20, 0));
    expect(result.current.transform.tx).toBe(30);
    expect(result.current.transform.ty).toBe(30);
  });

  it('zoomAt keeps the focus point stationary in viewport space', () => {
    const { result } = renderHook(() => useScenePanZoom());
    // Pre-zoom: identity. The screen point (200, 100) maps to viewport (200, 100).
    const before = result.current.screenToViewport(200, 100);
    expect(before).toEqual({ x: 200, y: 100 });

    act(() => result.current.zoomAt(2, 200, 100));
    expect(result.current.transform.scale).toBe(2);
    // After zooming to scale=2 around screen-point (200, 100), the viewport
    // point under that screen pixel must still be (200, 100).
    const after = result.current.screenToViewport(200, 100);
    expect(after.x).toBeCloseTo(200, 5);
    expect(after.y).toBeCloseTo(100, 5);
  });

  it('clamps scale to the allowed range', () => {
    const { result } = renderHook(() => useScenePanZoom());
    act(() => result.current.zoomAt(100, 0, 0));
    expect(result.current.transform.scale).toBeLessThanOrEqual(8);
    act(() => result.current.zoomAt(0.0001, 0, 0));
    expect(result.current.transform.scale).toBeGreaterThanOrEqual(0.02);
  });

  it('reset returns to identity', () => {
    const { result } = renderHook(() => useScenePanZoom());
    act(() => {
      result.current.panBy(100, 100);
      result.current.zoomAt(1.5, 50, 50);
    });
    expect(result.current.transform).not.toEqual(IDENTITY_TRANSFORM);
    act(() => result.current.reset());
    expect(result.current.transform).toEqual(IDENTITY_TRANSFORM);
  });

  it('fitBox centers and scales the box inside the container with padding', () => {
    const { result } = renderHook(() => useScenePanZoom());
    // 100x100 box, 200x200 container, 0 padding → scale=2, centered at (0,0).
    act(() =>
      result.current.fitBox(
        { x: 0, y: 0, width: 100, height: 100 },
        { width: 200, height: 200 },
        0,
      ),
    );
    expect(result.current.transform.scale).toBe(2);
    // Box origin (0,0) viewport → (0,0) screen (since the box is sized 200,
    // matching the container after scaling); centered → tx=ty=0.
    expect(result.current.transform.tx).toBe(0);
    expect(result.current.transform.ty).toBe(0);
  });

  it('fitBox honors padding by leaving room around the content', () => {
    const { result } = renderHook(() => useScenePanZoom());
    act(() =>
      result.current.fitBox(
        { x: 0, y: 0, width: 100, height: 100 },
        { width: 200, height: 200 },
        20,
      ),
    );
    // Available area after padding: 160x160 → scale 1.6.
    expect(result.current.transform.scale).toBeCloseTo(1.6, 5);
  });

  it('fitBox can cap fit at 100% without enlarging small content', () => {
    const { result } = renderHook(() => useScenePanZoom());
    act(() =>
      result.current.fitBox(
        { x: 25, y: 50, width: 100, height: 80 },
        { width: 800, height: 600 },
        20,
        1,
      ),
    );
    expect(result.current.transform.scale).toBe(1);
    expect(result.current.viewportToScreen(75, 90)).toEqual({ x: 400, y: 300 });
  });

  it('fitBox may shrink below the manual zoom floor to keep all content visible', () => {
    const { result } = renderHook(() => useScenePanZoom());
    act(() =>
      result.current.fitBox(
        { x: 0, y: 0, width: 10_000, height: 10_000 },
        { width: 400, height: 300 },
        20,
        1,
      ),
    );
    expect(result.current.transform.scale).toBeCloseTo(0.026, 5);
  });

  it('screenToViewport and viewportToScreen are inverses', () => {
    const { result } = renderHook(() => useScenePanZoom());
    act(() => {
      result.current.panBy(30, -45);
      result.current.zoomAt(1.7, 100, 100);
    });
    const screenPoint = { x: 250, y: 75 };
    const v = result.current.screenToViewport(screenPoint.x, screenPoint.y);
    const back = result.current.viewportToScreen(v.x, v.y);
    expect(back.x).toBeCloseTo(screenPoint.x, 5);
    expect(back.y).toBeCloseTo(screenPoint.y, 5);
  });
});
