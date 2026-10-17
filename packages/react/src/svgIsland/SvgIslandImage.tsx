/**
 * SvgIslandImage — a ```svg fence as a picture in flowing HTML (the read
 * view, Page mode, the editor's Write-view preview).
 *
 * Shows ONLY core's sanitized re-serialization, as an `<img>` of a data URL:
 * in an image the island cannot run script, fetch anything, or restyle the
 * page. Its `currentColor` follows the color of the text around it (read
 * from the rendered container, so it is right on accent bands and dark
 * surfaces too). The picture shows at its intrinsic size, never wider than
 * its column.
 */

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { parseSvgIsland, svgIslandDataUrl } from '@bendyline/squisq/markdown';

export interface SvgIslandImageProps {
  /** The fence body. */
  source: string;
  /** Rendered instead (with a short notice) when the source is not an island. */
  fallback?: ReactNode;
  /** Draw a still — no animation inside the island. Default: reduced motion. */
  isStatic?: boolean;
  /**
   * The color `currentColor` resolves to. Default: the computed text color
   * where the picture renders.
   */
  color?: string;
  className?: string;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

export function SvgIslandImage({
  source,
  fallback,
  isStatic,
  color,
  className,
}: SvgIslandImageProps) {
  const figureRef = useRef<HTMLElement | null>(null);
  const [surroundingColor, setSurroundingColor] = useState<string | undefined>(undefined);
  const [reducedMotion] = useState(prefersReducedMotion);
  const still = isStatic ?? reducedMotion;
  const result = useMemo(() => parseSvgIsland(source, { static: still }), [source, still]);

  // Read the surrounding text color once the figure is laid out (and again
  // for a new source); it only changes the URL when the color differs.
  useLayoutEffect(() => {
    if (color !== undefined || !figureRef.current) return;
    const computed = getComputedStyle(figureRef.current).color;
    if (computed) setSurroundingColor(computed);
  }, [color, result]);

  const effectiveColor = color ?? surroundingColor;
  const src = useMemo(
    () => (result.ok ? svgIslandDataUrl(result.island, { color: effectiveColor }) : null),
    [result, effectiveColor],
  );

  if (!result.ok || !src) {
    return (
      <div className={['squisq-md-svg-error', className].filter(Boolean).join(' ')}>
        <p className="squisq-md-svg-error-note" role="note">
          Couldn’t render this SVG: {result.ok ? 'unknown error' : result.message}
        </p>
        {fallback}
      </div>
    );
  }

  const { island } = result;
  return (
    <figure
      ref={figureRef}
      className={['squisq-md-svg', className].filter(Boolean).join(' ')}
      data-svg-island=""
    >
      <img
        src={src}
        alt={island.title ?? 'Illustration'}
        width={island.width}
        height={island.height}
        decoding="sync"
        draggable={false}
      />
    </figure>
  );
}
