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
});
