/**
 * The side toolbar's placement decision: it may float as a 180px column in the
 * canvas's right gutter only when nothing occupies that space. A pane docked
 * beside the editor surface (outline, inline block-preview rail) doesn't clip
 * the column — it paints over it — so it has to count as a boundary too.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneSideToolbar } from '../scene/SceneSideToolbar';

const originalResizeObserver = globalThis.ResizeObserver;

class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalResizeObserver) {
    globalThis.ResizeObserver = originalResizeObserver;
  } else {
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
  }
});

/** Right edges keyed by class, so each element in the fake editor can differ. */
function stubRights(rights: Array<[string, number]>): void {
  globalThis.ResizeObserver = ResizeObserverStub;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    for (const [cls, right] of rights) {
      if (this.classList.contains(cls)) return DOMRect.fromRect({ width: right });
    }
    return DOMRect.fromRect();
  });
}

function renderInEditor(withPreviewRail: boolean) {
  return render(
    <div className="squisq-editor-content">
      <div className="squisq-editor-with-gutter">
        <div className="squisq-wysiwyg-container">
          <div className="squisq-scene-shell">
            <SceneSideToolbar>
              <button type="button">Add box</button>
            </SceneSideToolbar>
          </div>
        </div>
        {withPreviewRail && <div className="squisq-inline-preview-gutter" />}
      </div>
    </div>,
  );
}

describe('SceneSideToolbar placement', () => {
  it('floats in the gutter when the editor surface has room to its right', () => {
    // Surface runs to the content edge; 300px of free gutter past the canvas.
    stubRights([
      ['squisq-editor-content', 1500],
      ['squisq-wysiwyg-container', 1500],
      ['squisq-scene-shell', 1200],
    ]);

    const { container } = renderInEditor(false);

    expect(container.querySelector('.squisq-scene-side-toolbar')).not.toBeNull();
    expect(container.querySelector('.squisq-scene-inline-toolbar')).toBeNull();
  });

  it('drops to the in-flow bar when the preview rail occupies the gutter', () => {
    // Same content width, but the surface now ends at the rail's left edge,
    // leaving only 20px past the canvas — the column would render underneath.
    stubRights([
      ['squisq-editor-content', 1500],
      ['squisq-wysiwyg-container', 1220],
      ['squisq-scene-shell', 1200],
    ]);

    const { container } = renderInEditor(true);

    expect(container.querySelector('.squisq-scene-inline-toolbar')).not.toBeNull();
    expect(container.querySelector('.squisq-scene-side-toolbar')).toBeNull();
  });

  it('ignores the surface edge when no pane follows it', () => {
    // A centered editor surface can end right at the canvas without anything
    // being docked there — that space is still free gutter.
    stubRights([
      ['squisq-editor-content', 1500],
      ['squisq-wysiwyg-container', 1200],
      ['squisq-scene-shell', 1200],
    ]);

    const { container } = renderInEditor(false);

    expect(container.querySelector('.squisq-scene-side-toolbar')).not.toBeNull();
  });
});
