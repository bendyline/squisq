/** @vitest-environment jsdom */

/**
 * The Write view's image node with an attached SVG: it shows core's
 * sanitized, sized re-serialization of the file (so a viewBox-only SVG no
 * longer collapses to nothing), offers no Edit (the raster editor cannot save
 * an SVG back), and says so when the file is not a usable SVG.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorContent } from '@tiptap/react';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { EditorProvider } from '../EditorContext';
import { ImageWithMediaProvider } from '../ImageNodeView';

const LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" onload="alert(1)"><script>alert(2)</script><rect width="120" height="60"/></svg>';

function dataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function decode(src: string): string {
  return Buffer.from(src.slice(src.indexOf(',') + 1), 'base64').toString('utf8');
}

/** Serves workspace files as data URLs, as a container provider serves blob URLs. */
function providerFor(files: Record<string, string>): MediaProvider {
  return {
    addMedia: vi.fn(async (name: string) => name),
    resolveUrl: vi.fn(async (name: string) => files[name] ?? name),
    listMedia: vi.fn(async () => []),
    removeMedia: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
}

const editors: Editor[] = [];

function mountImage(src: string, provider: MediaProvider) {
  const editor = new Editor({
    extensions: [StarterKit, ImageWithMediaProvider.configure({ inline: false })],
    content: `<img src="${src}" alt="Logo">`,
  });
  editors.push(editor);
  return render(
    <EditorProvider initialMarkdown="" mediaProvider={provider} allowRecording={false}>
      <EditorContent editor={editor} />
    </EditorProvider>,
  );
}

afterEach(() => {
  cleanup();
  for (const editor of editors.splice(0)) editor.destroy();
});

describe('ImageNodeView with an attached SVG', () => {
  it('shows core’s sanitized, sized markup and offers no Edit', async () => {
    const { container } = mountImage(
      'media/logo.svg',
      providerFor({ 'media/logo.svg': dataUrl(LOGO) }),
    );
    const img = await waitFor(() => {
      const found = container.querySelector('img');
      expect(found?.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/);
      return found!;
    });
    const markup = decode(img.getAttribute('src')!);
    expect(markup).not.toContain('script');
    expect(markup).not.toContain('onload');
    expect(markup).toContain('width="120" height="60"');
    fireEvent.load(img);
    fireEvent.mouseEnter(container.querySelector('figure') as HTMLElement);
    expect(screen.queryByTestId('image-edit-affordance')).toBeNull();
  });

  it('reports a file that is not a usable SVG as unavailable', async () => {
    const { container } = mountImage(
      'media/broken.svg',
      providerFor({ 'media/broken.svg': dataUrl('<div>not svg</div>') }),
    );
    await waitFor(() =>
      expect(container.querySelector('[data-image-state]')?.getAttribute('data-image-state')).toBe(
        'error',
      ),
    );
    expect(container.textContent).toContain('Image unavailable');
  });
});
