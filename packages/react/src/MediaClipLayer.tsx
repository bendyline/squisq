/**
 * MediaClipLayer
 *
 * Player-level audio/video elements for the media-clip schedule. Renders one
 * element per scheduled clip (audio, or document-spanning video) and keeps each
 * mounted so re-entry doesn't reload; the drive effect seeks/plays only the
 * clips active at the current time. Multiple concurrent clips (e.g. a
 * document-spanning narration plus a block clip) are independent elements and
 * the browser mixes their output.
 *
 * Audio clips play unmuted during live playback (silent in render mode, where
 * frames are captured without sound and audio is muxed offline). Scheduled
 * video follows the same live-player mute contract, so an independent overlay
 * may carry its audio across block boundaries.
 */

import { useEffect, useRef } from 'react';
import type { ScheduledClip } from '@bendyline/squisq/schemas';
import { useMediaUrl } from './hooks/MediaContext';
import { useMediaSchedule } from './hooks/useMediaSchedule';
import type { PipPosition, PipShape, VideoPresentation } from './types';

/** Re-seek an element only when it drifts this far from its target (seconds). */
const DRIFT = 0.25;

export interface MediaClipLayerProps {
  schedule: ScheduledClip[];
  currentTime: number;
  isPlaying: boolean;
  basePath: string;
  renderMode?: boolean;
  /** Silence every scheduled clip during live playback. */
  muted?: boolean;
  /** Placement of video clips relative to the rendered document. */
  presentation?: VideoPresentation;
  /** Shape of a picture-in-guide? */
  pipShape?: PipShape;
  /** Corner occupied by picture-in-picture video. */
  pipPosition?: PipPosition;
  /** Honor each scheduled video's authored placement override. Default true. */
  honorClipPresentation?: boolean;
}

export function MediaClipLayer({
  schedule,
  currentTime,
  isPlaying,
  basePath,
  renderMode = false,
  muted = false,
  presentation = 'background',
  pipShape = 'rounded',
  pipPosition = 'bottom-right',
  honorClipPresentation = true,
}: MediaClipLayerProps) {
  const { renderClips, activeIds } = useMediaSchedule(schedule, currentTime);
  if (renderClips.length === 0) return null;

  const groups = new Map<VideoPresentation, ScheduledClip[]>();
  for (const clip of renderClips) {
    const clipPresentation =
      honorClipPresentation && clip.kind === 'video'
        ? clip.placement === 'picture-in-picture'
          ? 'picture-in-picture'
          : clip.placement === 'overlay'
            ? 'full-frame'
            : presentation
        : presentation;
    const group = groups.get(clipPresentation) ?? [];
    group.push(clip);
    groups.set(clipPresentation, group);
  }

  return (
    <>
      {[...groups].map(([groupPresentation, clips]) => (
        <div
          key={groupPresentation}
          className={`doc-player__media-clips doc-player__media-clips--${groupPresentation}`}
          data-presentation={groupPresentation}
          data-pip-shape={pipShape}
          data-pip-position={pipPosition}
          aria-hidden
        >
          {clips.map((clip) => (
            <MediaClipElement
              key={clip.id}
              clip={clip}
              active={activeIds.has(clip.id)}
              currentTime={currentTime}
              isPlaying={isPlaying}
              basePath={basePath}
              renderMode={renderMode}
              muted={muted}
            />
          ))}
        </div>
      ))}
    </>
  );
}

interface MediaClipElementProps {
  clip: ScheduledClip;
  active: boolean;
  currentTime: number;
  isPlaying: boolean;
  basePath: string;
  renderMode: boolean;
  muted: boolean;
}

function MediaClipElement({
  clip,
  active,
  currentTime,
  isPlaying,
  basePath,
  renderMode,
  muted,
}: MediaClipElementProps) {
  const ref = useRef<HTMLMediaElement | null>(null);
  const src = useMediaUrl(clip.src, basePath);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!active) {
      if (!el.paused) el.pause();
      return;
    }
    const target = Math.max(0, clip.sourceIn + (currentTime - clip.absoluteStart));
    // While paused, currentTime is being driven by a seek/scrub rather than
    // natural playback. Always select the exact requested frame in that case;
    // the drift tolerance remains useful while playing to avoid fighting the
    // media element's own clock on every animation frame.
    if (renderMode || !isPlaying || Math.abs(el.currentTime - target) > DRIFT) {
      try {
        el.currentTime = target;
      } catch {
        // Seeking before metadata loads throws; the next tick retries.
      }
    }
    if (isPlaying && !renderMode) {
      const p = el.play();
      if (p) p.catch(() => {});
    } else {
      el.pause();
    }
  }, [active, currentTime, isPlaying, renderMode, clip.sourceIn, clip.absoluteStart, src]);

  const isVideo = clip.kind === 'video';
  const common = {
    ref: ref as React.RefObject<never>,
    src,
    preload: 'auto' as const,
    'data-clip-id': clip.id,
    'data-abs-start': clip.absoluteStart,
    'data-abs-end': clip.absoluteEnd,
    'data-source-in': clip.sourceIn,
  };

  if (isVideo) {
    // Document-spanning video renders full-bleed behind the blocks.
    return (
      <video
        {...common}
        className={`doc-player__media-video${active ? ' doc-player__media-video--active' : ''}`}
        data-active={active ? 'true' : 'false'}
        data-video-placement={clip.placement ?? 'default'}
        muted={renderMode || muted}
        playsInline
        style={{ pointerEvents: 'none' }}
      />
    );
  }

  return (
    <audio
      {...common}
      muted={renderMode || muted}
      style={{ position: 'absolute', width: 0, height: 0 }}
    />
  );
}
