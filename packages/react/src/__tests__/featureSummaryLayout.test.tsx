import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { DEFAULT_THEME, buildPreviewDoc, markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown, LOCAL_ONLY_RESOURCE_POLICY } from '@bendyline/squisq/markdown';
import { applyTransform } from '@bendyline/squisq/transform';
import { useDocPlayback } from '../hooks/useDocPlayback';
import { useFeatureMediaAspectRatios } from '../hooks/useFeatureMediaAspectRatios';
import { MediaContext, ResourcePolicyContext } from '../hooks/MediaContext';
import { renderMermaidSvg } from '../mermaid/mermaidRuntime';

vi.mock('../mermaid/mermaidRuntime', () => ({ renderMermaidSvg: vi.fn() }));

function summary(markdown: string) {
  return buildPreviewDoc(
    applyTransform(
      markdownToDoc(parseMarkdown(markdown), {
        generateCoverBlock: false,
      }),
      'headings-and-features',
    ).doc,
  );
}

describe('intrinsic feature summary layout', () => {
  const images: HTMLImageElement[] = [];
  beforeEach(() => {
    images.length = 0;
    vi.stubGlobal(
      'Image',
      vi.fn(function () {
        const image = document.createElement('img');
        images.push(image);
        return image;
      }),
    );
    vi.mocked(renderMermaidSvg).mockResolvedValue({
      svg: '<svg viewBox="0 0 300 900"/>',
      diagramType: 'flowchart-v2',
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resolves container imagery and re-expands the player with its real portrait aspect', async () => {
    const doc = summary('# Seeing this in action\n\n![Feature](portrait.png)');
    const provider = {
      resolveUrl: vi.fn().mockResolvedValue('blob:summary-portrait'),
    } as unknown as MediaProvider;
    const { result, unmount } = renderHook(() => useDocPlayback(doc, 0, { theme: DEFAULT_THEME }), {
      wrapper: ({ children }) => (
        <MediaContext.Provider value={provider}>{children}</MediaContext.Provider>
      ),
    });
    const initial = result.current.blocks[0].layers!.find((layer) => layer.type === 'image')!;
    await waitFor(() => expect(images).toHaveLength(1));
    expect(images[0].src).toBe('blob:summary-portrait');
    await act(async () => {
      Object.defineProperties(images[0], {
        naturalWidth: { value: 600 },
        naturalHeight: { value: 1200 },
      });
      images[0].dispatchEvent(new Event('load'));
    });
    const measured = result.current.blocks[0].layers!.find((layer) => layer.type === 'image')!;
    expect(Number(measured.position.height)).toBeGreaterThan(Number(initial.position.height));
    expect(Number(measured.position.y)).toBeLessThan(1080 * 0.05);
    expect(measured.content.fit).toBe('contain');
    unmount();
    expect(images[0].hasAttribute('src')).toBe(false);
  });

  it('uses a Mermaid SVG viewBox to give a portrait graph the full-height feature slot', async () => {
    const doc = summary('# Flow\n\n```mermaid\ngraph TD\nA --> B\n```');
    const { result } = renderHook(() => useDocPlayback(doc, 0, { theme: DEFAULT_THEME }));
    await waitFor(() => {
      const diagram = result.current.blocks[0].layers!.find((layer) => layer.type === 'mermaid')!;
      expect(Number(diagram.position.height)).toBeGreaterThan(1080 * 0.9);
    });
  });

  it('does not probe imagery in an explicitly authored template', () => {
    const doc = summary('# Feature {[leftFeature]}\n\n![Feature](authored.png)');
    renderHook(() => useDocPlayback(doc, 0));
    expect(images).toHaveLength(0);
  });

  it('reads portrait video metadata without playing it, then releases the probe', async () => {
    const video = document.createElement('video');
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag, options) =>
      tag === 'video' ? video : createElement(tag, options),
    );
    const load = vi.spyOn(video, 'load').mockImplementation(() => {});
    const play = vi.spyOn(video, 'play');
    Object.defineProperties(video, {
      videoWidth: { value: 720 },
      videoHeight: { value: 1280 },
    });
    const doc = summary('# Video\n\n[Demo](portrait-video.mp4)');
    const { result, unmount } = renderHook(() =>
      useFeatureMediaAspectRatios(doc.blocks, '/media', DEFAULT_THEME),
    );
    expect(video.src).toContain('/media/portrait-video.mp4');
    expect(video.preload).toBe('metadata');
    expect(video.muted).toBe(true);
    act(() => video.dispatchEvent(new Event('loadedmetadata')));
    expect(result.current['portrait-video.mp4']).toBe(720 / 1280);
    expect(play).not.toHaveBeenCalled();
    expect(video.hasAttribute('src')).toBe(false);
    unmount();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('obeys resource policy and clears dimensions when the document changes', async () => {
    const first = summary('# Feature\n\n![Feature](local.png)');
    const next = summary('# Feature\n\n![Feature](https://example.com/remote.png)');
    const { result, rerender } = renderHook(
      ({ doc }) => useFeatureMediaAspectRatios(doc.blocks, '.', DEFAULT_THEME),
      {
        initialProps: { doc: first },
        wrapper: ({ children }) => (
          <ResourcePolicyContext.Provider value={LOCAL_ONLY_RESOURCE_POLICY}>
            {children}
          </ResourcePolicyContext.Provider>
        ),
      },
    );
    await waitFor(() => expect(images).toHaveLength(1));
    act(() => {
      Object.defineProperties(images[0], {
        naturalWidth: { value: 500 },
        naturalHeight: { value: 1000 },
      });
      images[0].dispatchEvent(new Event('load'));
    });
    expect(result.current['local.png']).toBe(0.5);
    rerender({ doc: next });
    expect(result.current).toEqual({});
    expect(images).toHaveLength(1);
  });
});
