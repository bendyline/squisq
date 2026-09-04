/** @vitest-environment jsdom */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SceneToolContext } from '../tools/SceneTool';
import { SelectTool, beginHandleDrag, getActiveMoveOffset } from '../tools/SelectTool';
import { ConnectTool } from '../tools/ConnectTool';
import { createSceneTextChannel } from '../text/sceneTextChannel';
import { SceneViewport } from '../SceneViewport';
import { DiagramEdges } from '../layers/DiagramEdges';

function context(id = 'layer'): SceneToolContext {
  const layer = {
    id,
    type: 'shape' as const,
    position: { x: 0, y: 0, width: 20, height: 20 },
    content: { shape: 'rect' as const },
  };
  return {
    interaction: {},
    viewport: { width: 100, height: 100 },
    transform: { tx: 0, ty: 0, scale: 1 },
    layers: [layer],
    edges: [],
    selection: new Set(),
    hitItems: [{ id, layer, bounds: { x: 0, y: 0, width: 20, height: 20 } }],
    screenToViewport: (x, y) => ({ x, y }),
    viewportToScreen: (x, y) => ({ x, y }),
    hit: () => id,
    setSelection: vi.fn(),
    dispatch: vi.fn(),
  };
}

function pointer(clientX: number, clientY: number) {
  return {
    button: 0,
    clientX,
    clientY,
    pointerId: 1,
    shiftKey: false,
    currentTarget: {
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    },
    stopPropagation: vi.fn(),
  } as unknown as React.PointerEvent;
}

describe('Scene instance isolation', () => {
  it('keeps select and connect gestures in the owning Scene context', () => {
    const first = context('node-card-a');
    const second = context('node-card-a');
    SelectTool.onPointerDown!(pointer(0, 0), first);
    SelectTool.onPointerMove!(pointer(10, 0), first);
    expect(getActiveMoveOffset(first.interaction)).toEqual({ dx: 10, dy: 0 });
    expect(getActiveMoveOffset(second.interaction)).toBeNull();

    ConnectTool.onPointerDown!(pointer(5, 5), first);
    expect(first.interaction.connect).toBeTruthy();
    expect(second.interaction.connect).toBeUndefined();
  });

  it('commits a resize as one command containing origin and size', () => {
    const ctx = context('node-card-a');
    beginHandleDrag(
      {
        layerId: 'node-card-a',
        corner: 'nw',
        startV: { x: 10, y: 20 },
        startBounds: { x: 10, y: 20, width: 100, height: 50 },
      },
      ctx.interaction,
    );

    SelectTool.onPointerMove!(pointer(0, 0), ctx);
    SelectTool.onPointerUp!(pointer(0, 0), ctx);

    expect(ctx.dispatch).toHaveBeenCalledTimes(1);
    expect(ctx.dispatch).toHaveBeenCalledWith({
      kind: 'resizeLayer',
      id: 'node-card-a',
      x: 0,
      y: 0,
      width: 110,
      height: 70,
    });
  });

  it('creates independent text-toolbar channels', () => {
    const first = createSceneTextChannel();
    const second = createSceneTextChannel();
    const listener = vi.fn();
    second.subscribe(listener);
    first.set({ editor: {} as never, level: 'inline' });
    expect(listener).not.toHaveBeenCalled();
    expect(second.get()).toBeNull();
  });

  /**
   * The dot grid is drawn in SCREEN space, so a fixed world step would pack
   * the dots closer and closer as the user zooms out — the grid gets heavier
   * exactly when the diagram gets smaller. Weight is ink per unit area, so
   * that is what this pins.
   */
  it('holds the dot grid at a constant visual weight across the zoom range', () => {
    const inkRatio = (scale: number): number => {
      const { container } = render(
        <SceneViewport width={200} height={200} transform={{ tx: 0, ty: 0, scale }}>
          <g />
        </SceneViewport>,
      );
      const pattern = container.querySelector('pattern') as SVGPatternElement;
      const dot = container.querySelector('.squisq-scene-dot') as SVGCircleElement;
      const step = Number(pattern.getAttribute('width'));
      const r = Number(dot.getAttribute('r'));
      expect(step).toBeGreaterThanOrEqual(18); // never a sub-pixel wash
      return (Math.PI * r * r) / (step * step);
    };
    const baseline = inkRatio(1);
    for (const scale of [0.02, 0.25, 0.5, 2]) {
      expect(inkRatio(scale)).toBeLessThanOrEqual(baseline * 1.05);
    }
    // Zoomed out — the case that motivated this — is not heavier than 100%.
    expect(inkRatio(0.25)).toBeCloseTo(baseline, 6);
  });

  it('namespaces grid and edge marker definitions per canvas', () => {
    const edge = { id: 'e', source: 'a', target: 'b', endMarker: 'arrow' as const };
    const nodes = [
      { id: 'a', x: 0, y: 0, width: 10, height: 10, cx: 5, cy: 5 },
      { id: 'b', x: 30, y: 0, width: 10, height: 10, cx: 35, cy: 5 },
    ];
    const { container } = render(
      <>
        <SceneViewport width={100} height={100} transform={{ tx: 0, ty: 0, scale: 1 }}>
          <DiagramEdges nodes={nodes} edges={[edge]} />
        </SceneViewport>
        <SceneViewport width={100} height={100} transform={{ tx: 0, ty: 0, scale: 1 }}>
          <DiagramEdges nodes={nodes} edges={[edge]} />
        </SceneViewport>
      </>,
    );
    const ids = Array.from(container.querySelectorAll('[id]')).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
