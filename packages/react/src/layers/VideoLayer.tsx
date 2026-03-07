/**
 * VideoLayer Component
 *
 * Renders a video clip layer within an SVG block. Uses an HTML5 <video> element
 * inside a <foreignObject> (same pattern as ImageLayer for cover-mode images).
 * Videos are always muted — narration audio is the only sound track.
 *
 * Two modes of operation:
 * 1. Normal playback: Video auto-plays from clipStart to clipEnd on mount,
 *    pausing when the clip ends or when the block is no longer active.
 * 2. Render/seekTo mode (Playwright frame capture): Video is paused and seeked
 *    programmatically via data attributes read by DocPlayer's seekTo handler.
 *
 * The <video> element carries data-clip-start and data-clip-end attributes so
 * the seekTo handler can calculate the correct video time for any doc time.
 *
 * Related Files:
 * - schemas/Doc.ts — VideoLayer type definition
 * - shared/doc/templates/videoWithCaption.ts — template producing VideoLayers
 * - site/src/components/doc/DocPlayer.tsx — seekTo handler for video sync
 * - site/src/components/doc/layers/ImageLayer.tsx — similar foreignObject pattern
 */

import { useRef, useEffect } from 'react';
import type { VideoLayer as VideoLayerType } from '@bendyline/prodcore/schemas';

interface VideoLayerProps {
  layer: VideoLayerType;
  /** Base path for resolving relative video URLs */
  basePath: string;
  /** Viewport dimensions for percentage calculations */
  viewport: { width: number; height: number };
  /** Current time relative to block start (for playback sync) */
  blockTime: number;
  /** Whether the doc is currently playing */
  isPlaying?: boolean;
}

export function VideoLayer({ layer, basePath, viewport, blockTime, isPlaying }: VideoLayerProps) {
  const { content, position } = layer;
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasStartedRef = useRef(false);

  // Resolve position values to pixels
  const x = resolveValue(position.x, viewport.width);
  const y = resolveValue(position.y, viewport.height);
  const width = position.width ? resolveValue(position.width, viewport.width) : viewport.width;
  const height = position.height ? resolveValue(position.height, viewport.height) : viewport.height;

  // Apply anchor offset
  const offset = getAnchorOffset(position.anchor, width, height);
  const finalX = x + offset.x;
  const finalY = y + offset.y;

  // Build video URL — absolute paths and http URLs used as-is,
  // otherwise resolve relative to basePath
  const src = content.src.startsWith('http') || content.src.startsWith('/')
    ? content.src
    : `${basePath}/${content.src}`;

  const posterSrc = content.posterSrc
    ? (content.posterSrc.startsWith('http') || content.posterSrc.startsWith('/')
        ? content.posterSrc
        : `${basePath}/${content.posterSrc}`)
    : undefined;

  // On mount: seek to clipStart and set up clipEnd boundary.
  // The video will be muted and play silently alongside the narration.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Set initial time to clipStart
    video.currentTime = content.clipStart;
    hasStartedRef.current = true;

    // Start playing if doc is already playing
    if (isPlaying) {
      const playPromise = video.play();
      if (playPromise) {
        playPromise.catch(() => {
          // Autoplay blocked — fine for Playwright seekTo mode
        });
      }
    }

    // Monitor timeupdate to pause at clipEnd
    const handleTimeUpdate = () => {
      if (video.currentTime >= content.clipEnd) {
        video.pause();
        video.currentTime = content.clipEnd;
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.pause();
    };
  }, [content.src, content.clipStart, content.clipEnd]);

  // Sync video play/pause with doc playback state
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hasStartedRef.current) return;

    // Don't resume if clip has already reached its end
    if (video.currentTime >= content.clipEnd) return;

    if (isPlaying) {
      const playPromise = video.play();
      if (playPromise) {
        playPromise.catch(() => {});
      }
    } else {
      video.pause();
    }
  }, [isPlaying, content.clipEnd]);

  return (
    <g className="block-layer block-layer--video" data-layer-id={layer.id}>
      <foreignObject x={finalX} y={finalY} width={width} height={height}>
        <video
          ref={videoRef}
          src={src}
          poster={posterSrc}
          muted
          playsInline
          preload="auto"
          data-clip-start={content.clipStart}
          data-clip-end={content.clipEnd}
          style={{
            width: '100%',
            height: '100%',
            objectFit: content.fit || 'cover',
            objectPosition: 'center',
            display: 'block',
            pointerEvents: 'none',
          }}
        />
      </foreignObject>
    </g>
  );
}

/**
 * Resolve a position value (number or percentage string) to pixels.
 */
function resolveValue(value: number | string, dimension: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.endsWith('%')) {
    return (parseFloat(value) / 100) * dimension;
  }
  return parseFloat(value as string);
}

/**
 * Get offset based on anchor point.
 */
function getAnchorOffset(
  anchor: string | undefined,
  width: number,
  height: number
): { x: number; y: number } {
  switch (anchor) {
    case 'center':
      return { x: -width / 2, y: -height / 2 };
    case 'top-right':
      return { x: -width, y: 0 };
    case 'bottom-left':
      return { x: 0, y: -height };
    case 'bottom-right':
      return { x: -width, y: -height };
    case 'top-left':
    default:
      return { x: 0, y: 0 };
  }
}

export default VideoLayer;