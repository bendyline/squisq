/**
 * useAudioSync Hook
 *
 * Synchronizes playback state with an audio element. Provides current
 * playback time, playing state, and methods to control audio playback.
 *
 * Handles multiple audio segments (MP3 files) by tracking which segment
 * is currently playing and calculating the overall timeline position.
 *
 * This is the HTML5 Audio implementation of the AudioController interface.
 * Hosts that drive audio through an external player (e.g. a native shell)
 * can supply their own AudioController to DocPlayer instead of this hook.
 *
 * In `synthetic` mode there is no audio element to follow, so a caller that
 * has no segments passes `syntheticDuration` — the document's own timeline
 * length — and the same segment machinery drives a timer instead.
 *
 * Each segment is downloaded whole and attached as a blob URL, so a segment is
 * only playable once its download finishes. A `play()` that arrives earlier (a
 * listener pressing Play right away, or right after seeking into another
 * segment) is recorded as intent and started by the load path on `canplay`.
 * Playing the element immediately would either start an element with no
 * source, whose pending play the attaching `load()` aborts, or start the
 * previous segment. An `AbortError` from `play()` therefore means "superseded",
 * never "unavailable". Seeks are handled the same way: a seek into a segment
 * that is still loading moves the pending position (a scrub drag keeps
 * seeking after it crosses a chapter boundary), because the element still
 * holds the previous segment. The next segment is downloaded shortly before the
 * current one ends, so chapter boundaries do not stall on a fresh download.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import type { RefObject } from 'react';
import type { AudioTrack } from '@bendyline/squisq/schemas';
import { fetchResourceBytes, isResourceUrlAllowed } from '@bendyline/squisq/markdown';
import type { AudioController } from './AudioController';
import { calculateSegmentTiming, findSegmentAtTime } from './AudioController';
import { useResourcePolicy } from './MediaContext';

export type AudioSyncMode = 'media' | 'synthetic';

/**
 * Backstop for a cross-segment seek whose completion is driven by media events.
 * `applyPendingSeek` normally settles the promise on `canplay` (or an immediate
 * `readyState` check), and load failures settle it explicitly — but a media
 * element that never reports either state must not strand `await seekTo(...)`
 * (and therefore `restart()`) forever. The blob is fully fetched before the src
 * is assigned, so a healthy decode is near-instant and never reaches this.
 */
const SEEK_COMPLETION_TIMEOUT_MS = 15_000;

const UNLOADABLE_MESSAGE = 'Audio could not be loaded. Check that the media file is available.';
const PLAYBACK_FAILED_MESSAGE =
  'Audio playback failed. Check that the media file is supported and available.';

/**
 * How far before the end of a segment the next one starts downloading. A
 * narration segment is around a megabyte, which takes well over ten seconds
 * on a slow mobile connection; one segment ahead keeps memory bounded.
 */
const NEXT_SEGMENT_WARM_LEAD_SECONDS = 30;

/**
 * Whether a rejected `play()` leaves the media usable. `NotAllowedError`
 * (autoplay policy) and `AbortError` (a newer `load()` or `pause()` superseded
 * the request) say nothing about the media itself; anything else is a real
 * playback failure.
 */
function isBenignPlayRejection(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'NotAllowedError' || error.name === 'AbortError';
}

function resolveAudioUrl(src: string, basePath: string): string {
  // Preserve absolute/protocol-relative/data/blob URLs. Prefixing an absolute
  // URL with the common default base path (`.`) produces `./https://...`.
  if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(src)) return src;
  if (!basePath) return src;
  return `${basePath.replace(/\/$/, '')}/${src.replace(/^\//, '')}`;
}

export function useAudioSync(
  audioRef: RefObject<HTMLAudioElement>,
  track: AudioTrack | undefined,
  basePath: string = '',
  enabled: boolean = true,
  mode: AudioSyncMode = 'media',
  syntheticDuration: number = 0,
): AudioController {
  // A synthetic clock is asked for precisely when the document has no audio
  // asset, yet every timing path here — `totalDuration`, the fallback timer's
  // arming condition, the scrubber — reads the segment list. With none, the
  // clock length is 0 and `play()` flips `isPlaying` on a timeline that never
  // advances: the player shows a pause button frozen at 0:00 / 0:00 on the
  // first block. Standing in one segment spanning the caller's document
  // duration keeps that single source of timing truth. The srcless segment is
  // never fetched — every media path below returns early in synthetic mode.
  const audioTrack = useMemo(() => {
    if (mode !== 'synthetic' || track?.segments?.length || syntheticDuration <= 0) return track;
    return {
      ...track,
      segments: [{ src: '', name: 'synthetic', duration: syntheticDuration, startTime: 0 }],
    };
  }, [track, mode, syntheticDuration]);

  const resourcePolicy = useResourcePolicy();
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSegment, setCurrentSegment] = useState(0);
  const [isEnded, setIsEnded] = useState(false);
  const [isAudioReady, setIsAudioReady] = useState(false);
  const [totalDuration, setTotalDuration] = useState(0);
  const [isAvailable, setIsAvailable] = useState(true);
  const [unavailableMessage, setUnavailableMessage] = useState<string | undefined>();
  // Whether the element is actually producing sound (`playing` fired and no
  // pause, stall or reload since). `isPlaying` reflects the listener's intent,
  // so the gap between the two is the time spent buffering.
  const [isAudioFlowing, setIsAudioFlowing] = useState(false);

  // Calculate segment start times
  const segmentStarts = useRef<number[]>([]);

  // Pending seek time (used when switching segments)
  const pendingSeekTime = useRef<number | null>(null);
  const pendingSeekCompletion = useRef<(() => void) | null>(null);
  // The promise a cross-segment `seekTo` returns, so a seek that retargets it
  // while the segment is still loading can wait for the same load.
  const pendingSeekPromise = useRef<Promise<void> | null>(null);
  const shouldPlayAfterLoad = useRef(false);

  // Preloaded audio blob URLs (for seeking without range request support)
  const blobUrls = useRef<Map<string, string>>(new Map());
  const loadingPromises = useRef<Map<string, Promise<string>>>(new Map());
  const abortControllers = useRef<Set<AbortController>>(new Set());
  const loadGeneration = useRef(0);
  const activeSegmentSrc = useRef<string | undefined>(undefined);
  activeSegmentSrc.current = audioTrack?.segments[currentSegment]?.src;

  // Which segment the <audio> element is currently bound to, and the URL that
  // was actually assigned (read back post-assignment so it is comparable to the
  // element's own resolved `src`). Identity here is exact: matching the segment
  // key by URL suffix instead would let `1.mp3` claim a loaded `.../11.mp3`,
  // skip the load, and seek inside the wrong file.
  const boundSource = useRef<{ key: string; url: string } | null>(null);

  // The segment whose download is in flight on its way to the element. While
  // it is set and not yet bound, `play()` records intent instead of playing.
  // Cleared when that load binds or fails, so a failed segment falls back to
  // a direct `play()` attempt rather than waiting forever.
  const loadingSegment = useRef<string | null>(null);

  // The next segment already asked for during this segment's playback, so the
  // look-ahead download starts once rather than on every `timeupdate`.
  const warmedNextSegment = useRef<string | null>(null);

  // `seekTo` and `play` are awaited across state commits, so a caller can still
  // hold a callback captured before the segment changed (`restart` awaits
  // `seekTo` and then calls the `play` from that same render). Reading the live
  // segment from a ref keeps a stale closure from mistaking an already-applied
  // switch for a new one — which would set a pending seek that no effect ever
  // consumes, hanging the returned promise.
  const currentSegmentRef = useRef(0);
  currentSegmentRef.current = currentSegment;

  // Fallback timer: when audio.play() is blocked (e.g., autoplay policy),
  // advance currentTime synthetically so blocks still progress without audio.
  const fallbackMode = useRef(false);

  useEffect(() => {
    loadGeneration.current += 1;
    pendingSeekTime.current = null;
    pendingSeekCompletion.current?.();
    pendingSeekCompletion.current = null;
    shouldPlayAfterLoad.current = false;
    fallbackMode.current = false;
    // The previous track's blob URLs are revoked by the cleanup below, so any
    // binding to them is stale — a new track reusing a segment name must load.
    boundSource.current = null;
    loadingSegment.current = null;
    warmedNextSegment.current = null;
    setCurrentTime(0);
    setCurrentSegment(0);
    setIsPlaying(false);
    setIsEnded(false);
    setIsAudioReady(false);
    setIsAvailable(true);
    setUnavailableMessage(undefined);
    setIsAudioFlowing(false);

    if (!enabled || !audioTrack?.segments) {
      segmentStarts.current = [];
      setTotalDuration(0);
      return;
    }

    const timing = calculateSegmentTiming(audioTrack.segments);
    segmentStarts.current = timing.segmentStarts;
    setTotalDuration(timing.totalDuration);
    if (mode === 'synthetic') setIsAudioReady(true);
  }, [audioTrack, enabled, mode]);

  // Preload audio file as blob (enables seeking without range request support)
  const preloadAudio = useCallback(
    async (src: string): Promise<string> => {
      const audioUrl = resolveAudioUrl(src, basePath);
      if (!isResourceUrlAllowed(audioUrl, resourcePolicy)) return '';

      // Return cached blob URL if available
      if (blobUrls.current.has(src)) {
        const cached = blobUrls.current.get(src)!;
        // Refresh insertion order so the bounded cache behaves as an LRU.
        blobUrls.current.delete(src);
        blobUrls.current.set(src, cached);
        return cached;
      }

      // Return existing loading promise if in progress
      if (loadingPromises.current.has(src)) {
        return loadingPromises.current.get(src)!;
      }

      // Start loading
      const controller = new AbortController();
      abortControllers.current.add(controller);
      const generation = loadGeneration.current;
      const loadPromise = (async () => {
        try {
          const resource = await fetchResourceBytes(audioUrl, {
            policy: resourcePolicy,
            signal: controller.signal,
            contentTypePrefixes: ['audio/', 'video/', 'application/octet-stream'],
          });
          const blob = new Blob([resource.bytes.slice().buffer as ArrayBuffer], {
            type: resource.contentType || 'application/octet-stream',
          });
          const blobUrl = URL.createObjectURL(blob);
          if (controller.signal.aborted || generation !== loadGeneration.current) {
            URL.revokeObjectURL(blobUrl);
            return audioUrl;
          }
          blobUrls.current.set(src, blobUrl);
          while (blobUrls.current.size > 2) {
            const oldest =
              [...blobUrls.current.entries()].find(([key]) => key !== activeSegmentSrc.current) ??
              (blobUrls.current.entries().next().value as [string, string] | undefined);
            if (!oldest) break;
            blobUrls.current.delete(oldest[0]);
            URL.revokeObjectURL(oldest[1]);
          }
          return blobUrl;
        } catch {
          // Do not bypass policy byte/time limits with an unbounded direct load.
          return '';
        }
      })();

      loadingPromises.current.set(src, loadPromise);
      void loadPromise.then(() => {
        abortControllers.current.delete(controller);
        if (loadingPromises.current.get(src) === loadPromise) {
          loadingPromises.current.delete(src);
        }
      });
      return loadPromise;
    },
    [basePath, resourcePolicy],
  );

  // Scope requests and blob URLs to the active track. Loading is deliberately
  // demand-driven below: large narrations must not fetch every segment at once.
  // Only the active segment loads up front, plus the next one as playback
  // nears the end of the active one (see `handleTimeUpdate`).
  useEffect(() => {
    if (!enabled || !audioTrack?.segments) return;

    // Cleanup blob URLs on unmount
    const currentBlobUrls = blobUrls.current;
    const currentAbortControllers = abortControllers.current;
    const currentLoadingPromises = loadingPromises.current;
    return () => {
      loadGeneration.current += 1;
      currentAbortControllers.forEach((controller) => controller.abort());
      currentAbortControllers.clear();
      currentLoadingPromises.clear();
      currentBlobUrls.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      currentBlobUrls.clear();
    };
  }, [audioTrack, preloadAudio, enabled]);

  // Warm only the active segment. The audio-element effect shares the same
  // in-flight promise, so this also supports hosts that attach the ref later.
  useEffect(() => {
    if (!enabled || mode === 'synthetic') return;
    const segment = audioTrack?.segments[currentSegment];
    if (segment) void preloadAudio(segment.src);
  }, [audioTrack, currentSegment, enabled, mode, preloadAudio]);

  // Handle audio time updates
  useEffect(() => {
    if (!enabled || mode === 'synthetic') return;
    const audio = audioRef.current;
    if (!audio) return;
    // A new active segment (including one revisited after a seek) gets its own
    // look-ahead; the download itself is deduplicated by `preloadAudio`.
    warmedNextSegment.current = null;

    const handleTimeUpdate = () => {
      // In fallback mode the <audio> element is NOT the clock — there's no real
      // source (e.g. the editor preview's synthetic, empty-src track), so the
      // synthetic timer and `seekTo` own `currentTime`. A `timeupdate` fired as
      // a side effect of programmatically setting `audio.currentTime` (during a
      // seek) would otherwise clobber the just-seeked position with the empty
      // element's unreliable `currentTime`, snapping the scrubber back.
      if (fallbackMode.current) return;
      // Calculate overall timeline position
      const segmentStart = segmentStarts.current[currentSegment] || 0;
      const overallTime = segmentStart + audio.currentTime;
      setCurrentTime(overallTime);

      // Download the next segment before this one ends, so the auto-advance
      // finds it already in hand instead of pausing on a fresh download.
      const active = audioTrack?.segments[currentSegment];
      const next = audioTrack?.segments[currentSegment + 1];
      if (
        active &&
        next &&
        warmedNextSegment.current !== next.src &&
        active.duration - audio.currentTime <= NEXT_SEGMENT_WARM_LEAD_SECONDS
      ) {
        warmedNextSegment.current = next.src;
        void preloadAudio(next.src);
      }
    };

    const handlePlay = () => {
      // Don't clear `fallbackMode` here. Whether the <audio> element is really
      // the clock is decided authoritatively by the play() promise: it only
      // resolves (clearing fallback, see `play`) when a real source actually
      // plays. The 'play' event, by contrast, can fire spuriously on the
      // source-less preview element — and clearing fallback there makes the
      // synthetic timer's tick guard bail on its next frame, freezing the
      // clock and the scrubber after a seek/resume.
      setIsPlaying(true);
    };
    const handlePause = () => {
      setIsPlaying(false);
      setIsAudioFlowing(false);
    };
    const handlePlaying = () => setIsAudioFlowing(true);
    // A mid-segment stall: still playing in intent, but no sound until data arrives.
    const handleWaiting = () => setIsAudioFlowing(false);
    const handleError = () => {
      setIsAudioReady(true);
      setIsPlaying(false);
      setIsAudioFlowing(false);
      setIsAvailable(false);
      setUnavailableMessage(UNLOADABLE_MESSAGE);
      // A source that errors will never reach `canplay`, so any seek awaiting
      // this segment's load has to be settled here or it hangs forever.
      shouldPlayAfterLoad.current = false;
      if (pendingSeekTime.current !== null) {
        setCurrentTime(pendingSeekTime.current);
        pendingSeekTime.current = null;
      }
      pendingSeekCompletion.current?.();
      pendingSeekCompletion.current = null;
    };
    const handleEnded = () => {
      // Move to next segment or end
      if (audioTrack && currentSegment < audioTrack.segments.length - 1) {
        // Auto-advance to next segment
        // Set shouldPlayAfterLoad so the next segment auto-plays after loading
        shouldPlayAfterLoad.current = true;
        setCurrentSegment((prev) => prev + 1);
      } else {
        setIsEnded(true);
        setIsPlaying(false);
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [audioRef, currentSegment, audioTrack, enabled, mode, preloadAudio]);

  // Whether the element is attached to this segment's loaded source. Both the
  // segment key and the assigned URL must match: the key alone would go stale
  // if the element's src were swapped elsewhere, and the URL alone cannot
  // distinguish two segments that resolve to the same file.
  const isBoundTo = useCallback((audio: HTMLAudioElement, segmentKey: string): boolean => {
    const bound = boundSource.current;
    return !!audio.src && bound?.key === segmentKey && bound.url === audio.src;
  }, []);

  // Load new segment when currentSegment changes
  useEffect(() => {
    if (!enabled || mode === 'synthetic') return;
    const audio = audioRef.current;
    if (!audio || !audioTrack?.segments) return;

    const segment = audioTrack.segments[currentSegment];
    if (!segment) return;

    // Apply pending seek and play state
    const applyPendingSeek = () => {
      if (pendingSeekTime.current !== null) {
        const segmentStart = segmentStarts.current[currentSegment] || 0;
        const segmentTime = pendingSeekTime.current - segmentStart;
        audio.currentTime = Math.max(0, segmentTime);
        setCurrentTime(pendingSeekTime.current);
        pendingSeekTime.current = null;
        pendingSeekCompletion.current?.();
        pendingSeekCompletion.current = null;
      }

      if (shouldPlayAfterLoad.current) {
        audio.play().then(
          () => {
            setIsAvailable(true);
            setUnavailableMessage(undefined);
          },
          (error: unknown) => {
            // A pause or another load that superseded this start leaves the
            // state with whoever superseded it.
            if (error instanceof Error && error.name === 'AbortError') return;
            setIsPlaying(false);
            if (!isBenignPlayRejection(error)) {
              setIsAvailable(false);
              setUnavailableMessage(PLAYBACK_FAILED_MESSAGE);
            }
          },
        );
        shouldPlayAfterLoad.current = false;
      }
    };

    // Check if we're already on this source (avoid unnecessary reload).
    const isSameSource = isBoundTo(audio, segment.src);

    let cancelled = false;
    let handleCanPlay: (() => void) | null = null;

    if (!isSameSource) {
      // Need to load new source - use preloaded blob URL
      const loadAndPlay = async () => {
        loadingSegment.current = segment.src;
        const blobUrl = await preloadAudio(segment.src);
        // A cancelled run leaves the marker to the run that replaced it.
        if (cancelled) return;
        loadingSegment.current = null;

        if (!blobUrl) {
          // Policy-blocked or failed fetch: there is no source to hand the
          // element, so `canplay` will never fire. Detach any stale source (a
          // previous segment must not play in this one's place) and settle the
          // pending seek here — otherwise `await seekTo(...)` never returns and
          // `restart()` is dead for the rest of the session.
          audio.removeAttribute('src');
          audio.load();
          boundSource.current = null;
          shouldPlayAfterLoad.current = false;
          setIsAudioReady(true);
          setIsPlaying(false);
          setIsAvailable(false);
          setUnavailableMessage(UNLOADABLE_MESSAGE);
          if (pendingSeekTime.current !== null) {
            // Keep the reported position where the caller asked for it; only
            // the audio is missing, and block timing still drives the doc.
            setCurrentTime(pendingSeekTime.current);
            pendingSeekTime.current = null;
          }
          pendingSeekCompletion.current?.();
          pendingSeekCompletion.current = null;
          return;
        }

        handleCanPlay = () => {
          if (cancelled) return;
          setIsAudioReady(true);
          applyPendingSeek();
          if (handleCanPlay) audio.removeEventListener('canplay', handleCanPlay);
        };

        audio.addEventListener('canplay', handleCanPlay);
        audio.src = blobUrl;
        // Read the src back: the element resolves a relative URL to an absolute
        // one, and the comparison above is against that resolved form.
        boundSource.current = { key: segment.src, url: audio.src };
        audio.load();
        // load() pauses a playing element without firing `pause`. Unless this
        // load was asked to resume (auto-advance, a seek while playing, or a
        // play() that arrived during the download), playback has stopped.
        setIsAudioFlowing(false);
        if (!shouldPlayAfterLoad.current) setIsPlaying(false);

        // If audio is already ready (blob is instant), canplay might not fire
        // Check after a microtask to see if it's ready
        await Promise.resolve();
        if (audio.readyState >= 3) {
          if (handleCanPlay) audio.removeEventListener('canplay', handleCanPlay);
          setIsAudioReady(true);
          applyPendingSeek();
        }
      };

      void loadAndPlay();
    } else {
      // Same source - apply seek directly
      if (loadingSegment.current === segment.src) loadingSegment.current = null;
      applyPendingSeek();
    }

    return () => {
      cancelled = true;
      if (handleCanPlay) audio.removeEventListener('canplay', handleCanPlay);
    };
  }, [audioRef, currentSegment, audioTrack, preloadAudio, enabled, mode, isBoundTo]);

  const seekTo = useCallback(
    async (time: number): Promise<void> => {
      const audio = audioRef.current;
      if (!audioTrack?.segments) return;

      // Clamp time to valid range.
      // When totalDuration is 0 (no audio segments), don't clamp — allow
      // seeking by block timing alone (used in render mode / preview).
      const clampedTime =
        totalDuration > 0 ? Math.max(0, Math.min(time, totalDuration)) : Math.max(0, time);

      // Find which segment this time falls into. `segmentStarts.current` is
      // populated by the track effect; fall back to deriving the starts when it
      // has not been (the hook is disabled, so the effect cleared the ref while
      // seeking by block timing alone stays supported).
      const starts =
        segmentStarts.current.length === audioTrack.segments.length
          ? segmentStarts.current
          : calculateSegmentTiming(audioTrack.segments).segmentStarts;
      const { segmentIndex, segmentStart } = findSegmentAtTime(
        clampedTime,
        audioTrack.segments,
        starts,
      );

      const wasPlaying = mode === 'synthetic' ? isPlaying : !audio?.paused;
      setIsEnded(false);

      if (!audio && mode === 'media') {
        setCurrentSegment(segmentIndex);
        setCurrentTime(clampedTime);
        return;
      }

      // Check if we need to switch segments
      if (segmentIndex !== currentSegmentRef.current) {
        // Store pending seek time - will be applied after segment loads
        pendingSeekTime.current = clampedTime;
        shouldPlayAfterLoad.current = wasPlaying;
        // Mark the target as loading now rather than when the load effect
        // runs, so a play() in between waits for it instead of starting the
        // segment being left.
        if (mode === 'media' && enabled) {
          loadingSegment.current = audioTrack.segments[segmentIndex].src;
        }
        const completion = new Promise<void>((resolve) => {
          pendingSeekCompletion.current?.();
          // Resolve (never reject) so callers such as `restart` — which awaits
          // this seek and then plays — still make progress when the segment
          // cannot load. A rejection here would surface as an unhandled
          // rejection in every fire-and-forget `seekTo(...)` call site.
          let settled = false;
          const settle = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (pendingSeekCompletion.current === settle) pendingSeekCompletion.current = null;
            resolve();
          };
          const timer = setTimeout(settle, SEEK_COMPLETION_TIMEOUT_MS);
          pendingSeekCompletion.current = settle;
        });
        pendingSeekPromise.current = completion;
        setCurrentSegment(segmentIndex);
        if (mode === 'synthetic') {
          setCurrentTime(clampedTime);
          pendingSeekTime.current = null;
          pendingSeekCompletion.current?.();
          pendingSeekCompletion.current = null;
        }
        await completion;
      } else if (pendingSeekTime.current !== null && mode === 'media' && enabled) {
        // The segment is still loading for an earlier cross-segment seek (a
        // scrub drag that crossed a chapter boundary and kept moving). The
        // element still holds the previous segment's source, and the load
        // applies the pending time when it lands, so retarget that instead.
        pendingSeekTime.current = clampedTime;
        setCurrentTime(clampedTime);
        await pendingSeekPromise.current;
      } else {
        // Same segment - seek directly
        const segmentTime = clampedTime - segmentStart;
        if (audio && mode === 'media') audio.currentTime = Math.max(0, segmentTime);
        setCurrentTime(clampedTime);
      }
    },
    [audioRef, audioTrack, enabled, isPlaying, mode, totalDuration],
  );

  // Declared after `seekTo` because replaying an ended track must route through
  // it (see below), and the dependency array is evaluated during render.
  const play = useCallback(async () => {
    if (mode === 'synthetic') {
      fallbackMode.current = true;
      setIsPlaying(true);
      return;
    }
    const audio = audioRef.current;
    if (audio) {
      if (isEnded) {
        // Rewind through the seek machinery rather than just resetting segment
        // state. `setCurrentSegment(0)` does not touch `audio.src` — React has
        // not re-rendered yet — so playing here would blip the LAST segment,
        // and the load effect would then swap the src with no pending seek and
        // no play-after-load flag, stalling with `isPlaying` stuck true.
        // `seekTo` owns the src swap, the seek, and the resume. This mirrors
        // `restart`, which has always been correct for exactly this reason.
        await seekTo(0);
      }

      // The active segment is still downloading: record the intent and let the
      // load path start playback on `canplay` (see the file header).
      const segment = audioTrack?.segments[currentSegmentRef.current];
      if (segment && loadingSegment.current === segment.src && !isBoundTo(audio, segment.src)) {
        shouldPlayAfterLoad.current = true;
        setIsPlaying(true);
        if (!audio.getAttribute('src')) {
          // Nothing is attached yet, so this cannot start anything audible.
          // Calling play() inside the listener's gesture lets engines with
          // per-element gesture rules (WebKit) allow the deferred start; the
          // attaching load() aborts it by design.
          audio.play().catch(() => {});
        }
        return;
      }

      try {
        await audio.play();
        fallbackMode.current = false;
        setIsAvailable(true);
        setUnavailableMessage(undefined);
      } catch (error: unknown) {
        fallbackMode.current = false;
        // A newer load() or pause() superseded this request. The media is fine,
        // and a load asked to resume will start playback itself.
        if (error instanceof Error && error.name === 'AbortError') {
          if (!shouldPlayAfterLoad.current) setIsPlaying(false);
          return;
        }
        setIsPlaying(false);
        if (!isBenignPlayRejection(error)) {
          setIsAvailable(false);
          setUnavailableMessage(PLAYBACK_FAILED_MESSAGE);
        }
      }
    }
  }, [audioRef, audioTrack, isEnded, isBoundTo, mode, seekTo]);

  const pause = useCallback(() => {
    // Cancel a start still waiting on a download as well as live playback.
    shouldPlayAfterLoad.current = false;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
    }
    // Also set state directly for cases where audio isn't loaded
    // (pause event won't fire if audio has no valid source)
    setIsPlaying(false);
  }, [audioRef]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio && mode === 'media') return;

    // Use component state instead of audio.paused to handle cases where
    // audio source isn't loaded (audio.paused is always true without a source)
    if (!isPlaying) {
      play();
    } else {
      pause();
    }
  }, [audioRef, isPlaying, mode, play, pause]);

  const skipToSegment = useCallback(
    (index: number) => {
      if (!audioTrack?.segments || index < 0 || index >= audioTrack.segments.length) {
        return;
      }
      setCurrentSegment(index);
      setIsEnded(false);
    },
    [audioTrack],
  );

  // Restart from beginning
  const restart = useCallback(async () => {
    await seekTo(0);
    await play();
  }, [seekTo, play]);

  // Explicit synthetic-clock mode is used by previews that have timing but no
  // narration asset. Real playback failures never silently enter this mode.
  useEffect(() => {
    if (!isPlaying || !fallbackMode.current || !totalDuration) return;

    let lastTime = performance.now();
    let raf: number;

    const tick = (now: number) => {
      // Audio started playing for real — stop the fallback
      if (!fallbackMode.current) return;

      const dt = (now - lastTime) / 1000;
      lastTime = now;

      setCurrentTime((prev) => {
        const next = prev + dt;
        if (next >= totalDuration) {
          fallbackMode.current = false;
          setIsEnded(true);
          setIsPlaying(false);
          return totalDuration;
        }
        return next;
      });

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, totalDuration]);

  return {
    // State
    currentTime,
    isPlaying,
    currentSegment,
    totalDuration,
    isEnded,
    isReady: isAudioReady,
    isBuffering: mode === 'media' && isPlaying && !isAudioFlowing,
    isAvailable,
    unavailableMessage,
    // Actions
    play,
    pause: async () => pause(),
    toggle: async () => toggle(),
    seekTo,
    skipToSegment: async (index: number) => skipToSegment(index),
    restart,
  };
}

export default useAudioSync;
