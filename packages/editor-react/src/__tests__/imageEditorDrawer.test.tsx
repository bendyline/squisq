import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SidePanelDrawer } from '../imageEditor/SidePanelDrawer';

const BODY_WIDTH = 320;
const PANEL_WIDTH = 264;

afterEach(() => {
  vi.restoreAllMocks();
});

function rect(width: number, height = 600): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    toJSON: () => ({}),
  };
}

function renderDrawer({ bodyWidth = BODY_WIDTH }: { bodyWidth?: number } = {}) {
  render(
    <div
      className="squisq-image-editor-body"
      data-testid="body"
      ref={(node) => {
        if (!node) return;
        node.getBoundingClientRect = () => rect(bodyWidth);
        node.setPointerCapture = vi.fn();
        node.releasePointerCapture = vi.fn();
        node.hasPointerCapture = () => true;
      }}
    >
      <div className="squisq-image-editor-center">
        <svg data-testid="canvas" />
      </div>
      <SidePanelDrawer>
        <label>
          Name <input data-testid="name-field" defaultValue="Background" />
        </label>
      </SidePanelDrawer>
    </div>,
  );
  const drawer = screen.getByTestId('image-editor-drawer');
  const panel = drawer.querySelector<HTMLElement>('.squisq-image-editor-side');
  const edge = drawer.querySelector<HTMLElement>('.squisq-image-editor-drawer-edge');
  const scrim = drawer.querySelector<HTMLElement>('.squisq-image-editor-drawer-scrim');
  if (!panel || !edge || !scrim) throw new Error('drawer parts missing');
  panel.getBoundingClientRect = () => rect(PANEL_WIDTH);
  return {
    drawer,
    panel,
    edge,
    scrim,
    body: screen.getByTestId('body'),
    tab: screen.getByRole('button', { name: /layers and properties/i }),
  };
}

let now = 0;

/** jsdom has no PointerEvent; a MouseEvent carrying the pointer fields stands in. */
function pointer(
  type: string,
  target: Element,
  x: number,
  y: number,
  { elapsed = 16, pointerType = 'touch' }: { elapsed?: number; pointerType?: string } = {},
): void {
  now += elapsed;
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperties(event, {
    pointerType: { value: pointerType },
    pointerId: { value: 1 },
    isPrimary: { value: true },
    timeStamp: { value: now },
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

/** A slow drag, so distance rather than a flick decides the release. */
function drag(target: Element, points: ReadonlyArray<readonly [number, number]>): void {
  const [first, ...rest] = points;
  pointer('pointerdown', target, first[0], first[1]);
  for (const [x, y] of rest) pointer('pointermove', target, x, y, { elapsed: 400 });
}

function clickAt(target: Element): void {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'timeStamp', { value: now + 20 });
  act(() => {
    target.dispatchEvent(event);
  });
}

describe('SidePanelDrawer', () => {
  it('starts closed with its tab showing and its content hidden', () => {
    const { drawer, tab } = renderDrawer();
    expect(drawer.dataset.state).toBe('closed');
    expect(tab.getAttribute('aria-expanded')).toBe('false');
    expect(tab.getAttribute('aria-label')).toBe('Show layers and properties');
    expect(document.getElementById(tab.getAttribute('aria-controls')!)).toBeTruthy();
  });

  it('opens and closes from a tap on the tab', () => {
    const { drawer, tab } = renderDrawer();

    fireEvent.click(tab);
    expect(drawer.dataset.state).toBe('open');
    expect(tab.getAttribute('aria-expanded')).toBe('true');
    expect(tab.getAttribute('aria-label')).toBe('Hide layers and properties');

    fireEvent.click(tab);
    expect(drawer.dataset.state).toBe('closed');
  });

  it('follows a swipe in from the edge strip and opens', () => {
    const { drawer, edge, body } = renderDrawer();

    drag(edge, [
      [310, 200],
      [295, 200],
      [150, 205],
    ]);
    expect(drawer.dataset.state).toBe('dragging');
    expect(
      Number(drawer.style.getPropertyValue('--squisq-image-editor-drawer-progress')),
    ).toBeCloseTo(160 / PANEL_WIDTH);
    expect(drawer.style.getPropertyValue('--squisq-image-editor-drawer-duration')).toBe('0ms');
    expect(body.setPointerCapture).toHaveBeenCalledWith(1);

    pointer('pointerup', edge, 150, 205, { elapsed: 400 });
    expect(drawer.dataset.state).toBe('open');
    expect(drawer.style.getPropertyValue('--squisq-image-editor-drawer-progress')).toBe('');
  });

  it('opens from a drag on the tab, and swallows the click that follows it', () => {
    const { drawer, tab } = renderDrawer();

    drag(tab, [
      [300, 300],
      [285, 300],
      [120, 300],
    ]);
    pointer('pointerup', tab, 120, 300, { elapsed: 400 });
    expect(drawer.dataset.state).toBe('open');

    // Without the guard this click would toggle the drawer straight back.
    clickAt(tab);
    expect(drawer.dataset.state).toBe('open');
  });

  it('springs back closed after a short, slow swipe', () => {
    const { drawer, edge } = renderDrawer();

    drag(edge, [
      [310, 200],
      [295, 200],
      [270, 200],
    ]);
    pointer('pointerup', edge, 270, 200, { elapsed: 400 });
    expect(drawer.dataset.state).toBe('closed');
  });

  it('closes when the open panel is swiped back to the right', () => {
    const { drawer, tab } = renderDrawer();
    fireEvent.click(tab);
    const field = screen.getByTestId('name-field');

    drag(field, [
      [120, 300],
      [135, 302],
      [280, 305],
    ]);
    expect(
      Number(drawer.style.getPropertyValue('--squisq-image-editor-drawer-progress')),
    ).toBeCloseTo(1 - 160 / PANEL_WIDTH);
    pointer('pointerup', field, 280, 305, { elapsed: 400 });
    expect(drawer.dataset.state).toBe('closed');
  });

  it('leaves a vertical scroll in the open panel alone', () => {
    const { drawer, tab, body } = renderDrawer();
    fireEvent.click(tab);
    const field = screen.getByTestId('name-field');

    drag(field, [
      [120, 300],
      [124, 340],
      [200, 450],
    ]);
    pointer('pointerup', field, 200, 450);
    expect(body.setPointerCapture).not.toHaveBeenCalled();
    expect(drawer.dataset.state).toBe('open');
  });

  it.each([
    ['that starts on the canvas', 'canvas', 'touch', BODY_WIDTH],
    ['in a wide editor', 'edge', 'touch', 900],
    ['from a mouse', 'edge', 'mouse', BODY_WIDTH],
  ])('ignores a sideways drag %s', (_name, startOn, pointerType, bodyWidth) => {
    const { drawer, edge, body } = renderDrawer({ bodyWidth });
    const target = startOn === 'canvas' ? screen.getByTestId('canvas') : edge;
    const startX = bodyWidth - 8;

    pointer('pointerdown', target, startX, 200, { pointerType });
    pointer('pointermove', target, startX - 20, 200, { pointerType });
    pointer('pointermove', target, startX - 200, 200, { pointerType });
    pointer('pointerup', target, startX - 200, 200, { pointerType });
    expect(body.setPointerCapture).not.toHaveBeenCalled();
    expect(drawer.dataset.state).toBe('closed');
  });

  it('closes on a tap on the scrim', () => {
    const { drawer, tab, scrim } = renderDrawer();
    fireEvent.click(tab);
    fireEvent.click(scrim);
    expect(drawer.dataset.state).toBe('closed');
  });

  it('closes on Escape from inside the panel without reaching the window', () => {
    const { drawer, tab } = renderDrawer();
    const windowKeydown = vi.fn();
    window.addEventListener('keydown', windowKeydown);
    try {
      fireEvent.click(tab);
      const field = screen.getByTestId('name-field');
      field.focus();

      fireEvent.keyDown(field, { key: 'Escape' });
      expect(drawer.dataset.state).toBe('closed');
      expect(windowKeydown).not.toHaveBeenCalled();
      // The field is about to hide; focus waits on the tab instead.
      expect(document.activeElement).toBe(tab);
    } finally {
      window.removeEventListener('keydown', windowKeydown);
    }
  });

  it('lets Escape through when the panel is a plain column', () => {
    const { tab } = renderDrawer({ bodyWidth: 900 });
    const windowKeydown = vi.fn();
    window.addEventListener('keydown', windowKeydown);
    try {
      fireEvent.click(tab);
      fireEvent.keyDown(screen.getByTestId('name-field'), { key: 'Escape' });
      expect(windowKeydown).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', windowKeydown);
    }
  });

  it('cancels the touch moves of a drag it follows, and only those', () => {
    const { edge } = renderDrawer();
    const touchMove = (): boolean => {
      const event = new Event('touchmove', { bubbles: true, cancelable: true });
      act(() => {
        edge.dispatchEvent(event);
      });
      return event.defaultPrevented;
    };

    pointer('pointerdown', edge, 310, 200);
    expect(touchMove()).toBe(false);
    pointer('pointermove', edge, 290, 200);
    expect(touchMove()).toBe(true);
    pointer('pointerup', edge, 290, 200);
    expect(touchMove()).toBe(false);
  });
});
