/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorContent } from '@tiptap/react';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { EditorProvider } from '../EditorContext';
import { ImageWithMediaProvider } from '../ImageNodeView';
import { tiptapToMarkdown } from '../tiptapBridge';

const editors: Editor[] = [];
function mountImage(
  src: string,
  resolve: MediaProvider['resolveUrl'],
  title: string | null = null,
) {
  const provider: MediaProvider = {
    resolveUrl: vi.fn(resolve),
    addMedia: vi.fn(async (name) => name),
    listMedia: vi.fn(async () => []),
    removeMedia: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
  const editor = new Editor({
    extensions: [StarterKit, ImageWithMediaProvider.configure({ inline: false })],
    content: { type: 'doc', content: [{ type: 'image', attrs: { src, alt: 'A photo', title } }] },
  });
  editors.push(editor);
  const result = render(
    <EditorProvider initialMarkdown="" mediaProvider={provider} allowRecording={false}>
      <EditorContent editor={editor} />
    </EditorProvider>,
  );
  return { ...result, editor, provider };
}

afterEach(() => {
  cleanup();
  for (const editor of editors.splice(0)) editor.destroy();
});

describe('image loading feedback', () => {
  it('keeps fallback/serialized DOM inert while preserving Markdown and clipboard image references', () => {
    const { editor } = mountImage('notes_files/photo.jpg', async () => 'blob:photo');
    const html = editor.getHTML();
    const inert = document.createElement('div');
    inert.innerHTML = html;
    expect(inert.querySelector('img')?.hasAttribute('src')).toBe(false);
    expect(tiptapToMarkdown(html)).toContain('![A photo](notes_files/photo.jpg)');
    const clipboard = editor.view.someProp('clipboardSerializer')!;
    const fragment = clipboard.serializeFragment(editor.state.doc.content);
    expect(fragment.querySelector('img')?.getAttribute('src')).toBe('notes_files/photo.jpg');
    editor.commands.setContent(html);
    expect(editor.state.doc.firstChild?.attrs.src).toBe('notes_files/photo.jpg');
  });
  it('never requests a raw workspace path and waits for the resolved image to load', async () => {
    let finish!: (url: string) => void;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const { container } = mountImage('notes_files/photo.jpg', () => pending);
    expect(screen.getByRole('status').textContent).toContain('Loading image');
    expect(container.querySelector('img')).toBeNull();
    await act(async () => {
      finish('blob:photo');
      await pending;
    });
    const image = container.querySelector('img')!;
    expect(image.getAttribute('src')).toBe('blob:photo');
    expect(image.style.display).toBe('none');
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.load(image);
    expect(screen.queryByRole('status')).toBeNull();
    expect(image.style.display).toBe('block');
    expect(container.querySelector('figure')?.getAttribute('data-image-state')).toBe('ready');
  });

  it('shows an hourglass while an upload is pending and keeps it out of saved markdown', () => {
    const { container, editor, provider } = mountImage(
      'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      async () => 'blob:photo',
      'squisq-upload:pending',
    );
    expect(screen.getByRole('status').textContent).toContain('Adding image');
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect(provider.resolveUrl).not.toHaveBeenCalled();
    expect(tiptapToMarkdown(editor.getHTML())).not.toContain('data:image');
    expect(tiptapToMarkdown(editor.getHTML())).not.toContain('squisq-upload');
  });

  it.each(['missing', 'rejected'])('shows a custom unavailable card for %s media', async (kind) => {
    const { container } = mountImage('missing.jpg', async (path) => {
      if (kind === 'rejected') throw new Error('Permission denied');
      return path;
    });
    await screen.findByRole('img', { name: 'Image unavailable: A photo' });
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('replaces an undecodable image with the unavailable card', async () => {
    const { container } = mountImage('https://example.test/broken.png', async (path) => path);
    const image = container.querySelector('img')!;
    fireEvent.error(image);
    expect(screen.getByRole('img', { name: 'Image unavailable: A photo' })).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });

  it('ignores a stale resolution after the author changes the image source', async () => {
    let finishOld!: (url: string) => void;
    const old = new Promise<string>((resolve) => {
      finishOld = resolve;
    });
    const { container, editor } = mountImage('old.jpg', (path) =>
      path === 'old.jpg' ? old : Promise.resolve('blob:new'),
    );
    act(() => {
      editor.commands.updateAttributes('image', { src: 'new.jpg' });
    });
    await waitFor(() =>
      expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:new'),
    );
    fireEvent.load(container.querySelector('img')!);
    await act(async () => {
      finishOld('blob:old');
      await old;
    });
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:new');
    expect(screen.queryByRole('status')).toBeNull();
  });
});
