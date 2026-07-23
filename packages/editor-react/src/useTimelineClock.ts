/**
 * useTimelineClock
 *
 * A minimal real-time playback clock for the timeline view — a
 * `requestAnimationFrame` loop that advances `currentTime` at wall-clock speed
 * between `play()` and `pause()`, clamped to `[0, total]`. No audio element;
 * media playback is driven separately (the timeline feeds `currentTime` to
 * `MediaClipLayer`). Mirrors the fallback timer in `useAudioSync`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface TimelineClock {
  /** Seconds from the start of the timeline. */
  currentTime: number;
  isPlaying: boolean;
  /** Start playing; restarts from 0 when already at the end. */
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Jump to a time (clamped to `[0, total]`). */
  seek: (t: number) => void;
  /**
   * Registers the single media host driven by this clock. Keeping registration
   * on the clock lets every play entry point (transport button or composition
   * preview) unlock active media inside the originating browser gesture.
   */
  registerMediaHost?: (host: HTMLElement | null) => void;
}

/** Advance `prev` by `dt` seconds, clamped to `[0, total]`. Pure. */
export function advanceTime(prev: number, dt: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(total, Math.max(0, prev + dt));
}

/**
 * Start every media element active at `time`.
 *
 * This must run synchronously from the user's Play gesture. Waiting for
 * React's playback effect loses Chromium's transient user activation, causing
 * unmuted video/audio `play()` calls to be rejected.
 */
export function playTimelineMediaAt(root: HTMLElement | null, time: number): void {
  if (!root) return;
  root
    .querySelectorAll<HTMLMediaElement>('audio[data-clip-id], video[data-clip-id]')
    .forEach((el) => {
      const start = Number(el.dataset.absStart);
      const end = Number(el.dataset.absEnd);
      if (!Number.isFinite(start) || !Number.isFinite(end) || time < start || time >= end) return;
      try {
        const pending = el.play();
        pending?.catch(() => {});
      } catch {
        // Unsupported or not-yet-decodable media is retried by MediaClipLayer.
      }
    });
}

export function useTimelineClock(total: number): TimelineClock {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const currentTimeRef = useRef(0);
  const isPlayingRef = useRef(false);
  const mediaHostRef = useRef<HTMLElement | null>(null);

  currentTimeRef.current = currentTime;
  isPlayingRef.current = isPlaying;

  // Keep currentTime within the (possibly shrinking) timeline.
  useEffect(() => {
    setCurrentTime((t) => Math.min(t, Math.max(0, total)));
  }, [total]);

  useEffect(() => {
    if (!isPlaying) return;
    lastRef.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      setCurrentTime((prev) => {
        const next = advanceTime(prev, dt, total);
        currentTimeRef.current = next;
        if (next >= total) {
          isPlayingRef.current = false;
          setIsPlaying(false);
          return total;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, total]);

  const registerMediaHost = useCallback((host: HTMLElement | null) => {
    mediaHostRef.current = host;
  }, []);
  const play = useCallback(() => {
    const target = total > 0 && currentTimeRef.current >= total ? 0 : currentTimeRef.current;
    currentTimeRef.current = target;
    playTimelineMediaAt(mediaHostRef.current, target);
    setCurrentTime(target);
    isPlayingRef.current = true;
    setIsPlaying(true);
  }, [total]);
  const pause = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, []);
  const toggle = useCallback(() => {
    if (isPlayingRef.current) pause();
    else play();
  }, [pause, play]);
  const seek = useCallback(
    (t: number) => {
      const next = Math.min(Math.max(0, t), Math.max(0, total));
      currentTimeRef.current = next;
      setCurrentTime(next);
    },
    [total],
  );

  return { currentTime, isPlaying, play, pause, toggle, seek, registerMediaHost };
}
