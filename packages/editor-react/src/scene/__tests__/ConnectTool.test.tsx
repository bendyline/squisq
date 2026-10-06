import { render } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ShapeLayer } from '@bendyline/squisq/schemas';
import { ConnectTool } from '../tools/ConnectTool';
import type { SceneToolContext } from '../tools/SceneTool';

function context(scale = 1): SceneToolContext {
  const layers: ShapeLayer[] = [
    {
      id: 'node-card-a',
      type: 'shape',
      position: { x: 100, y: 100, width: 100, height: 80 },
      content: { shape: 'rect' },
    },
    {
      id: 'node-card-b',
      type: 'shape',
      position: { x: 400, y: 100, width: 100, height: 80 },
      content: { shape: 'rect' },
    },
  ];
  const hitItems = layers.map((layer, index) => ({
    id: layer.id,
    layer,
    bounds: { x: 100 + index * 300, y: 100, width: 100, height: 80 },
  }));
  return {
    interaction: {},
    viewport: { width: 800, height: 600 },
    transform: { tx: 30, ty: 20, scale },
    layers,
    edges: [],
    selection: new Set(),
    hitItems,
    screenToViewport: (x, y) => ({ x: (x - 30) / scale, y: (y - 20) / scale }),
    viewportToScreen: (x, y) => ({ x: x * scale + 30, y: y * scale + 20 }),
    hit: ({ x, y }) =>
      [...hitItems]
        .reverse()
        .find(({ bounds: b }) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height)
        ?.id ?? null,
    setSelection: vi.fn(),
    dispatch: vi.fn(),
  };
}

// Points are in viewport units; exercise pan, zoom, and the SVG's screen offset.
function pointer(ctx: SceneToolContext, x: number, y: number): ReactPointerEvent {
  const screen = ctx.viewportToScreen(x, y);
  return {
    button: 0,
    clientX: screen.x + 50,
    clientY: screen.y + 70,
    pointerId: 1,
    currentTarget: {
      getBoundingClientRect: () => ({ left: 50, top: 70 }),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as ReactPointerEvent;
}

function expectConnection(ctx: SceneToolContext) {
  expect(ctx.dispatch).toHaveBeenCalledExactlyOnceWith({
    kind: 'addEdge',
    source: 'a',
    target: 'b',
  });
  expect(ctx.interaction.connect).toBeUndefined();
}

describe('diagram connection gestures', () => {
  it.each([0.25, 0.5, 1, 2, 4])('grabs and drops outside the port border at %s× zoom', (scale) => {
    const ctx = context(scale);
    const offset = 8 / scale;
    ConnectTool.onPointerDown!(pointer(ctx, 200 + offset, 140), ctx);
    expect(ctx.interaction.connect).toBeDefined();
    ConnectTool.onPointerMove!(pointer(ctx, 400 - offset, 140), ctx);
    const { container, unmount } = render(<svg>{ConnectTool.renderOverlay!(ctx)}</svg>);
    expect(container.querySelectorAll('.squisq-scene-connection-point--active')).toHaveLength(8);
    const dot = container.querySelector('.squisq-scene-connection-point');
    expect(Number(dot?.getAttribute('r')) * scale).toBe(4);
    unmount();
    ConnectTool.onPointerUp!(pointer(ctx, 400 - offset, 140), ctx);
    expectConnection(ctx);
  });

  it('accepts the outer quadrants of corner ports', () => {
    const ctx = context();
    ConnectTool.onPointerDown!(pointer(ctx, 205, 95), ctx);
    ConnectTool.onPointerUp!(pointer(ctx, 395, 95), ctx);
    expectConnection(ctx);
  });

  it('still accepts dragging between node interiors', () => {
    const ctx = context();
    ConnectTool.onPointerDown!(pointer(ctx, 150, 140), ctx);
    ConnectTool.onPointerMove!(pointer(ctx, 450, 140), ctx);
    ConnectTool.onPointerUp!(pointer(ctx, 450, 140), ctx);
    expectConnection(ctx);
  });

  it('uses the release position even without a final pointer move', () => {
    const ctx = context();
    ConnectTool.onPointerDown!(pointer(ctx, 200, 140), ctx);
    ConnectTool.onPointerMove!(pointer(ctx, 300, 140), ctx);
    ConnectTool.onPointerUp!(pointer(ctx, 395, 140), ctx);
    expectConnection(ctx);
  });

  it('does not commit a stale hovered target after releasing on empty canvas', () => {
    const ctx = context();
    ConnectTool.onPointerDown!(pointer(ctx, 200, 140), ctx);
    ConnectTool.onPointerMove!(pointer(ctx, 400, 140), ctx);
    ConnectTool.onPointerUp!(pointer(ctx, 300, 300), ctx);
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(ctx.interaction.connect).toBeUndefined();
  });

  it('ignores empty starts and self-connections', () => {
    const ctx = context();
    ConnectTool.onPointerDown!(pointer(ctx, 230, 140), ctx);
    ConnectTool.onPointerUp!(pointer(ctx, 400, 140), ctx);
    expect(ctx.dispatch).not.toHaveBeenCalled();
    ConnectTool.onPointerDown!(pointer(ctx, 205, 140), ctx);
    ConnectTool.onPointerUp!(pointer(ctx, 150, 95), ctx);
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(ctx.interaction.connect).toBeUndefined();
  });

  it('Escape cancels the gesture before mouse release', () => {
    const ctx = context();
    ConnectTool.onPointerDown!(pointer(ctx, 200, 140), ctx);
    ConnectTool.onPointerMove!(pointer(ctx, 400, 140), ctx);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    ConnectTool.onKeyDown!(escape, ctx);
    expect(escape.defaultPrevented).toBe(true);
    ConnectTool.onPointerUp!(pointer(ctx, 400, 140), ctx);
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(ctx.interaction.connect).toBeUndefined();
  });

  it('prefers a nearby child port to its enclosing container', () => {
    const ctx = context();
    const layer: ShapeLayer = {
      id: 'node-card-container',
      type: 'shape',
      position: { x: 50, y: 50, width: 500, height: 250 },
      content: { shape: 'rect' },
    };
    const hitItems = [
      { id: layer.id, layer, bounds: { x: 50, y: 50, width: 500, height: 250 } },
      ...ctx.hitItems,
    ];
    ctx.hitItems = hitItems;
    ctx.hit = () => 'node-card-container';
    ConnectTool.onPointerDown!(pointer(ctx, 205, 140), ctx);
    ConnectTool.onPointerUp!(pointer(ctx, 395, 140), ctx);
    expectConnection(ctx);
  });
});
