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
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { RefObject } from 'react';
import type { AudioTrack } from '@bendyline/squisq/schemas';
import type { AudioController } from './AudioController';

export type AudioSyncMode = 'media' | 'synthetic';

function resolveAudioUrl(src: string, basePath: string): string {
  // Preserve absolute/protocol-relative/data/blob URLs. Prefixing an absolute
  // URL with the common default base path (`.`) produces `./https://...`.
  if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(src)) return src;
  if (!basePath) return src;
  return `${basePath.replace(/\/$/, '')}/${src.replace(/^\//, '')}`;
}

export function useAudioSync(
  audioRef: RefObject<HTMLAudioElement>,
  audioTrack: AudioTrack | undefined,
  basePath: string = '',
  enabled: boolean = true,
  mode: AudioSyncMode = 'media',
): AudioController {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSegment, setCurrentSegment] = useState(0);
  const [isEnded, setIsEnded] = useState(false);
  const [isAudioReady, setIsAudioReady] = useState(false);
  const [totalDuration, setTotalDuration] = useState(0);
  const [isAvailable, setIsAvailable] = useState(true);
  const [unavailableMessage, setUnavailableMessage] = useState<string | undefined>();

  // Calculate segment start times
  const segmentStarts = useRef<number[]>([]);

  // Pending seek time (used when switching segments)
  const pendingSeekTime = useRef<number | null>(null);
  const pendingSeekCompletion = useRef<(() => void) | null>(null);
  const shouldPlayAfterLoad = useRef(false);

  // Preloaded audio blob URLs (for seeking without range request support)
  const blobUrls = useRef<Map<string, string>>(new Map());
  const loadingPromises = useRef<Map<string, Promise<string>>>(new Map());
  const abortControllers = useRef<Set<AbortController>>(new Set());
  const loadGeneration = useRef(0);
  const activeSegmentSrc = useRef<string | undefined>(undefined);
  activeSegmentSrc.current = audioTrack?.segments[currentSegment]?.src;

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
    setCurrentTime(0);
    setCurrentSegment(0);
    setIsPlaying(false);
    setIsEnded(false);
    setIsAudioReady(false);
    setIsAvailable(true);
    setUnavailableMessage(undefined);

    if (!enabled || !audioTrack?.segments) {
      segmentStarts.current = [];
      setTotalDuration(0);
      return;
    }

    let time = 0;
    segmentStarts.current = audioTrack.segments.map((seg) => {
      const start = time;
      time += seg.duration;
      return start;
    });
    setTotalDuration(time);
    if (mode === 'synthetic') setIsAudioReady(true);
  }, [audioTrack, enabled, mode]);

  // Preload audio file as blob (enables seeking without range request support)
  const preloadAudio = useCallback(
    async (src: string): Promise<string> => {
      const audioUrl = resolveAudioUrl(src, basePath);

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
          const response = await fetch(audioUrl, { signal: controller.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
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
          // Fall back to direct URL if blob loading fails
          return audioUrl;
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
    [basePath],
  );

  // Scope requests and blob URLs to the active track. Loading is deliberately
  // demand-driven below: large narrations must not fetch every segment at once.
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
    const handlePause = () => setIsPlaying(false);
    const handleError = () => {
      setIsAudioReady(true);
      setIsPlaying(false);
      setIsAvailable(false);
      setUnavailableMessage('Audio could not be loaded. Check that the media file is available.');
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
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [audioRef, currentSegment, audioTrack, enabled, mode]);

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
        audio.play().catch((error: unknown) => {
          setIsPlaying(false);
          if (!(error instanceof Error && error.name === 'NotAllowedError')) {
            setIsAvailable(false);
            setUnavailableMessage(
              'Audio playback failed. Check that the media file is supported and available.',
            );
          }
        });
        shouldPlayAfterLoad.current = false;
      }
    };

    // Check if we're already on this source (avoid unnecessary reload)
    // For blob URLs, check by segment src key
    const currentSrc = audio.src;
    const cachedBlobUrl = blobUrls.current.get(segment.src);
    const isSameSource =
      currentSrc && (currentSrc === cachedBlobUrl || currentSrc.endsWith(segment.src));

    let cancelled = false;
    let handleCanPlay: (() => void) | null = null;

    if (!isSameSource) {
      // Need to load new source - use preloaded blob URL
      const loadAndPlay = async () => {
        const blobUrl = await preloadAudio(segment.src);
        if (cancelled) return;

        handleCanPlay = () => {
          if (cancelled) return;
          setIsAudioReady(true);
          applyPendingSeek();
          if (handleCanPlay) audio.removeEventListener('canplay', handleCanPlay);
        };

        audio.addEventListener('canplay', handleCanPlay);
        audio.src = blobUrl;
        audio.load();

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
      applyPendingSeek();
    }

    return () => {
      cancelled = true;
      if (handleCanPlay) audio.removeEventListener('canplay', handleCanPlay);
    };
  }, [audioRef, currentSegment, audioTrack, preloadAudio, enabled, mode]);

  const play = useCallback(async () => {
    if (mode === 'synthetic') {
      fallbackMode.current = true;
      setIsPlaying(true);
      return;
    }
    const audio = audioRef.current;
    if (audio) {
      if (isEnded) {
        // Restart from beginning
        setCurrentSegment(0);
        setIsEnded(false);
      }
      try {
        await audio.play();
        fallbackMode.current = false;
        setIsAvailable(true);
        setUnavailableMessage(undefined);
      } catch (error) {
        fallbackMode.current = false;
        setIsPlaying(false);
        const name = error instanceof Error ? error.name : '';
        if (name !== 'NotAllowedError') {
          setIsAvailable(false);
          setUnavailableMessage(
            'Audio playback failed. Check that the media file is supported and available.',
          );
        }
      }
    }
  }, [audioRef, isEnded, mode]);

  const pause = useCallback(() => {
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

  const seekTo = useCallback(
    async (time: number): Promise<void> => {
      const audio = audioRef.current;
      if (!audioTrack?.segments) return;

      // Clamp time to valid range.
      // When totalDuration is 0 (no audio segments), don't clamp — allow
      // seeking by block timing alone (used in render mode / preview).
      const clampedTime =
        totalDuration > 0 ? Math.max(0, Math.min(time, totalDuration)) : Math.max(0, time);

      // Find which segment this time falls into
      let segmentIndex = 0;
      let segmentStart = 0;
      for (let i = 0; i < audioTrack.segments.length; i++) {
        const segEnd = segmentStart + audioTrack.segments[i].duration;
        if (clampedTime < segEnd) {
          segmentIndex = i;
          break;
        }
        segmentStart = segEnd;
        // Handle edge case: time exactly at end goes to last segment
        if (i === audioTrack.segments.length - 1) {
          segmentIndex = i;
        }
      }

      const wasPlaying = mode === 'synthetic' ? isPlaying : !audio?.paused;
      setIsEnded(false);

      if (!audio && mode === 'media') {
        setCurrentSegment(segmentIndex);
        setCurrentTime(clampedTime);
        return;
      }

      // Check if we need to switch segments
      if (segmentIndex !== currentSegment) {
        // Store pending seek time - will be applied after segment loads
        pendingSeekTime.current = clampedTime;
        shouldPlayAfterLoad.current = wasPlaying;
        const completion = new Promise<void>((resolve) => {
          pendingSeekCompletion.current?.();
          pendingSeekCompletion.current = resolve;
        });
        setCurrentSegment(segmentIndex);
        if (mode === 'synthetic') {
          setCurrentTime(clampedTime);
          pendingSeekTime.current = null;
          pendingSeekCompletion.current?.();
          pendingSeekCompletion.current = null;
        }
        await completion;
      } else {
        // Same segment - seek directly
        const segmentTime = clampedTime - segmentStart;
        if (audio && mode === 'media') audio.currentTime = Math.max(0, segmentTime);
        setCurrentTime(clampedTime);
      }
    },
    [audioRef, audioTrack, currentSegment, isPlaying, mode, totalDuration],
  );

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
