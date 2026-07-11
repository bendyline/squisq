/** @vitest-environment jsdom */
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SceneToolContext } from '../tools/SceneTool';
import { SelectTool, getActiveMoveOffset } from '../tools/SelectTool';
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

  it('creates independent text-toolbar channels', () => {
    const first = createSceneTextChannel();
    const second = createSceneTextChannel();
    const listener = vi.fn();
    second.subscribe(listener);
    first.set({ editor: {} as never, level: 'inline' });
    expect(listener).not.toHaveBeenCalled();
    expect(second.get()).toBeNull();
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
