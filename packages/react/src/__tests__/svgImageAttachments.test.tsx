/**
 * Attached SVG images (`![logo](logo.svg)`) render through core's SVG island
 * sanitizer: what reaches the page is core's sized re-serialization, as a
 * `data:` URL, never the file as written.
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { Block, MediaProvider } from '@bendyline/squisq/schemas';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { BlockRenderer } from '../BlockRenderer';
import { MediaContext } from '../hooks/MediaContext';

const HOSTILE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" onload="alert(1)"><script>alert(2)</script><rect width="120" height="60" opacity="0"><animate attributeName="opacity" to="1" dur="1s" fill="freeze"/></rect></svg>';

function dataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(svg)))}`;
}

function decode(src: string | null | undefined): string {
  expect(src).toMatch(/^data:image\/svg\+xml;base64,/);
  const base64 = src!.slice(src!.indexOf(',') + 1);
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
}

/** A provider that serves files as data: URLs, like the standalone player's. */
function provider(files: Record<string, string>): MediaProvider {
  return {
    async resolveUrl(path: string) {
      if (!(path in files)) throw new Error(`missing ${path}`);
      return dataUrl(files[path]!);
    },
    async listMedia() {
      return [];
    },
    async addMedia(name: string) {
      return name;
    },
    async removeMedia() {},
    dispose() {},
  } as unknown as MediaProvider;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('attached SVG images in markdown', () => {
  it('render core’s sanitized, sized markup', async () => {
    const nodes = parseMarkdown('![Logo](images/logo.svg)').children;
    const { container } = render(
      <MediaContext.Provider value={provider({ 'images/logo.svg': HOSTILE })}>
        <MarkdownRenderer nodes={nodes} />
      </MediaContext.Provider>,
    );
    const img = await waitFor(
      () => {
        const found = container.querySelector('img');
        expect(found?.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/);
        return found!;
      },
      { timeout: 5000 },
    );
    const markup = decode(img.getAttribute('src'));
    expect(markup).not.toContain('script');
    expect(markup).not.toContain('onload');
    // Sized from its viewBox, so it neither collapses nor stretches.
    expect(markup).toMatch(/width="120" height="60"/);
  });

  it('read a same-origin path without a provider', async () => {
    const fetchStub = vi.fn(async () => new Response(HOSTILE));
    vi.stubGlobal('fetch', fetchStub);
    const nodes = parseMarkdown('![Logo](logo.svg)').children;
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    await waitFor(() =>
      expect(container.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg/),
    );
    expect(fetchStub).toHaveBeenCalledWith('./logo.svg');
  });

  it('leave a remote SVG on its own URL and raster images alone', () => {
    const nodes = parseMarkdown(
      '![Remote](https://example.com/logo.svg)\n\n![Photo](https://example.com/photo.png)',
    ).children;
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    const srcs = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(srcs).toEqual(['https://example.com/logo.svg', 'https://example.com/photo.png']);
  });

  it('show nothing for a file that is not a usable SVG', async () => {
    const nodes = parseMarkdown('![Broken](broken.svg)').children;
    const { container } = render(
      <MediaContext.Provider value={provider({ 'broken.svg': '<div>not svg</div>' })}>
        <MarkdownRenderer nodes={nodes} />
      </MediaContext.Provider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.querySelector('img')?.getAttribute('src') ?? '').toBe('');
  });

  it('accept an inline SVG data URL, sanitized', async () => {
    const nodes = parseMarkdown(`![Inline](${dataUrl(HOSTILE)})`).children;
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    const img = await waitFor(() => {
      const found = container.querySelector('img');
      expect(found?.getAttribute('src')).toMatch(/^data:image\/svg/);
      return found!;
    });
    expect(decode(img.getAttribute('src'))).not.toContain('script');
  });
});

describe('attached SVG images on slides', () => {
  const block: Block = {
    id: 'slide',
    startTime: 0,
    duration: 5,
    audioSegment: 0,
    layers: [
      {
        type: 'image',
        id: 'logo',
        content: { src: 'logo.svg', alt: 'Logo', fit: 'contain' },
        position: { x: 0, y: 0, width: 400, height: 200 },
      },
    ],
  };

  it('draw core’s markup, and a still for capture', async () => {
    const { container } = render(
      <MediaContext.Provider value={provider({ 'logo.svg': HOSTILE })}>
        <BlockRenderer block={block} blockTime={0} basePath="/" staticMedia />
      </MediaContext.Provider>,
    );
    const image = await waitFor(() => {
      const found = container.querySelector('.block-layer--image image');
      expect(found?.getAttribute('href')).toMatch(/^data:image\/svg/);
      return found!;
    });
    const markup = decode(image.getAttribute('href'));
    expect(markup).not.toContain('script');
    expect(markup).not.toContain('animate');
    expect(markup).toContain('opacity="1"');
  });
});
