/**
 * VideoLayer Component
 *
 * Renders a video clip layer within an SVG block. Uses an HTML5 <video> element
 * inside a <foreignObject> (same pattern as ImageLayer for cover-mode images).
 * Video audio follows the player-level mute contract. Interactive playback
 * lets recorded clips carry their own audio, while muted/render callers keep
 * the layer silent.
 *
 * Modes of operation, chosen by the host (`VideoClipMode`):
 * 1. `timed` (default) normal playback: Video auto-plays from clipStart to
 *    clipEnd on mount, pausing when the clip ends or when the block is no
 *    longer active.
 * 2. `timed` render/seekTo mode (Playwright frame capture): Video is paused and
 *    seeked programmatically via data attributes read by DocPlayer's seekTo
 *    handler.
 * 3. `player`: the viewer drives the clip with native controls, from its
 *    in-point to the end of the source. For a slideshow's current slide, whose
 *    clock is stepped by hand and never runs, so a timed clip would sit on its
 *    first frame.
 *
 * A timed <video> carries data-clip-start and data-clip-end attributes so the
 * seekTo handler can calculate the correct video time for any doc time.
 *
 * Related Files:
 * - schemas/Doc.ts — VideoLayer type definition
 * - shared/doc/templates/videoWithCaption.ts — template producing VideoLayers
 * - site/src/components/doc/DocPlayer.tsx — seekTo handler for video sync
 * - site/src/components/doc/layers/ImageLayer.tsx — similar foreignObject pattern
 */

import { useRef, useEffect } from 'react';
import type { VideoLayer as VideoLayerType } from '@bendyline/squisq/schemas';
import { isCaptureDrivenVideo } from '../docPlayer/renderReadiness';
import { useMediaUrl } from '../hooks/MediaContext';
import { resolveValue, getAnchorOffset } from '../utils/layerUtils';

const VIDEO_SYNC_DRIFT_SECONDS = 0.2;

/** How a video clip plays: on the doc clock, or by the viewer's hand. */
export type VideoClipMode = 'timed' | 'player';

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
  /** Silence the video's own audio track. */
  muted?: boolean;
  /** How the clip plays (see the component docs). Default `timed`. */
  mode?: VideoClipMode;
}

export function VideoLayer({
  layer,
  basePath,
  viewport,
  blockTime,
  isPlaying,
  muted = false,
  mode = 'timed',
}: VideoLayerProps) {
  const { content, position } = layer;
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasStartedRef = useRef(false);
  const isPlayer = mode === 'player';

  // Seconds into the block before this clip begins. Until then the video is
  // held (paused) at its in-point so a `startAt` offset reads as a delay.
  const startAt = content.startAt ?? 0;
  const gated = blockTime < startAt;

  // Resolve position values to pixels
  const x = resolveValue(position.x, viewport.width);
  const y = resolveValue(position.y, viewport.height);
  const width = position.width ? resolveValue(position.width, viewport.width) : viewport.width;
  const height = position.height ? resolveValue(position.height, viewport.height) : viewport.height;

  // Apply anchor offset
  const offset = getAnchorOffset(position.anchor, width, height);
  const finalX = x + offset.x;
  const finalY = y + offset.y;

  // Resolve video URL via MediaProvider (if available), falling back to basePath
  const src = useMediaUrl(content.src, basePath);

  // Always call the hook (Rules of Hooks), but pass empty string when no poster
  const resolvedPoster = useMediaUrl(content.posterSrc || '', basePath);
  const posterSrc = content.posterSrc ? resolvedPoster : undefined;

  // On mount: seek to clipStart and set up clipEnd boundary.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Set initial time to clipStart
    video.currentTime = content.clipStart;
    hasStartedRef.current = true;

    // A clip the viewer drives has no clock to follow and no block-length
    // out-point to stop at.
    if (isPlayer) return () => video.pause();

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isPlaying is handled by the separate sync effect below
  }, [src, content.clipStart, content.clipEnd, isPlayer]);

  // Sync video time + play/pause with the doc clock, honoring the startAt
  // gate. The time correction matters when a synchronized audience player is
  // opened partway through a block: its video must join at the main player's
  // current frame rather than restarting from clipStart.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hasStartedRef.current || isPlayer) return;

    const targetTime = gated
      ? content.clipStart
      : Math.min(content.clipEnd, content.clipStart + Math.max(0, blockTime - startAt));
    if (
      !isCaptureDrivenVideo(video) &&
      Math.abs(video.currentTime - targetTime) > VIDEO_SYNC_DRIFT_SECONDS
    ) {
      video.currentTime = targetTime;
    }

    // Before the clip's startAt offset, hold at the in-point.
    if (gated) {
      video.pause();
      return;
    }

    // Don't resume if the document clock has already reached the clip end.
    if (targetTime >= content.clipEnd) {
      video.pause();
      return;
    }

    if (isPlaying) {
      const playPromise = video.play();
      if (playPromise) {
        playPromise.catch(() => {});
      }
    } else if (!isCaptureDrivenVideo(video)) {
      video.pause();
    }
  }, [isPlaying, gated, blockTime, startAt, src, content.clipStart, content.clipEnd, isPlayer]);

  return (
    <g className="block-layer block-layer--video" data-layer-id={layer.id}>
      <foreignObject x={finalX} y={finalY} width={width} height={height}>
        <video
          ref={videoRef}
          src={src}
          poster={posterSrc}
          muted={muted}
          playsInline
          {...(isPlayer
            ? {
                controls: true,
                preload: 'metadata',
                'aria-label': content.alt || undefined,
                // A drag on the seek bar scrubs the clip rather than swiping slides.
                'data-no-swipe': '',
              }
            : {
                preload: 'auto',
                'data-clip-start': content.clipStart,
                'data-clip-end': content.clipEnd,
                'data-start-at': startAt,
              })}
          style={{
            width: `${width}px`,
            height: `${height}px`,
            objectFit: content.fit || 'cover',
            objectPosition: 'center',
            display: 'block',
            pointerEvents: isPlayer ? undefined : 'none',
          }}
        />
      </foreignObject>
    </g>
  );
}

export default VideoLayer;
