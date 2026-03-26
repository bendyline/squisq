/**
 * useAudioSync Hook
 *
 * Synchronizes playback state with an audio element. Provides current
 * playback time, playing state, and methods to control audio playback.
 *
 * Handles multiple audio segments (MP3 files) by tracking which segment
 * is currently playing and calculating the overall timeline position.
 *
 * This is the HTML5 Audio implementation of the AudioProvider interface.
 * For EFB/MSFS environments, use useCompanionAudioSync instead.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { RefObject } from 'react';
import type { AudioTrack } from '@bendyline/squisq/schemas';
import type { AudioProvider } from './AudioProvider';

export function useAudioSync(
  audioRef: RefObject<HTMLAudioElement>,
  audioTrack: AudioTrack | undefined,
  basePath: string = '',
): AudioProvider {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSegment, setCurrentSegment] = useState(0);
  const [isEnded, setIsEnded] = useState(false);
  const [isAudioReady, setIsAudioReady] = useState(false);
  const [totalDuration, setTotalDuration] = useState(0);

  // Calculate segment start times
  const segmentStarts = useRef<number[]>([]);

  // Pending seek time (used when switching segments)
  const pendingSeekTime = useRef<number | null>(null);
  const shouldPlayAfterLoad = useRef(false);

  // Preloaded audio blob URLs (for seeking without range request support)
  const blobUrls = useRef<Map<string, string>>(new Map());
  const loadingPromises = useRef<Map<string, Promise<string>>>(new Map());

  // Fallback timer: when audio.play() is blocked (e.g., autoplay policy),
  // advance currentTime synthetically so blocks still progress without audio.
  const fallbackMode = useRef(false);

  useEffect(() => {
    if (!audioTrack?.segments) {
      return;
    }

    let time = 0;
    segmentStarts.current = audioTrack.segments.map((seg) => {
      const start = time;
      time += seg.duration;
      return start;
    });
    setTotalDuration(time);
  }, [audioTrack]);

  // Preload audio file as blob (enables seeking without range request support)
  const preloadAudio = useCallback(
    async (src: string): Promise<string> => {
      const audioUrl = basePath ? `${basePath}/${src}` : src;

      // Return cached blob URL if available
      if (blobUrls.current.has(src)) {
        return blobUrls.current.get(src)!;
      }

      // Return existing loading promise if in progress
      if (loadingPromises.current.has(src)) {
        return loadingPromises.current.get(src)!;
      }

      // Start loading
      const loadPromise = (async () => {
        try {
          const response = await fetch(audioUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          blobUrls.current.set(src, blobUrl);
          return blobUrl;
        } catch {
          // Fall back to direct URL if blob loading fails
          return audioUrl;
        } finally {
          loadingPromises.current.delete(src);
        }
      })();

      loadingPromises.current.set(src, loadPromise);
      return loadPromise;
    },
    [basePath],
  );

  // Preload all audio segments on mount
  useEffect(() => {
    if (!audioTrack?.segments) return;

    // Preload all segments in parallel
    audioTrack.segments.forEach((segment) => {
      preloadAudio(segment.src);
    });

    // Cleanup blob URLs on unmount
    const currentBlobUrls = blobUrls.current;
    return () => {
      currentBlobUrls.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      currentBlobUrls.clear();
    };
  }, [audioTrack, preloadAudio]);

  // Handle audio time updates
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      // Calculate overall timeline position
      const segmentStart = segmentStarts.current[currentSegment] || 0;
      const overallTime = segmentStart + audio.currentTime;
      setCurrentTime(overallTime);
    };

    const handlePlay = () => {
      fallbackMode.current = false;
      setIsPlaying(true);
    };
    const handlePause = () => setIsPlaying(false);
    const handleError = () => {
      // Audio source failed to load (e.g., 404 in CI or missing files).
      // Set ready so the UI can still render controls and progress.
      setIsAudioReady(true);
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
  }, [audioRef, currentSegment, audioTrack]);

  // Load new segment when currentSegment changes
  useEffect(() => {
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
      }

      if (shouldPlayAfterLoad.current) {
        audio.play().catch(() => {});
        shouldPlayAfterLoad.current = false;
      }
    };

    // Check if we're already on this source (avoid unnecessary reload)
    // For blob URLs, check by segment src key
    const currentSrc = audio.src;
    const cachedBlobUrl = blobUrls.current.get(segment.src);
    const isSameSource =
      currentSrc && (currentSrc === cachedBlobUrl || currentSrc.endsWith(segment.src));

    if (!isSameSource) {
      // Need to load new source - use preloaded blob URL
      const loadAndPlay = async () => {
        const blobUrl = await preloadAudio(segment.src);

        const handleCanPlay = () => {
          setIsAudioReady(true);
          applyPendingSeek();
          audio.removeEventListener('canplay', handleCanPlay);
        };

        audio.addEventListener('canplay', handleCanPlay);
        audio.src = blobUrl;
        audio.load();

        // If audio is already ready (blob is instant), canplay might not fire
        // Check after a microtask to see if it's ready
        await Promise.resolve();
        if (audio.readyState >= 3) {
          audio.removeEventListener('canplay', handleCanPlay);
          setIsAudioReady(true);
          applyPendingSeek();
        }
      };

      loadAndPlay();
    } else {
      // Same source - apply seek directly
      applyPendingSeek();
    }
  }, [audioRef, currentSegment, audioTrack, preloadAudio]);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      if (isEnded) {
        // Restart from beginning
        setCurrentSegment(0);
        setIsEnded(false);
      }
      audio
        .play()
        .then(() => {
          fallbackMode.current = false;
        })
        .catch(() => {
          // Audio playback failed (e.g., autoplay policy or 404).
          // Enable fallback timer so blocks progress without audio.
          fallbackMode.current = true;
          setIsPlaying(true);
        });
    }
  }, [audioRef, isEnded]);

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
    if (!audio) return;

    // Use component state instead of audio.paused to handle cases where
    // audio source isn't loaded (audio.paused is always true without a source)
    if (!isPlaying) {
      play();
    } else {
      pause();
    }
  }, [audioRef, isPlaying, play, pause]);

  const seekTo = useCallback(
    (time: number) => {
      const audio = audioRef.current;
      if (!audio || !audioTrack?.segments) return;

      // Clamp time to valid range.
      // When totalDuration is 0 (no audio segments), don't clamp — allow
      // seeking by block timing alone (used in render mode / preview).
      const clampedTime = totalDuration > 0
        ? Math.max(0, Math.min(time, totalDuration))
        : Math.max(0, time);

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

      const wasPlaying = !audio.paused;
      setIsEnded(false);

      // Check if we need to switch segments
      if (segmentIndex !== currentSegment) {
        // Store pending seek time - will be applied after segment loads
        pendingSeekTime.current = clampedTime;
        shouldPlayAfterLoad.current = wasPlaying;
        setCurrentSegment(segmentIndex);
      } else {
        // Same segment - seek directly
        const segmentTime = clampedTime - segmentStart;
        audio.currentTime = Math.max(0, segmentTime);
        setCurrentTime(clampedTime);
      }
    },
    [audioRef, audioTrack, currentSegment, totalDuration],
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
    seekTo(0);
    // Small delay to ensure seek completes before playing
    await new Promise((resolve) => setTimeout(resolve, 50));
    play();
  }, [seekTo, play]);

  // Fallback timer: advance currentTime synthetically when audio.play() was blocked
  // (e.g., autoplay policy or missing audio). Blocks progress at real-time pace
  // without sound. Stops when audio actually starts playing or playback is paused.
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
    isAvailable: true, // HTML5 audio is always available in browsers
    // Actions
    play: async () => play(),
    pause: async () => pause(),
    toggle: async () => toggle(),
    seekTo: async (time: number) => seekTo(time),
    skipToSegment: async (index: number) => skipToSegment(index),
    restart,
  };
}

export default useAudioSync;
