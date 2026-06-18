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
}

/** Advance `prev` by `dt` seconds, clamped to `[0, total]`. Pure. */
export function advanceTime(prev: number, dt: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(total, Math.max(0, prev + dt));
}

export function useTimelineClock(total: number): TimelineClock {
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);

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
        if (next >= total) {
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

  const play = useCallback(() => {
    setCurrentTime((t) => (total > 0 && t >= total ? 0 : t));
    setIsPlaying(true);
  }, [total]);
  const pause = useCallback(() => setIsPlaying(false), []);
  const toggle = useCallback(() => setIsPlaying((p) => !p), []);
  const seek = useCallback(
    (t: number) => setCurrentTime(Math.min(Math.max(0, t), Math.max(0, total))),
    [total],
  );

  return { currentTime, isPlaying, play, pause, toggle, seek };
}
