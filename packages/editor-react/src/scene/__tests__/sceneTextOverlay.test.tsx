/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Layer } from '@bendyline/squisq/schemas';
import { SceneTextOverlay } from '../text/SceneTextOverlay';
import type { SceneTextEditConfig } from '../text/sceneTextConfig';
import { TOUCH_MIN_EDIT_FONT_PX, sceneTextFrame } from '../text/sceneTextFrame';

/**
 * Editing a diagram label at 40% zoom on a phone set the text at the card's
 * fallback 18px times the zoom: about 7px, in the wrong weight. The editor now
 * takes the label's typography from its host and, on a touch screen, never
 * sets text under 16px. Below that it magnifies into a larger copy of the card.
 */

const CARD: Layer = {
  id: 'node-card-word',
  type: 'shape',
  position: { x: 100, y: 100, width: 180, height: 64 },
  content: { shape: 'rect', fill: '#ffffff' },
};

const TEXTBOX: Layer = {
  id: 'note',
  type: 'text',
  position: { x: 0, y: 0, width: 200, height: 60 },
  content: { text: 'Note', style: { fontSize: 20, color: '#336699' } },
};

const ZOOM = 0.4;

function config(overrides: Partial<SceneTextEditConfig> = {}): SceneTextEditConfig {
  return {
    resolveEditableId: (id) => id,
    getHtml: () => '<p>Word</p>',
    commit: () => undefined,
    level: 'inline',
    textStyle: () => ({
      fontSize: 22,
      fontWeight: 'bold',
      textAlign: 'center',
      verticalAlign: 'middle',
    }),
    ...overrides,
  };
}

function pointer(coarse: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: coarse && query === '(pointer: coarse)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
}

function overlay(layer: Layer, editConfig = config()): HTMLElement {
  render(
    <SceneTextOverlay
      config={editConfig}
      layer={layer}
      editableId={layer.id}
      viewport={{ width: 1000, height: 1000 }}
      transform={{ tx: 0, ty: 0, scale: ZOOM }}
      viewportToScreen={(x, y) => ({ x: x * ZOOM, y: y * ZOOM })}
      container={{ width: 360, height: 400 }}
      onClose={() => undefined}
    />,
  );
  return document.querySelector<HTMLElement>('.squisq-scene-text-overlay')!;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('sceneTextFrame', () => {
  const base = {
    origin: { x: 40, y: 40 },
    size: { width: 180, height: 64 },
    fontSize: 22,
    container: { width: 360, height: 400 },
  };

  it('covers the layer exactly when its text is already large enough', () => {
    expect(sceneTextFrame({ ...base, zoom: 1, minFontPx: TOUCH_MIN_EDIT_FONT_PX })).toEqual({
      left: 40,
      top: 40,
      width: 180,
      height: 64,
      scale: 1,
    });
    // No floor (a mouse): the zoomed-out box, however small.
    expect(sceneTextFrame({ ...base, zoom: ZOOM, minFontPx: 0 })).toMatchObject({
      left: 40,
      width: 72,
      scale: ZOOM,
    });
  });

  it('magnifies about the layer center so its text meets the floor', () => {
    const frame = sceneTextFrame({ ...base, zoom: ZOOM, minFontPx: 16 });
    expect(frame.scale * 22).toBeCloseTo(16);
    expect(frame.width).toBeCloseTo((180 * 16) / 22);
    // Same center as the 72 x 25.6 card at (40, 40).
    expect(frame.left + frame.width / 2).toBeCloseTo(40 + 36);
    expect(frame.top + frame.height / 2).toBeCloseTo(40 + 12.8);
  });

  it('keeps a magnified editor inside the canvas', () => {
    const atCorner = sceneTextFrame({ ...base, origin: { x: 0, y: 0 }, zoom: ZOOM, minFontPx: 16 });
    expect(atCorner.left).toBe(0);
    expect(atCorner.top).toBe(0);

    const narrow = sceneTextFrame({
      ...base,
      zoom: 0.1,
      minFontPx: 16,
      container: { width: 100, height: 400 },
    });
    expect(narrow.width).toBe(100);
    expect(narrow.left).toBe(0);
  });
});

describe('SceneTextOverlay', () => {
  it('edits a card in its label’s typography, at a readable size on touch', () => {
    pointer(true);
    const el = overlay(CARD);
    expect(el.style.fontSize).toBe('16px');
    expect(el.style.fontWeight).toBe('bold');
    expect(el.style.textAlign).toBe('center');
    expect(el.style.justifyContent).toBe('center');
    expect(parseFloat(el.style.width)).toBeCloseTo((180 * 16) / 22);
    // A card's label color is drawn for a white card; the editor keeps its own.
    expect(el.style.color).toBe('var(--squisq-text)');
  });

  it('follows the zoom exactly with a mouse', () => {
    pointer(false);
    const el = overlay(CARD);
    expect(parseFloat(el.style.fontSize)).toBeCloseTo(22 * ZOOM);
    expect(el.style.left).toBe('40px');
    expect(el.style.width).toBe('72px');
  });

  it('edits a text layer in its own style and color', () => {
    pointer(false);
    const textStyle = vi.fn();
    const el = overlay(TEXTBOX, config({ textStyle }));
    expect(textStyle).not.toHaveBeenCalled();
    expect(parseFloat(el.style.fontSize)).toBeCloseTo(20 * ZOOM);
    expect(el.style.color).toBe('rgb(51, 102, 153)');
  });
});
