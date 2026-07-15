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

import { useId, useState, useEffect } from 'react';
import type { MapLayer as MapLayerType } from '@bendyline/squisq/schemas';
import { ResourcePolicyError } from '@bendyline/squisq/markdown';
import { getAnimationStyle } from '../utils/animationUtils';
import { resolveValue, getAnchorOffset } from '../utils/layerUtils';
import { composeMapImage } from '../utils/mapTileUtils';
import { useMediaUrl, useResourcePolicy } from '../hooks/MediaContext';

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
  const clipId = `map-clip-${useId().replace(/:/g, '')}-${layer.id}`;
  const [mapImageUrl, setMapImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blockedByPolicy, setBlockedByPolicy] = useState(false);

  // Resolve position values to pixels
  const x = resolveValue(position.x, viewport.width);
  const y = resolveValue(position.y, viewport.height);
  const width = position.width ? resolveValue(position.width, viewport.width) : viewport.width;
  const height = position.height ? resolveValue(position.height, viewport.height) : viewport.height;

  // Apply anchor offset
  const offset = getAnchorOffset(position.anchor, width, height);
  const finalX = x + offset.x;
  const finalY = y + offset.y;

  // `staticSrc` is document-controlled, so it must travel the same path as
  // every other media URL: the resource policy governs it (a host rendering
  // untrusted docs with LOCAL_ONLY blocks remote fetches) and the
  // MediaProvider resolves container-backed paths (`images/map.png`) to blob
  // URLs so single-file HTML exports keep working. Blocked URLs resolve to ''.
  const staticSrc = useMediaUrl(content.staticSrc ?? '', basePath);

  // Tile composition contacts the provider, so it answers to the same policy
  // as every other document-controlled URL rather than being the one media
  // path that quietly reaches the network regardless.
  const resourcePolicy = useResourcePolicy();

  // Use static image if provided, otherwise fetch and compose tiles
  useEffect(() => {
    let cancelled = false;

    if (content.staticSrc) {
      // An empty resolution means the policy blocked the URL; surface it as a
      // load failure rather than falling through to composing live tiles.
      setMapImageUrl(staticSrc || null);
      setIsLoading(false);
      return;
    }

    // Compose map from tiles
    setIsLoading(true);
    setError(null);
    setBlockedByPolicy(false);

    composeMapImage({
      center: content.center,
      zoom: content.zoom,
      style: content.style,
      width,
      height,
      markers: content.markers,
      showAttribution: content.showAttribution !== false,
      policy: resourcePolicy,
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setMapImageUrl(dataUrl);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          // A policy block is a configuration outcome, not a failure — don't
          // cry wolf in the host's error console for a document behaving
          // exactly as the deployer intended.
          const blocked = err instanceof ResourcePolicyError;
          if (!blocked) console.error('Failed to compose map:', err);
          setError(err instanceof Error ? err.message : String(err));
          setBlockedByPolicy(blocked);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    content.center,
    content.zoom,
    content.style,
    content.staticSrc,
    staticSrc,
    content.markers,
    content.showAttribution,
    width,
    height,
    basePath,
    resourcePolicy,
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
        <rect
          x={finalX}
          y={finalY}
          width={width}
          height={height}
          fill={blockedByPolicy ? '#f3f4f6' : '#fef2f2'}
        />
        <text
          x={finalX + width / 2}
          y={finalY + height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={blockedByPolicy ? '#6b7280' : '#dc2626'}
          fontSize="18"
          fontFamily="system-ui, sans-serif"
        >
          {blockedByPolicy ? 'Map unavailable offline' : 'Map failed to load'}
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
        <clipPath id={clipId}>
          <rect x={finalX} y={finalY} width={width} height={height} />
        </clipPath>
      </defs>

      {/* Map image */}
      <g clipPath={`url(#${clipId})`}>
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
