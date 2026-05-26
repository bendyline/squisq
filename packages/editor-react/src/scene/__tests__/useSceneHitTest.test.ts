/**
 * useSceneHitTest + layerBounds — coordinate resolution and topmost-wins
 * hit testing. Pure logic; no DOM needed.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSceneHitTest, layerBounds, type HitTestable } from '../hooks/useSceneHitTest';
import type { ShapeLayer } from '@bendyline/squisq/schemas';

const viewport = { width: 1000, height: 800 };

function rectLayer(id: string, x: number, y: number, w: number, h: number): ShapeLayer {
  return {
    id,
    type: 'shape',
    position: { x, y, width: w, height: h },
    content: { shape: 'rect' },
  };
}

describe('layerBounds', () => {
  it('resolves numeric pixel positions', () => {
    const b = layerBounds(rectLayer('a', 10, 20, 100, 50), viewport);
    expect(b).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('resolves percentage strings against the viewport', () => {
    const l: ShapeLayer = {
      id: 'p',
      type: 'shape',
      position: { x: '10%', y: '25%', width: '50%', height: '20%' },
      content: { shape: 'rect' },
    };
    const b = layerBounds(l, viewport);
    expect(b).toEqual({ x: 100, y: 200, width: 500, height: 160 });
  });

  it('applies center anchor by shifting the origin to the bounding-box top-left', () => {
    const l: ShapeLayer = {
      id: 'c',
      type: 'shape',
      position: { x: 500, y: 400, width: 200, height: 100, anchor: 'center' },
      content: { shape: 'rect' },
    };
    const b = layerBounds(l, viewport);
    expect(b).toEqual({ x: 400, y: 350, width: 200, height: 100 });
  });

  it('returns null when width or height cannot be resolved', () => {
    const l: ShapeLayer = {
      id: 'n',
      type: 'shape',
      position: { x: 0, y: 0 },
      content: { shape: 'rect' },
    };
    expect(layerBounds(l, viewport)).toBeNull();
  });
});

describe('useSceneHitTest', () => {
  function items(...layers: ShapeLayer[]): HitTestable[] {
    return layers.map((l) => ({
      id: l.id,
      layer: l,
      bounds: layerBounds(l, viewport)!,
    }));
  }

  it('returns the topmost layer at a point (last-wins)', () => {
    const { result } = renderHook(() => useSceneHitTest());
    const list = items(rectLayer('a', 0, 0, 100, 100), rectLayer('b', 50, 50, 100, 100));
    // Point (60, 60) is inside both — `b` is later in the array, so wins.
    expect(result.current.hit({ x: 60, y: 60 }, list)).toBe('b');
  });

  it('returns null when the point is outside every layer', () => {
    const { result } = renderHook(() => useSceneHitTest());
    const list = items(rectLayer('a', 0, 0, 50, 50));
    expect(result.current.hit({ x: 500, y: 500 }, list)).toBeNull();
  });

  it('treats the bounding-box edge as inside (>= and <=)', () => {
    const { result } = renderHook(() => useSceneHitTest());
    const list = items(rectLayer('a', 10, 10, 100, 100));
    expect(result.current.hit({ x: 10, y: 10 }, list)).toBe('a');
    expect(result.current.hit({ x: 110, y: 110 }, list)).toBe('a');
    expect(result.current.hit({ x: 9.9, y: 10 }, list)).toBeNull();
  });
});
