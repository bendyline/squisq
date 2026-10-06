/** Browser metadata for the visual-first summary's pure layout selection. */
import { useEffect, useMemo, useState } from 'react';
import type { Block, Theme } from '@bendyline/squisq/schemas';
import {
  extractImages,
  extractEmbeddedVideos,
  flattenRenderableBlocks,
} from '@bendyline/squisq/doc';
import { isResourceUrlAllowed } from '@bendyline/squisq/markdown';
import { useMediaProvider, useResourcePolicy } from './MediaContext.js';
import { renderMermaidSvg } from '../mermaid/mermaidRuntime.js';

interface FeatureSource {
  kind: 'image' | 'video' | 'mermaid';
  source: string;
}
const EMPTY_RATIOS: Readonly<Record<string, number>> = {};
const ratioCache = new Map<string, number>();
let diagramSequence = 0;

/** Metadata only: never plays a video, and releases detached probes on cleanup. */
function probeAspectRatio(
  kind: 'image' | 'video',
  url: string,
  report: (ratio: number) => void,
): () => void {
  let element: HTMLImageElement | HTMLVideoElement;
  let size: () => [number, number];
  if (kind === 'image') {
    const image = new Image();
    element = image;
    size = () => [image.naturalWidth, image.naturalHeight];
  } else {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    element = video;
    size = () => [video.videoWidth, video.videoHeight];
  }
  const event = kind === 'image' ? 'load' : 'loadedmetadata';
  let released = false;
  const cleanup = () => {
    if (released) return;
    released = true;
    clearTimeout(timeout);
    element.removeEventListener(event, loaded);
    element.removeEventListener('error', cleanup);
    element.removeAttribute('src');
    if (element instanceof HTMLVideoElement) element.load();
  };
  const loaded = () => {
    const [width, height] = size();
    if (width > 0 && height > 0) report(width / height);
    cleanup();
  };
  const timeout = setTimeout(cleanup, 8000);
  element.addEventListener(event, loaded);
  element.addEventListener('error', cleanup);
  element.src = url;
  return cleanup;
}

export function useFeatureMediaAspectRatios(
  blocks: Block[] | undefined,
  basePath: string,
  theme: Theme,
): Readonly<Record<string, number>> {
  const provider = useMediaProvider();
  const policy = useResourcePolicy();
  const sourceKey = useMemo(() => {
    const sources = new Map<string, FeatureSource>();
    for (const block of flattenRenderableBlocks(blocks ?? [])) {
      if (block.summaryLayout !== 'feature') continue;
      for (const image of extractImages(block.contents))
        sources.set(image.src, { kind: 'image', source: image.src });
      for (const video of extractEmbeddedVideos(block.contents))
        sources.set(video.src, { kind: 'video', source: video.src });
      for (const node of block.contents ?? []) {
        if (node.type === 'code' && node.lang?.trim().toLowerCase() === 'mermaid')
          sources.set(node.value, { kind: 'mermaid', source: node.value });
      }
    }
    return JSON.stringify([...sources.values()]);
  }, [blocks]);
  const scope = useMemo(
    () => ({ sourceKey, provider, policy, basePath, theme }),
    [sourceKey, provider, policy, basePath, theme],
  );
  const [result, setResult] = useState<{
    scope: object;
    ratios: Readonly<Record<string, number>>;
  }>();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    let current = true;
    const cleanups: (() => void)[] = [];
    const ratios: Record<string, number> = {};
    const report = (source: string, ratio: number) => {
      if (!current || !Number.isFinite(ratio) || ratio <= 0) return;
      ratios[source] = ratio;
      setResult({ scope, ratios: { ...ratios } });
    };
    const sources: FeatureSource[] = JSON.parse(sourceKey);
    for (const { kind, source } of sources) {
      if (kind === 'mermaid') {
        // Mermaid's SVG viewBox captures the real graph shape, including
        // portrait flowcharts whose direction alone cannot predict its size.
        void renderMermaidSvg(
          `squisq-feature-measure-${++diagramSequence}`,
          source,
          undefined,
          theme,
        )
          .then(({ svg }) => {
            if (!current) return;
            const viewBox = new DOMParser()
              .parseFromString(svg, 'image/svg+xml')
              .documentElement.getAttribute('viewBox')
              ?.trim()
              .split(/[\s,]+/)
              .map(Number);
            if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0)
              report(source, viewBox[2] / viewBox[3]);
          })
          .catch(() => {
            /* The visible renderer reports malformed diagrams. */
          });
        continue;
      }
      const resolve = async () => {
        const absolute = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(source);
        const fallback = absolute ? source : `${basePath.replace(/\/$/, '')}/${source}`;
        let url = fallback;
        if (!absolute && provider) {
          try {
            url = await provider.resolveUrl(source);
          } catch {
            /* use fallback */
          }
        }
        if (!current || !isResourceUrlAllowed(url, policy)) return;
        const cacheKey = `${kind}:${url}`;
        const cached = ratioCache.get(cacheKey);
        if (cached !== undefined) {
          report(source, cached);
          return;
        }
        cleanups.push(
          probeAspectRatio(kind, url, (ratio) => {
            if (!current) return;
            ratioCache.set(cacheKey, ratio);
            report(source, ratio);
          }),
        );
      };
      void resolve();
    }
    return () => {
      current = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [sourceKey, provider, policy, basePath, theme, scope]);
  return result?.scope === scope ? result.ratios : EMPTY_RATIOS;
}
