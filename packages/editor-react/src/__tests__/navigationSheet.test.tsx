import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { EditorProvider } from '../EditorContext';
import { NavigationSheet } from '../NavigationSheet';
import type { NavigationSheetPanel } from '../useNavigationSheetSwipe';

const MARKDOWN = '# Alpha\n\nAlpha body.\n\n## Beta\n\nBeta body.\n';
const SURFACE_WIDTH = 320;
const PANEL_WIDTH = 256;

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

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

function Harness({
  initial = null,
  surfaceWidth = SURFACE_WIDTH,
}: {
  initial?: NavigationSheetPanel | null;
  surfaceWidth?: number;
}) {
  const [panel, setPanel] = useState<NavigationSheetPanel | null>(initial);
  return (
    <EditorProvider initialMarkdown={MARKDOWN} initialView="wysiwyg" articleId="test">
      <div
        className="squisq-editor-with-gutter"
        data-testid="surface"
        ref={(node) => {
          if (!node) return;
          node.getBoundingClientRect = () => rect(surfaceWidth);
          node.setPointerCapture = vi.fn();
          node.releasePointerCapture = vi.fn();
          node.hasPointerCapture = () => true;
        }}
      >
        <div className="squisq-wysiwyg-container" data-testid="editor">
          <div className="squisq-wysiwyg-editor">
            <h1>Alpha</h1>
            <p>Alpha body.</p>
            <h2>Beta</h2>
            <p>Beta body.</p>
          </div>
        </div>
        <NavigationSheet
          panel={panel}
          onPanelChange={setPanel}
          readOnly={false}
          basePath="/"
          mediaProvider={null}
        />
      </div>
      <output data-testid="panel">{String(panel)}</output>
    </EditorProvider>
  );
}

function renderSheet(props: { initial?: NavigationSheetPanel | null; surfaceWidth?: number } = {}) {
  render(<Harness {...props} />);
  const sheet = screen.getByTestId('navigation-sheet');
  const panel = sheet.querySelector<HTMLElement>('.squisq-navigation-sheet-panel');
  if (!panel) throw new Error('sheet panel missing');
  panel.getBoundingClientRect = () => rect(PANEL_WIDTH);
  return { sheet, panel, surface: screen.getByTestId('surface') };
}

let now = 0;

/** jsdom has no PointerEvent; a MouseEvent carrying the pointer fields stands in. */
function touch(type: string, target: Element, x: number, y: number, elapsed = 16): void {
  now += elapsed;
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  Object.defineProperties(event, {
    pointerType: { value: 'touch' },
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
  touch('pointerdown', target, first[0], first[1]);
  for (const [x, y] of rest) touch('pointermove', target, x, y, 400);
}

describe('NavigationSheet', () => {
  it('follows a swipe in from the right edge and opens the outline', () => {
    const { sheet, surface } = renderSheet();
    const editor = screen.getByTestId('editor');

    drag(editor, [
      [315, 200],
      [300, 200],
      [150, 205],
    ]);
    expect(sheet.dataset.state).toBe('dragging');
    expect(Number(sheet.style.getPropertyValue('--squisq-navigation-sheet-progress'))).toBeCloseTo(
      165 / PANEL_WIDTH,
    );
    expect(sheet.style.getPropertyValue('--squisq-navigation-sheet-duration')).toBe('0ms');
    expect(surface.setPointerCapture).toHaveBeenCalledWith(1);

    touch('pointerup', editor, 150, 205, 400);
    expect(screen.getByTestId('panel').textContent).toBe('outline');
    expect(sheet.dataset.state).toBe('open');
    expect(sheet.style.getPropertyValue('--squisq-navigation-sheet-progress')).toBe('');
    expect(screen.getByRole('tab', { name: 'Outline' }).getAttribute('aria-selected')).toBe('true');
  });

  it('opens block previews when the swipe turns downward', async () => {
    const { sheet } = renderSheet();
    const editor = screen.getByTestId('editor');

    drag(editor, [
      [315, 100],
      [300, 102],
      [290, 170],
    ]);
    expect(screen.getByRole('tab', { name: 'Previews' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    // The sheet finishes opening by itself instead of following the finger.
    expect(sheet.style.getPropertyValue('--squisq-navigation-sheet-progress')).toBe('1');

    touch('pointerup', editor, 290, 170);
    expect(screen.getByTestId('panel').textContent).toBe('previews');
    expect(await screen.findByRole('list', { name: 'Block previews' })).toBeTruthy();
  });

  it('springs back closed after a short, slow swipe', () => {
    const { sheet } = renderSheet();
    const editor = screen.getByTestId('editor');

    drag(editor, [
      [315, 200],
      [300, 200],
      [280, 200],
    ]);
    touch('pointerup', editor, 280, 200, 400);
    expect(screen.getByTestId('panel').textContent).toBe('null');
    expect(sheet.dataset.state).toBe('closed');
  });

  it('opens on a quick flick that travels only a little', () => {
    renderSheet();
    const editor = screen.getByTestId('editor');

    touch('pointerdown', editor, 315, 200);
    touch('pointermove', editor, 300, 200);
    touch('pointermove', editor, 270, 200);
    touch('pointerup', editor, 270, 200, 10);
    expect(screen.getByTestId('panel').textContent).toBe('outline');
  });

  it.each([
    ['away from the edge', 200, 'touch', SURFACE_WIDTH],
    ['in a wide editor', 895, 'touch', 900],
    ['from a mouse', 315, 'mouse', SURFACE_WIDTH],
  ])('ignores a sideways drag %s', (_name, startX, pointerType, surfaceWidth) => {
    const { sheet } = renderSheet({ surfaceWidth });
    const editor = screen.getByTestId('editor');
    const dispatch = (type: string, x: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 200 });
      Object.defineProperties(event, {
        pointerType: { value: pointerType },
        pointerId: { value: 1 },
        isPrimary: { value: true },
      });
      act(() => {
        editor.dispatchEvent(event);
      });
    };
    dispatch('pointerdown', startX);
    dispatch('pointermove', startX - 20);
    dispatch('pointermove', startX - 150);
    dispatch('pointerup', startX - 150);
    expect(sheet.dataset.state).toBe('closed');
    expect(screen.getByTestId('panel').textContent).toBe('null');
  });

  it('leaves a vertical scroll that starts at the edge alone', () => {
    const { sheet } = renderSheet();
    const editor = screen.getByTestId('editor');

    drag(editor, [
      [315, 200],
      [312, 260],
      [200, 300],
    ]);
    touch('pointerup', editor, 200, 300);
    expect(sheet.dataset.state).toBe('closed');
  });

  it('cancels the touch moves of a drag it follows, and only those', () => {
    renderSheet();
    const editor = screen.getByTestId('editor');
    const touchMove = (): boolean => {
      const event = new Event('touchmove', { bubbles: true, cancelable: true });
      act(() => {
        editor.dispatchEvent(event);
      });
      return event.defaultPrevented;
    };

    drag(editor, [
      [315, 200],
      [312, 260],
    ]);
    expect(touchMove()).toBe(false);
    touch('pointerup', editor, 312, 260);

    // Left to the browser, a quick swipe leaves a fling running behind pan-y,
    // and on Android, ChromeOS and Linux the next tap only stops it.
    touch('pointerdown', editor, 315, 200);
    expect(touchMove()).toBe(false);
    touch('pointermove', editor, 290, 200);
    expect(touchMove()).toBe(true);
    touch('pointerup', editor, 150, 200);
    expect(touchMove()).toBe(false);
  });

  it('swipes an open sheet back closed', () => {
    const { panel } = renderSheet({ initial: 'outline' });

    drag(panel, [
      [100, 200],
      [115, 200],
      [260, 200],
    ]);
    touch('pointerup', panel, 260, 200, 400);
    expect(screen.getByTestId('panel').textContent).toBe('null');
  });

  it('closes after choosing an outline row and leaves the editor unfocused', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderSheet({ initial: 'outline' });

    fireEvent.click(await screen.findByRole('button', { name: /Beta/ }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(screen.getByRole('heading', { name: 'Beta' }));
    expect(screen.getByTestId('panel').textContent).toBe('null');
    expect(document.activeElement?.closest('.squisq-wysiwyg-container')).toBeNull();
  });

  it('closes after choosing a block preview', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderSheet({ initial: 'previews' });

    const list = await screen.findByRole('list', { name: 'Block previews' });
    const cards = list.querySelectorAll('button');
    expect(cards.length).toBe(2);
    fireEvent.click(cards[1]);
    expect(scrollIntoView.mock.instances[0]).toBe(screen.getByRole('heading', { name: 'Beta' }));
    expect(screen.getByTestId('panel').textContent).toBe('null');
  });

  it('switches panels from its tabs', () => {
    renderSheet({ initial: 'outline' });
    fireEvent.click(screen.getByRole('tab', { name: 'Previews' }));
    expect(screen.getByTestId('panel').textContent).toBe('previews');
  });

  it.each([
    ['the scrim', (sheet: HTMLElement) => sheet.querySelector('.squisq-navigation-sheet-scrim')],
    ['its Close button', () => screen.getByRole('button', { name: 'Close' })],
  ])('closes from %s', (_name, find) => {
    const { sheet } = renderSheet({ initial: 'outline' });
    const target = find(sheet);
    if (!target) throw new Error('target missing');
    fireEvent.click(target);
    expect(screen.getByTestId('panel').textContent).toBe('null');
  });

  it('closes on Escape and keeps a host edge gesture off its scrim', () => {
    const { sheet } = renderSheet({ initial: 'outline' });
    const hostDown = vi.fn();
    document.body.addEventListener('pointerdown', hostDown);
    const scrim = sheet.querySelector('.squisq-navigation-sheet-scrim');
    if (!scrim) throw new Error('scrim missing');
    touch('pointerdown', scrim, 10, 200);
    document.body.removeEventListener('pointerdown', hostDown);
    expect(hostDown).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('panel').textContent).toBe('null');
  });

  it('takes the editor out of reach while open and moves focus into the sheet', async () => {
    const { panel } = renderSheet({ initial: 'outline' });
    const editor = screen.getByTestId('editor');
    expect(editor.inert).toBe(true);
    expect(document.activeElement).toBe(panel);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(editor.inert).toBe(false));
  });

  it('keeps its content while sliding away, then lets it go', () => {
    vi.useFakeTimers();
    try {
      const { panel } = renderSheet({ initial: 'outline' });
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(panel.querySelector('.squisq-outline')).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(panel.querySelector('.squisq-outline')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
