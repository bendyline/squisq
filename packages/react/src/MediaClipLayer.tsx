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

import { useEffect, useRef, type CSSProperties } from 'react';
import type { ScheduledClip } from '@bendyline/squisq/schemas';
import { useMediaUrl } from './hooks/MediaContext';
import { useMediaSchedule } from './hooks/useMediaSchedule';
import type { PipPosition, PipShape, PipSize, VideoPresentation } from './types';

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
  /** Size of picture-in-picture video (small or large). */
  pipSize?: PipSize;
  /** Shape of picture-in-picture video (square or 16:9 wide). */
  pipShape?: PipShape;
  /** Corner occupied by picture-in-picture video. */
  pipPosition?: PipPosition;
  /** Orientation of the rendered player viewport. */
  pipOrientation?: 'landscape' | 'portrait';
  /** Resolved theme frame applied directly to PIP video during raster capture. */
  pipFrameStyle?: Pick<CSSProperties, 'border' | 'borderRadius' | 'boxShadow'>;
  /** Honor each scheduled video's authored placement override. Default true. */
  honorClipPresentation?: boolean;
}

function mediaGroupStyle(presentation: VideoPresentation): CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    zIndex: presentation === 'background' ? 0 : 10,
    pointerEvents: 'none',
  };
}

function pipCornerStyle(position: PipPosition): CSSProperties {
  switch (position) {
    case 'top-left':
      return { top: '4%', left: '3%' };
    case 'top-right':
      return { top: '4%', right: '3%' };
    case 'bottom-left':
      return { bottom: '6%', left: '3%' };
    case 'bottom-right':
      return { right: '3%', bottom: '6%' };
  }
}

function pipWidth(size: PipSize, orientation: 'landscape' | 'portrait'): string {
  if (orientation === 'portrait') return size === 'large' ? '23%' : '15%';
  return size === 'large' ? '15%' : '9%';
}

interface MediaVideoStyleOptions {
  presentation: VideoPresentation;
  pipSize: PipSize;
  pipShape: PipShape;
  pipPosition: PipPosition;
  pipOrientation: 'landscape' | 'portrait';
  pipFrameStyle?: Pick<CSSProperties, 'border' | 'borderRadius' | 'boxShadow'>;
  active: boolean;
}

/**
 * Critical scheduled-video compositor styles, kept inline so html2canvas's
 * cloned export tree does not depend on stylesheet selector matching.
 */
function mediaVideoStyle({
  presentation,
  pipSize,
  pipShape,
  pipPosition,
  pipOrientation,
  pipFrameStyle,
  active,
}: MediaVideoStyleOptions): CSSProperties {
  const base: CSSProperties = {
    position: 'absolute',
    display: 'block',
    objectFit: 'cover',
    opacity: active ? 1 : 0,
    visibility: active ? 'visible' : 'hidden',
    pointerEvents: 'none',
  };

  if (presentation !== 'picture-in-picture') {
    return { ...base, inset: 0, width: '100%', height: '100%' };
  }

  return {
    ...base,
    width: pipWidth(pipSize, pipOrientation),
    aspectRatio: pipShape === 'wide' ? '16 / 9' : '1',
    ...pipFrameStyle,
    ...pipCornerStyle(pipPosition),
  };
}

export function MediaClipLayer({
  schedule,
  currentTime,
  isPlaying,
  basePath,
  renderMode = false,
  muted = false,
  presentation = 'background',
  pipSize = 'small',
  pipShape = 'square',
  pipPosition = 'bottom-right',
  pipOrientation = 'landscape',
  pipFrameStyle,
  honorClipPresentation = true,
}: MediaClipLayerProps) {
  const { renderClips, activeIds } = useMediaSchedule(schedule, currentTime);
  if (renderClips.length === 0) return null;

  const groups = new Map<
    string,
    {
      presentation: VideoPresentation;
      pipSize: PipSize;
      pipShape: PipShape;
      pipPosition: PipPosition;
      clips: ScheduledClip[];
    }
  >();
  for (const clip of renderClips) {
    const clipPresentation =
      honorClipPresentation && clip.kind === 'video'
        ? clip.placement === 'picture-in-picture'
          ? 'picture-in-picture'
          : clip.placement === 'overlay'
            ? 'full-frame'
            : presentation
        : presentation;
    const clipPipSize = clip.pipSize ?? pipSize;
    const clipPipShape = clip.pipShape ?? pipShape;
    const clipPipPosition = clip.pipPosition ?? pipPosition;
    const key = `${clipPresentation}:${clipPipSize}:${clipPipShape}:${clipPipPosition}`;
    const group = groups.get(key) ?? {
      presentation: clipPresentation,
      pipSize: clipPipSize,
      pipShape: clipPipShape,
      pipPosition: clipPipPosition,
      clips: [],
    };
    group.clips.push(clip);
    groups.set(key, group);
  }

  return (
    <>
      {[...groups].map(([key, group]) => (
        <div
          key={key}
          className={`doc-player__media-clips doc-player__media-clips--${group.presentation}`}
          data-presentation={group.presentation}
          data-pip-size={group.pipSize}
          data-pip-shape={group.pipShape}
          data-pip-position={group.pipPosition}
          aria-hidden
          style={mediaGroupStyle(group.presentation)}
        >
          {group.clips.map((clip) => (
            <MediaClipElement
              key={clip.id}
              clip={clip}
              active={activeIds.has(clip.id)}
              currentTime={currentTime}
              isPlaying={isPlaying}
              basePath={basePath}
              renderMode={renderMode}
              muted={muted}
              presentation={group.presentation}
              pipSize={group.pipSize}
              pipShape={group.pipShape}
              pipPosition={group.pipPosition}
              pipOrientation={pipOrientation}
              pipFrameStyle={pipFrameStyle}
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
  presentation: VideoPresentation;
  pipSize: PipSize;
  pipShape: PipShape;
  pipPosition: PipPosition;
  pipOrientation: 'landscape' | 'portrait';
  pipFrameStyle?: Pick<CSSProperties, 'border' | 'borderRadius' | 'boxShadow'>;
}

function MediaClipElement({
  clip,
  active,
  currentTime,
  isPlaying,
  basePath,
  renderMode,
  muted,
  presentation,
  pipSize,
  pipShape,
  pipPosition,
  pipOrientation,
  pipFrameStyle,
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
    'data-active': active ? 'true' : 'false',
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
        data-video-placement={clip.placement ?? 'default'}
        muted={renderMode || muted}
        playsInline
        style={mediaVideoStyle({
          presentation,
          pipSize,
          pipShape,
          pipPosition,
          pipOrientation,
          pipFrameStyle,
          active,
        })}
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
