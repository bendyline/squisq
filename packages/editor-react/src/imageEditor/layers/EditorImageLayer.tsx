/**
 * SVG renderer for an `ImageEditLayer` of kind `image` inside the editor.
 * Resolves the asset path to a blob URL via the host-supplied
 * `resolveAssetUrl` (typically backed by the sidecar container).
 */

import { useEffect, useState } from 'react';
import type { ImageEditCanvas, ImageEditLayer } from '@bendyline/squisq/schemas';

interface Props {
  layer: ImageEditLayer & { type: 'image' };
  canvas: ImageEditCanvas;
  resolveAssetUrl: (path: string) => Promise<string>;
}

export function EditorImageLayer({ layer, canvas, resolveAssetUrl }: Props) {
  const [href, setHref] = useState<string | null>(null);
  const src = layer.content.src;

  useEffect(() => {
    let cancelled = false;
    resolveAssetUrl(src)
      .then((url) => {
        if (!cancelled) setHref(url);
      })
      .catch(() => {
        if (!cancelled) setHref(null);
      });
    return () => {
      cancelled = true;
    };
  }, [src, resolveAssetUrl]);

  if (!href) return null;

  const p = layer.position;
  const x = typeof p.x === 'number' ? p.x : 0;
  const y = typeof p.y === 'number' ? p.y : 0;
  const width = typeof p.width === 'number' ? p.width : canvas.width;
  const height = typeof p.height === 'number' ? p.height : canvas.height;
  const fit = layer.content.fit ?? 'fill';
  const par = fit === 'cover' ? 'xMidYMid slice' : fit === 'contain' ? 'xMidYMid meet' : 'none';

  return <image href={href} x={x} y={y} width={width} height={height} preserveAspectRatio={par} />;
}
