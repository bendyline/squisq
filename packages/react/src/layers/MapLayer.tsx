/**
 * MapLayer Component
 *
 * Renders a geographic map layer within an SVG block. Maps are composed from
 * static tile images fetched from free/open-source providers.
 *
 * For video export reliability, maps can use pre-rendered static images via
 * the staticSrc property, avoiding tile loading race conditions during capture.
 *
 * Tile fetching: Tiles are loaded on mount and composited into a data URL
 * for SVG embedding. This ensures correct rendering in both browser and
 * Playwright screenshot contexts.
 */

import { useState, useEffect } from 'react';
import type { MapLayer as MapLayerType } from '@bendyline/squisq/schemas';
import { getAnimationStyle } from '../utils/animationUtils';
import { resolveValue, getAnchorOffset } from '../utils/layerUtils';
import { composeMapImage } from '../utils/mapTileUtils';

interface MapLayerProps {
  layer: MapLayerType;
  /** Base path for resolving relative image URLs */
  basePath: string;
  /** Viewport dimensions for percentage calculations */
  viewport: { width: number; height: number };
  /** Current time relative to block start (for animation timing) */
  blockTime: number;
}

export function MapLayer({ layer, basePath, viewport, blockTime }: MapLayerProps) {
  const { content, position, animation } = layer;
  const [mapImageUrl, setMapImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Resolve position values to pixels
  const x = resolveValue(position.x, viewport.width);
  const y = resolveValue(position.y, viewport.height);
  const width = position.width ? resolveValue(position.width, viewport.width) : viewport.width;
  const height = position.height ? resolveValue(position.height, viewport.height) : viewport.height;

  // Apply anchor offset
  const offset = getAnchorOffset(position.anchor, width, height);
  const finalX = x + offset.x;
  const finalY = y + offset.y;

  // Use static image if provided, otherwise fetch and compose tiles
  useEffect(() => {
    let cancelled = false;

    if (content.staticSrc) {
      // Use pre-rendered static image
      const src = content.staticSrc.startsWith('http')
        ? content.staticSrc
        : `${basePath}/${content.staticSrc}`;
      setMapImageUrl(src);
      setIsLoading(false);
      return;
    }

    // Compose map from tiles
    setIsLoading(true);
    setError(null);

    composeMapImage({
      center: content.center,
      zoom: content.zoom,
      style: content.style,
      width,
      height,
      markers: content.markers,
      showAttribution: content.showAttribution !== false,
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setMapImageUrl(dataUrl);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error('Failed to compose map:', err);
          setError(err instanceof Error ? err.message : String(err));
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- content properties are destructured below; center/markers/showAttribution are stable per-render
  }, [
    content.center.lat,
    content.center.lng,
    content.zoom,
    content.style,
    content.staticSrc,
    width,
    height,
    basePath,
  ]);

  // Get animation styles
  const animStyle = getAnimationStyle(animation, blockTime);

  // Render loading state
  if (isLoading) {
    return (
      <g
        className={`block-layer block-layer--map ${animStyle.className}`}
        style={animStyle.style}
        data-layer-id={layer.id}
      >
        <rect x={finalX} y={finalY} width={width} height={height} fill="#e5e7eb" />
        <text
          x={finalX + width / 2}
          y={finalY + height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#9ca3af"
          fontSize="24"
          fontFamily="system-ui, sans-serif"
        >
          Loading map...
        </text>
      </g>
    );
  }

  // Render error state
  if (error || !mapImageUrl) {
    return (
      <g
        className={`block-layer block-layer--map ${animStyle.className}`}
        style={animStyle.style}
        data-layer-id={layer.id}
      >
        <rect x={finalX} y={finalY} width={width} height={height} fill="#fef2f2" />
        <text
          x={finalX + width / 2}
          y={finalY + height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#dc2626"
          fontSize="18"
          fontFamily="system-ui, sans-serif"
        >
          Map failed to load
        </text>
      </g>
    );
  }

  return (
    <g
      className={`block-layer block-layer--map ${animStyle.className}`}
      style={animStyle.style}
      data-layer-id={layer.id}
    >
      {/* Clip path for overflow handling */}
      <defs>
        <clipPath id={`clip-${layer.id}`}>
          <rect x={finalX} y={finalY} width={width} height={height} />
        </clipPath>
      </defs>

      {/* Map image */}
      <g clipPath={`url(#clip-${layer.id})`}>
        <image
          href={mapImageUrl}
          x={finalX}
          y={finalY}
          width={width}
          height={height}
          preserveAspectRatio="xMidYMid slice"
          style={{ pointerEvents: 'none' }}
        />
      </g>
    </g>
  );
}

export default MapLayer;
