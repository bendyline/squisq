/**
 * useAnimatedImage — playback state for an image that may animate.
 *
 * A GIF (or animated WebP / APNG) loops forever with no way to stop it, which
 * is distracting beside text and an accessibility failure for motion lasting
 * more than a few seconds. This hook reads the image's bytes once, decides
 * whether it actually animates (a static GIF gets no controls), and tracks a
 * play / pause / ended state that `AnimatedImageControls` renders.
 *
 * Playback stays native — the `<img>` animates itself, so timing is exactly
 * the browser's. Pausing freezes a still frame over it, and playing restarts
 * from the first frame by showing the image under a fresh object URL: a new
 * image resource starts its own animation clock, where reassigning the same
 * URL would resume the shared one wherever it had got to.
 *
 * Only sources the page can read without a cross-origin request are
 * inspected (blob:, data:, same-origin http). A remote GIF keeps animating
 * as a plain image rather than logging a CORS failure for every render.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  inspectAnimatedImage,
  mayBeAnimatedImage,
  type AnimatedImageInfo,
} from '@bendyline/squisq/imageEdit';

export type AnimatedImageStatus = 'playing' | 'paused' | 'ended';

export interface AnimatedImagePlayback {
  /** Inspection result: null while pending, for sources that cannot animate,
   *  and when the bytes cannot be read. */
  info: AnimatedImageInfo | null;
  /** True once the image is known to animate. */
  animated: boolean;
  /** The URL to render — `resolvedUrl`, or a private copy after a replay. */
  displaySrc: string;
  status: AnimatedImageStatus;
  /** Play from the first frame. */
  play: () => void;
  /** Freeze on a still frame. */
  pause: () => void;
}

/** Inspections are keyed by resolved URL, so a node view that remounts on
 *  every edit reads its bytes once. Bounded; oldest entries go first. */
const INSPECTION_CACHE_LIMIT = 64;
const inspections = new Map<string, Promise<AnimatedImageInfo | null>>();

function inspectUrl(url: string): Promise<AnimatedImageInfo | null> {
  const cached = inspections.get(url);
  if (cached) return cached;
  const pending = fetch(url)
    .then((response) => (response.ok ? response.arrayBuffer() : null))
    .then((buffer) => (buffer ? inspectAnimatedImage(buffer) : null))
    .catch(() => null);
  // A data: URL is its own payload; caching it would pin the whole image.
  if (!/^data:/i.test(url)) {
    inspections.set(url, pending);
    if (inspections.size > INSPECTION_CACHE_LIMIT) {
      const oldest = inspections.keys().next().value;
      if (oldest !== undefined) inspections.delete(oldest);
    }
  }
  return pending;
}

/** The absolute URL to fetch, or null when reading it would need a
 *  cross-origin request (or a scheme `fetch` cannot load, like file:). */
function inspectableUrl(url: string): string | null {
  if (/^(?:blob|data):/i.test(url)) return url;
  if (typeof document === 'undefined') return null;
  try {
    const parsed = new URL(url, document.baseURI);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin === window.location.origin ? parsed.href : null;
  } catch {
    return null;
  }
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Readers who ask for reduced motion start on a still frame. */
function initialStatus(): AnimatedImageStatus {
  return prefersReducedMotion() ? 'paused' : 'playing';
}

/**
 * @param src The authored source (a relative path, URL or data URL). Its
 *   extension or MIME decides whether the image could animate at all.
 * @param resolvedUrl The URL the image is actually loaded from, e.g. a blob
 *   URL from a MediaProvider. Pass '' while it is still resolving.
 */
export function useAnimatedImage(src: string, resolvedUrl: string): AnimatedImagePlayback {
  const [info, setInfo] = useState<AnimatedImageInfo | null>(null);
  const [status, setStatus] = useState<AnimatedImageStatus>(initialStatus);
  const [replayUrl, setReplayUrl] = useState<string | null>(null);
  // Bumped on every play so the end-of-play timer restarts with it.
  const [run, setRun] = useState(0);
  // Bumped whenever a pending replay should be abandoned.
  const generationRef = useRef(0);
  const replayUrlRef = useRef<string | null>(null);

  const swapReplayUrl = useCallback((next: string | null) => {
    if (replayUrlRef.current) URL.revokeObjectURL(replayUrlRef.current);
    replayUrlRef.current = next;
    setReplayUrl(next);
  }, []);

  useEffect(() => {
    setInfo(null);
    const url = resolvedUrl && mayBeAnimatedImage(src) ? inspectableUrl(resolvedUrl) : null;
    if (!url) return;
    let cancelled = false;
    void inspectUrl(url).then((next) => {
      if (!cancelled) setInfo(next);
    });
    return () => {
      cancelled = true;
    };
  }, [src, resolvedUrl]);

  // A new source starts over: drop any replay copy and the old play state.
  useEffect(() => {
    generationRef.current++;
    swapReplayUrl(null);
    setStatus(initialStatus());
  }, [resolvedUrl, swapReplayUrl]);

  useEffect(
    () => () => {
      if (replayUrlRef.current) URL.revokeObjectURL(replayUrlRef.current);
    },
    [],
  );

  // A finite animation stops on its last frame; offer a replay once it has.
  useEffect(() => {
    if (status !== 'playing' || !info?.animated || info.playCount === 0) return;
    const timer = setTimeout(() => setStatus('ended'), info.durationMs * info.playCount);
    return () => clearTimeout(timer);
  }, [status, info, run]);

  const play = useCallback(() => {
    const generation = ++generationRef.current;
    const start = (url: string | null) => {
      if (generation !== generationRef.current) {
        if (url) URL.revokeObjectURL(url);
        return;
      }
      if (url) swapReplayUrl(url);
      setStatus('playing');
      setRun((n) => n + 1);
    };
    // Stay on the still frame until the fresh copy is ready, so the image
    // never flashes the frame its old clock had reached.
    fetch(replayUrl ?? resolvedUrl)
      .then((response) => response.blob())
      .then(
        (blob) => start(URL.createObjectURL(blob)),
        // Unreadable now: resume the image as it is rather than stay stuck.
        () => start(null),
      );
  }, [replayUrl, resolvedUrl, swapReplayUrl]);

  const pause = useCallback(() => {
    generationRef.current++;
    setStatus('paused');
  }, []);

  return {
    info,
    animated: info?.animated ?? false,
    displaySrc: replayUrl ?? resolvedUrl,
    status,
    play,
    pause,
  };
}
