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
 * ## The clip's edit recipe
 *
 * A video laid out in a slide is not a scheduled clip, so this layer applies
 * its recipe itself (`content.cuts`, `content.edits`):
 *
 * - **cuts** — the doc clock maps to source time through the cuts, a playing
 *   video that runs into a cut jumps to its far side, and `data-cuts` tells
 *   the seekTo handler the same. Every mode.
 * - **crop** — `object-view-box` live, `data-crop` for frame capture. Every mode.
 * - **gain and fades** — set as the element's level. Timed playback follows
 *   the fades; a viewer-driven clip gets the gain once and is then theirs.
 * - **processed audio** (`fx`) — timed playback mutes the video and plays the
 *   clip's render beside it, on the same clock: the render is sample-aligned
 *   with the source, so the same instant is the same sound. A viewer-driven
 *   clip keeps its own sound, so its native volume and mute controls mean
 *   what they say.
 *
 * Related Files:
 * - schemas/Doc.ts — VideoLayer type definition
 * - shared/doc/templates/videoWithCaption.ts — template producing VideoLayers
 * - site/src/components/doc/DocPlayer.tsx — seekTo handler for video sync
 * - site/src/components/doc/layers/ImageLayer.tsx — similar foreignObject pattern
 * - mediaRecipePlayback.ts — the recipe pieces shared with the inline players
 */

import { useContext, useEffect, useMemo, useRef } from 'react';
import {
  createMediaTimeMap,
  hasRenderableFx,
  serializeMediaCrop,
  serializeMediaCuts,
} from '@bendyline/squisq/mediaEdit';
import type { MediaClip, VideoLayer as VideoLayerType } from '@bendyline/squisq/schemas';
import { isCaptureDrivenVideo } from '../docPlayer/renderReadiness';
import { ProcessedAudioContext, useMediaUrl } from '../hooks/MediaContext';
import {
  applyMediaLevel,
  mediaCropStyle,
  recipeLevelAt,
  useCutTimeMap,
  useSkipCuts,
} from '../mediaRecipePlayback';
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
  const edits = content.edits;
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const hasStartedRef = useRef(false);
  const isPlayer = mode === 'player';

  // Seconds into the block before this clip begins. Until then the video is
  // held (paused) at its in-point so a `startAt` offset reads as a delay.
  const startAt = content.startAt ?? 0;
  const gated = blockTime < startAt;

  // Source time ↔ played time through the clip's cuts; null for an uncut clip.
  const cutsKey = content.cuts?.length ? serializeMediaCuts(content.cuts) : '';
  const timeMap = useCutTimeMap(content.cuts, content.clipStart);
  // How long the clip plays, cuts skipped — where its fade-out is measured from.
  const playedDuration = useMemo(
    () =>
      createMediaTimeMap({
        clipStart: content.clipStart,
        clipEnd: content.clipEnd,
        cuts: content.cuts,
      }).playedDuration,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cutsKey stands for content.cuts
    [content.clipStart, content.clipEnd, cutsKey],
  );

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

  // The clip's processed-audio render, when its recipe has a signal chain and
  // the host has rendered it. Only timed playback swaps the sound (see above).
  const processedAudio = useContext(ProcessedAudioContext);
  const processedPath = useMemo(() => {
    if (isPlayer || !processedAudio || !hasRenderableFx(edits?.fx)) return '';
    const clip: MediaClip = {
      id: layer.id,
      src: content.src,
      kind: 'video',
      startAt: 0,
      anchor: 'block',
      edits,
    };
    return processedAudio(clip) ?? '';
  }, [isPlayer, processedAudio, edits, layer.id, content.src]);
  const resolvedProcessed = useMediaUrl(processedPath, basePath);
  const processedUrl = processedPath ? resolvedProcessed : '';
  const companion = processedUrl !== '';

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

  // The processed track starts where the picture does and stops with the layer.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !companion) return;
    audio.currentTime = content.clipStart;
    return () => audio.pause();
  }, [companion, processedUrl, content.clipStart]);

  // Sync video time + play/pause with the doc clock, honoring the startAt
  // gate. The time correction matters when a synchronized audience player is
  // opened partway through a block: its video must join at the main player's
  // current frame rather than restarting from clipStart.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hasStartedRef.current || isPlayer) return;
    // The processed track shares the source's clock, so it follows the same target.
    const audio = companion ? audioRef.current : null;

    const played = Math.max(0, blockTime - startAt);
    const targetTime = gated
      ? content.clipStart
      : Math.min(
          content.clipEnd,
          timeMap ? timeMap.playedToSource(played) : content.clipStart + played,
        );
    if (
      !isCaptureDrivenVideo(video) &&
      Math.abs(video.currentTime - targetTime) > VIDEO_SYNC_DRIFT_SECONDS
    ) {
      video.currentTime = targetTime;
    }
    if (audio && Math.abs(audio.currentTime - targetTime) > VIDEO_SYNC_DRIFT_SECONDS) {
      audio.currentTime = targetTime;
    }

    // Before the clip's startAt offset, hold at the in-point.
    if (gated) {
      video.pause();
      audio?.pause();
      return;
    }

    // Don't resume if the document clock has already reached the clip end.
    if (targetTime >= content.clipEnd) {
      video.pause();
      audio?.pause();
      return;
    }

    if (isPlaying) {
      for (const element of [video, audio]) {
        const playPromise = element?.play();
        if (playPromise) playPromise.catch(() => {});
      }
    } else if (!isCaptureDrivenVideo(video)) {
      video.pause();
      audio?.pause();
    }
  }, [
    isPlaying,
    gated,
    blockTime,
    startAt,
    src,
    content.clipStart,
    content.clipEnd,
    isPlayer,
    timeMap,
    companion,
    processedUrl,
  ]);

  // A playing element that runs into a cut jumps to its far side at once. The
  // sync above corrects against the doc clock, but only when that clock ticks
  // and only past its drift allowance — long enough to show a cut section —
  // and a viewer-driven clip has no clock at all.
  useSkipCuts(videoRef, timeMap, src);
  useSkipCuts(audioRef, companion ? timeMap : null, processedUrl);

  // Gain and fades, on whichever element is heard. A clip with neither is
  // left alone, so a viewer's own volume setting is never overwritten.
  const hasLevel = Boolean(edits?.gain || edits?.fadeIn || edits?.fadeOut);
  const level = !hasLevel
    ? 1
    : isPlayer
      ? recipeLevelAt({ gain: edits?.gain }, 0, Number.POSITIVE_INFINITY)
      : recipeLevelAt(edits ?? {}, Math.max(0, blockTime - startAt), playedDuration);
  useEffect(() => {
    if (!hasLevel) return;
    const heard = companion ? audioRef.current : videoRef.current;
    if (heard) applyMediaLevel(heard, level);
  }, [hasLevel, level, companion, src, processedUrl]);

  return (
    <g className="block-layer block-layer--video" data-layer-id={layer.id}>
      <foreignObject x={finalX} y={finalY} width={width} height={height}>
        <video
          ref={videoRef}
          src={src}
          poster={posterSrc}
          // With a processed track beside it, the picture's own sound is off.
          muted={muted || companion}
          playsInline
          // Frame capture reads the crop from here; the live view crops via object-view-box.
          data-crop={edits?.crop ? serializeMediaCrop(edits.crop) : undefined}
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
                'data-cuts': cutsKey || undefined,
              })}
          style={{
            width: `${width}px`,
            height: `${height}px`,
            objectFit: content.fit || 'cover',
            objectPosition: 'center',
            display: 'block',
            pointerEvents: isPlayer ? undefined : 'none',
            ...mediaCropStyle(edits?.crop),
          }}
        />
        {companion && (
          <audio
            ref={audioRef}
            src={processedUrl}
            preload="auto"
            muted={muted}
            data-processed-audio=""
          />
        )}
      </foreignObject>
    </g>
  );
}

export default VideoLayer;
