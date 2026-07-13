/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorProvider, useEditorContext, type EditorContextValue } from '../EditorContext';

let currentContext: EditorContextValue | null = null;
let animationFrames: FrameRequestCallback[] = [];

function ContextProbe() {
  currentContext = useEditorContext();
  return null;
}

function context(): EditorContextValue {
  if (!currentContext) throw new Error('EditorContext has not mounted');
  return currentContext;
}

function wysiwygEditor(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): { editor: unknown; container: HTMLElement } {
  const container = document.createElement('div');
  container.className = 'squisq-wysiwyg-container';
  Object.defineProperties(container, {
    scrollTop: { value: scrollTop, writable: true },
    scrollHeight: { value: scrollHeight },
    clientHeight: { value: clientHeight },
  });
  const dom = document.createElement('div');
  container.append(dom);
  return { editor: { view: { dom } }, container };
}

function flushAnimationFrame(): void {
  const callback = animationFrames.shift();
  if (callback) act(() => callback(0));
}

beforeEach(() => {
  currentContext = null;
  animationFrames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EditorProvider scroll handoff', () => {
  it('restores proportional positions from Write to Source and back', () => {
    render(
      <EditorProvider initialMarkdown="# One\n\nBody" initialView="wysiwyg">
        <ContextProbe />
      </EditorProvider>,
    );

    const write = wysiwygEditor(300, 1100, 100);
    act(() => context().setTiptapEditor(write.editor as never));

    act(() => {
      context().setActiveView('raw');
      context().setTiptapEditor(null);
    });

    let sourceScrollTop = 1500;
    const setSourceScrollTop = vi.fn();
    const source = {
      getScrollTop: () => sourceScrollTop,
      getScrollHeight: () => 2100,
      getLayoutInfo: () => ({ height: 100 }),
      setScrollTop: setSourceScrollTop,
    };
    act(() => context().setMonacoEditor(source as never));
    flushAnimationFrame();

    // Write was 30% through its scrollable range, so Source lands at 30%.
    expect(setSourceScrollTop).toHaveBeenCalledWith(600);

    // A real Monaco instance reports the new position after setScrollTop.
    sourceScrollTop = 1500;
    act(() => {
      context().setActiveView('wysiwyg');
      context().setMonacoEditor(null);
    });

    const nextWrite = wysiwygEditor(0, 1300, 100);
    act(() => context().setTiptapEditor(nextWrite.editor as never));
    flushAnimationFrame();

    // Source was 75% through; the newly mounted Write surface lands at 75%.
    expect(nextWrite.container.scrollTop).toBe(900);
  });
});
