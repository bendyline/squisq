import { describe, expect, it, vi } from 'vitest';
import {
  applyAsMonacoLayoutSettles,
  readMonacoScrollRatio,
  readWysiwygScrollRatio,
  restoreMonacoScrollRatio,
  restoreWysiwygScrollRatio,
  scrollRatio,
  scrollTopForRatio,
} from '../editorScrollSync';

function scrollElement(scrollTop: number, scrollHeight: number, clientHeight: number): HTMLElement {
  const container = document.createElement('div');
  container.className = 'squisq-wysiwyg-container';
  Object.defineProperties(container, {
    scrollTop: { value: scrollTop, writable: true },
    scrollHeight: { value: scrollHeight },
    clientHeight: { value: clientHeight },
  });
  return container;
}

describe('editor scroll synchronization', () => {
  it('converts pixel offsets to a normalized position and back', () => {
    expect(scrollRatio(450, 1000, 100)).toBe(0.5);
    expect(scrollTopForRatio(0.5, 2100, 100)).toBe(1000);
  });

  it('clamps positions and handles documents that do not scroll', () => {
    expect(scrollRatio(-20, 1000, 100)).toBe(0);
    expect(scrollRatio(1200, 1000, 100)).toBe(1);
    expect(scrollRatio(20, 100, 100)).toBe(0);
    expect(scrollTopForRatio(Number.NaN, 1000, 100)).toBe(0);
  });

  it('reads and restores Monaco using its scrollable height', () => {
    const setScrollTop = vi.fn();
    const editor = {
      getScrollTop: () => 450,
      getScrollHeight: () => 1000,
      getLayoutInfo: () => ({ height: 100 }),
      setScrollTop,
    };

    expect(readMonacoScrollRatio(editor)).toBe(0.5);
    restoreMonacoScrollRatio(editor, 0.25);
    expect(setScrollTop).toHaveBeenCalledWith(225);
  });

  it('reads and restores the WYSIWYG scroll container', () => {
    const container = scrollElement(300, 1100, 100);
    const editorDom = document.createElement('div');
    container.append(editorDom);
    const editor = { view: { dom: editorDom } };

    expect(readWysiwygScrollRatio(editor)).toBe(0.3);
    expect(restoreWysiwygScrollRatio(editor, 0.8)).toBe(true);
    expect(container.scrollTop).toBe(800);
  });

  it('declines WYSIWYG restoration when the editor is detached', () => {
    const editor = { view: { dom: document.createElement('div') } };
    expect(readWysiwygScrollRatio(editor)).toBeNull();
    expect(restoreWysiwygScrollRatio(editor, 0.5)).toBe(false);
  });
});

describe('applyAsMonacoLayoutSettles', () => {
  function settlingEditor() {
    const listeners: Array<() => void> = [];
    const node = document.createElement('div');
    const editor = {
      onDidLayoutChange: (listener: () => void) => {
        listeners.push(listener);
        return { dispose: () => listeners.splice(listeners.indexOf(listener), 1) };
      },
      onDidContentSizeChange: () => ({ dispose: () => undefined }),
      getDomNode: () => node,
    };
    const relayout = () => [...listeners].forEach((listener) => listener());
    return { editor, node, relayout, listeners };
  }

  it('re-applies on each layout change until the user takes over', () => {
    const { editor, node, relayout, listeners } = settlingEditor();
    const apply = vi.fn();
    applyAsMonacoLayoutSettles(editor, apply);
    expect(apply).toHaveBeenCalledTimes(1);

    // Monaco's first real layout replaces its placeholder size.
    relayout();
    expect(apply).toHaveBeenCalledTimes(2);

    node.dispatchEvent(new Event('pointerdown'));
    relayout();
    expect(apply).toHaveBeenCalledTimes(2);
    expect(listeners).toHaveLength(0);
  });

  it('stops after the settle window, or when stopped', () => {
    vi.useFakeTimers();
    try {
      const timed = settlingEditor();
      const apply = vi.fn();
      applyAsMonacoLayoutSettles(timed.editor, apply, 100);
      vi.advanceTimersByTime(100);
      timed.relayout();
      expect(apply).toHaveBeenCalledTimes(1);

      const stopped = settlingEditor();
      const again = vi.fn();
      applyAsMonacoLayoutSettles(stopped.editor, again)();
      stopped.relayout();
      expect(again).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
