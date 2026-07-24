/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorContent } from '@tiptap/react';
import { TiptapVideo } from '../tiptap/TiptapVideo';

vi.mock('../tiptap/useResolvedMediaSrc', () => ({
  useResolvedMediaSrc: (src: string) => src,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TiptapVideo placement toolbar', () => {
  it('writes PIP and overlay choices into the video HTML attribute', () => {
    const editor = new Editor({
      extensions: [StarterKit, TiptapVideo],
      content: '<video src="video/presenter.webm" controls></video>',
    });
    render(<EditorContent editor={editor} />);

    const inLayout = screen.getByRole('button', { name: 'In layout' });
    const pip = screen.getByRole('button', { name: 'PIP' });
    const overlay = screen.getByRole('button', { name: 'Overlay' });
    expect(inLayout.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(pip);
    expect(editor.getHTML()).toContain('data-squisq-video-placement="picture-in-picture"');
    expect(pip.getAttribute('aria-pressed')).toBe('true');

    const lock = screen.getByRole('button', { name: 'Lock to block' });
    expect(lock.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(lock);
    expect(editor.getHTML()).toContain('data-squisq-video-lock-to-block="false"');
    expect(lock.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(overlay);
    expect(editor.getHTML()).toContain('data-squisq-video-placement="overlay"');
    expect(overlay.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(inLayout);
    expect(editor.getHTML()).not.toContain('data-squisq-video-placement');
    expect(editor.getHTML()).not.toContain('data-squisq-video-lock-to-block');
    editor.destroy();
  });

  it('preserves per-video PIP size, shape, and position attributes', () => {
    const editor = new Editor({
      extensions: [StarterKit, TiptapVideo],
      content:
        '<video src="video/presenter.webm" data-squisq-video-placement="picture-in-picture" data-squisq-video-pip-size="large" data-squisq-video-pip-shape="wide" data-squisq-video-pip-position="top-left"></video>',
    });
    expect(editor.getHTML()).toContain('data-squisq-video-pip-size="large"');
    expect(editor.getHTML()).toContain('data-squisq-video-pip-shape="wide"');
    expect(editor.getHTML()).toContain('data-squisq-video-pip-position="top-left"');
    editor.destroy();
  });

  it('preserves timing attributes while the video remains in layout', () => {
    const editor = new Editor({
      extensions: [StarterKit, TiptapVideo],
      content:
        '<video src="video/inline.webm" data-squisq-video-start-at="3" data-squisq-video-clip-start="1" data-squisq-video-clip-end="7"></video>',
    });
    expect(editor.getHTML()).toContain('data-squisq-video-start-at="3"');
    expect(editor.getHTML()).toContain('data-squisq-video-clip-start="1"');
    expect(editor.getHTML()).toContain('data-squisq-video-clip-end="7"');
    editor.destroy();
  });
});
