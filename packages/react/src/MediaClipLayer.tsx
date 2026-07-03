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
 * frames are captured without sound and audio is muxed offline). Video clips
 * play muted — their audio, if any, is reproduced by the export mux.
 */

import { useEffect, useRef } from 'react';
import type { ScheduledClip } from '@bendyline/squisq/schemas';
import { useMediaUrl } from './hooks/MediaContext';
import { useMediaSchedule } from './hooks/useMediaSchedule';

/** Re-seek an element only when it drifts this far from its target (seconds). */
const DRIFT = 0.25;

export interface MediaClipLayerProps {
  schedule: ScheduledClip[];
  currentTime: number;
  isPlaying: boolean;
  basePath: string;
  renderMode?: boolean;
}

export function MediaClipLayer({
  schedule,
  currentTime,
  isPlaying,
  basePath,
  renderMode = false,
}: MediaClipLayerProps) {
  const { renderClips, activeIds } = useMediaSchedule(schedule, currentTime);
  if (renderClips.length === 0) return null;
  return (
    <div className="doc-player__media-clips" aria-hidden>
      {renderClips.map((clip) => (
        <MediaClipElement
          key={clip.id}
          clip={clip}
          active={activeIds.has(clip.id)}
          currentTime={currentTime}
          isPlaying={isPlaying}
          basePath={basePath}
          renderMode={renderMode}
        />
      ))}
    </div>
  );
}

interface MediaClipElementProps {
  clip: ScheduledClip;
  active: boolean;
  currentTime: number;
  isPlaying: boolean;
  basePath: string;
  renderMode: boolean;
}

function MediaClipElement({
  clip,
  active,
  currentTime,
  isPlaying,
  basePath,
  renderMode,
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
    if (renderMode || Math.abs(el.currentTime - target) > DRIFT) {
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
  }, [active, currentTime, isPlaying, renderMode, clip.sourceIn, clip.absoluteStart]);

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
        muted
        playsInline
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          zIndex: 0,
          pointerEvents: 'none',
        }}
      />
    );
  }

  return (
    <audio {...common} muted={renderMode} style={{ position: 'absolute', width: 0, height: 0 }} />
  );
}
