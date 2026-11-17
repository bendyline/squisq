/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorContent } from '@tiptap/react';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { EditorProvider } from '../EditorContext';
import { ImageWithMediaProvider } from '../ImageNodeView';

const editors: Editor[] = [];

/** A loaded, selected 1200×600 picture drawn 300px wide. */
function mountSelectedImage() {
  const provider: MediaProvider = {
    resolveUrl: vi.fn(async (path: string) => path),
    addMedia: vi.fn(async (name: string) => name),
    listMedia: vi.fn(async () => []),
    removeMedia: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
  const editor = new Editor({
    extensions: [StarterKit, ImageWithMediaProvider.configure({ inline: false })],
    content: {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'https://example.test/cat.jpg', alt: 'Cat' } }],
    },
  });
  editors.push(editor);
  const { container } = render(
    <EditorProvider initialMarkdown="" mediaProvider={provider} allowRecording={false}>
      <EditorContent editor={editor} />
    </EditorProvider>,
  );
  const image = container.querySelector('img')!;
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: 1200 },
    naturalHeight: { configurable: true, value: 600 },
  });
  image.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 300,
    height: 150,
    right: 300,
    bottom: 150,
    toJSON: () => ({}),
  });
  fireEvent.load(image);
  act(() => {
    editor.commands.setNodeSelection(0);
  });
  return { editor, handle: screen.getByTestId('image-resize-handle') };
}

/** jsdom has no PointerEvent; a MouseEvent carrying the pointer fields stands in. */
function pointer(type: string, target: Element, x: number, pointerType = 'touch'): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 0 });
  Object.defineProperties(event, {
    pointerType: { value: pointerType },
    pointerId: { value: 7 },
    isPrimary: { value: true },
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const imageAttrs = (editor: Editor) => editor.state.doc.firstChild!.attrs;

afterEach(() => {
  cleanup();
  for (const editor of editors.splice(0)) editor.destroy();
});

describe('image resize handle', () => {
  it('resizes with a finger, which never sends mouse events', () => {
    const { editor, handle } = mountSelectedImage();

    const down = pointer('pointerdown', handle, 300);
    // Cancelled so the page neither scrolls nor turns the touch into a click.
    expect(down.defaultPrevented).toBe(true);
    pointer('pointermove', handle, 260);
    pointer('pointermove', handle, 200);
    expect(screen.getByText('200px')).toBeTruthy();
    expect(imageAttrs(editor).width).toBeNull();

    pointer('pointerup', handle, 200);
    expect(imageAttrs(editor).width).toBe(200);
    expect(imageAttrs(editor).height).toBe(100);
  });

  it('resizes with a mouse and still blocks the mousedown that would start a node drag', () => {
    const { editor, handle } = mountSelectedImage();

    const down = pointer('pointerdown', handle, 300, 'mouse');
    // The compatibility mousedown has to follow, so pointerdown stays live…
    expect(down.defaultPrevented).toBe(false);
    // …and that mousedown is what gets cancelled.
    expect(fireEvent.mouseDown(handle)).toBe(false);
    pointer('pointermove', handle, 250, 'mouse');
    pointer('pointerup', handle, 250, 'mouse');
    expect(imageAttrs(editor).width).toBe(250);
    expect(imageAttrs(editor).height).toBe(125);
  });

  it('keeps the old size when the system cancels the touch', () => {
    const { editor, handle } = mountSelectedImage();

    pointer('pointerdown', handle, 300);
    pointer('pointermove', handle, 150);
    expect(screen.getByText('150px')).toBeTruthy();
    pointer('pointercancel', handle, 0);
    expect(imageAttrs(editor).width).toBeNull();
    expect(screen.queryByText(/px$/)).toBeNull();

    // The cancelled gesture is over: later moves no longer resize.
    pointer('pointermove', handle, 100);
    expect(screen.queryByText(/px$/)).toBeNull();
  });

  it('marks the grip as running its own touch drag', () => {
    const { handle } = mountSelectedImage();
    expect(handle.hasAttribute('data-squisq-touch-drag')).toBe(true);
  });
});
