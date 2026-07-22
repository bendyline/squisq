/**
 * useMediaClipDurations
 *
 * Probes the intrinsic (natural) duration of scheduled video clips so the media
 * schedule can end an unlocked video at its own length instead of holding its
 * last frame until the timeline ends. Returns a `Map<src, seconds>` keyed by the
 * clip's raw `src`, suitable for {@link resolveMediaSchedule}'s
 * `intrinsicDuration` option.
 *
 * A media file's real length is not part of the pure `Doc` model, so it can only
 * be learned in the browser. This hook mirrors {@link useMediaUrl}'s resolution
 * (MediaProvider → basePath fallback, resource-policy gated), loads metadata from
 * a throwaway `<video>`, and caches each result by resolved URL for the session.
 *
 * Only video clips are probed — an over-scheduled audio clip merely goes silent,
 * which is not the visible "frozen frame" bug this addresses.
 */

import { useEffect, useMemo, useState } from 'react';
import type { MediaProvider, ScheduledClip } from '@bendyline/squisq/schemas';
import { isResourceUrlAllowed, type ResourcePolicy } from '@bendyline/squisq/markdown';
import { useMediaProvider, useResourcePolicy } from './MediaContext.js';

/** Session cache: resolved URL → intrinsic seconds. Shared across all callers. */
const durationCache = new Map<string, number>();

/** How long to wait for a file's metadata before giving up (ms). */
const PROBE_TIMEOUT_MS = 8000;

/**
 * Resolve a clip `src` to a playable URL the same way {@link useMediaUrl} does,
 * but imperatively (for N sources at once). Returns '' when the resource policy
 * rejects the URL.
 */
async function resolveMediaUrl(
  src: string,
  provider: MediaProvider | null,
  basePath: string,
  policy: ResourcePolicy,
): Promise<string> {
  const isAbsolute = !src || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(src);
  const fallback = isAbsolute ? src : `${basePath.replace(/\/$/, '')}/${src}`;
  const gate = (url: string) => (isResourceUrlAllowed(url, policy) ? url : '');
  if (isAbsolute || !provider) return gate(fallback);
  try {
    return gate(await provider.resolveUrl(src));
  } catch {
    return gate(fallback);
  }
}

/**
 * Read the intrinsic duration of a media URL via a detached `<video>` element.
 *
 * MediaRecorder WebM files (exactly the recordings this feature targets) report
 * `duration: Infinity` until the element seeks to the end, so when metadata
 * arrives non-finite we nudge `currentTime` to the far end and read the
 * now-known duration. Resolves null on any error/timeout.
 */
function probeVideoDuration(url: string): Promise<number | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const el = document.createElement('video');
    el.preload = 'metadata';
    el.muted = true;
    el.setAttribute('playsinline', '');

    let settled = false;
    // Holder so `finish` (defined before the timer is scheduled) can clear it.
    const timeout: { id?: ReturnType<typeof setTimeout> } = {};
    const finish = (seconds: number | null) => {
      if (settled) return;
      settled = true;
      if (timeout.id !== undefined) clearTimeout(timeout.id);
      el.removeEventListener('durationchange', onDurationProbe);
      el.removeEventListener('timeupdate', onDurationProbe);
      el.removeAttribute('src');
      try {
        el.load();
      } catch {
        /* releasing the element is best-effort */
      }
      resolve(seconds);
    };

    const readFinite = (): boolean => {
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) {
        finish(d);
        return true;
      }
      return false;
    };
    // After the seek nudge, duration becomes known; read it once it does.
    const onDurationProbe = () => {
      readFinite();
    };

    el.addEventListener(
      'loadedmetadata',
      () => {
        if (readFinite()) return;
        // Non-finite (lazy WebM): seek to the end to force the real duration.
        el.addEventListener('durationchange', onDurationProbe);
        el.addEventListener('timeupdate', onDurationProbe);
        try {
          el.currentTime = 1e101;
        } catch {
          finish(null);
        }
      },
      { once: true },
    );
    el.addEventListener('error', () => finish(null), { once: true });
    timeout.id = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
    el.src = url;
  });
}

/**
 * Probe the intrinsic durations of the video clips in `schedule`. Returns a map
 * keyed by the clip's raw `src`. Pass the resolved `MediaProvider` explicitly
 * (editor hosts) or rely on {@link MediaContext} (player hosts) by omitting it.
 */
export function useMediaClipDurations(
  schedule: ScheduledClip[],
  basePath: string,
  mediaProviderOverride?: MediaProvider | null,
): Map<string, number> {
  const contextProvider = useMediaProvider();
  const provider = mediaProviderOverride !== undefined ? mediaProviderOverride : contextProvider;
  const resourcePolicy = useResourcePolicy();

  // Distinct video sources, as a stable key so the effect only re-runs when the
  // actual set of files changes (not on every schedule re-derivation).
  const srcKey = useMemo(() => {
    const set = new Set<string>();
    for (const clip of schedule) {
      if (clip.kind === 'video' && clip.src) set.add(clip.src);
    }
    return Array.from(set).sort().join('\n');
  }, [schedule]);

  const [durations, setDurations] = useState<Map<string, number>>(() => new Map());

  useEffect(() => {
    const srcs = srcKey ? srcKey.split('\n') : [];
    if (srcs.length === 0) {
      setDurations((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }

    let cancelled = false;
    const resolved = new Map<string, number>();
    const commit = () => {
      if (!cancelled) setDurations(new Map(resolved));
    };

    for (const src of srcs) {
      resolveMediaUrl(src, provider, basePath, resourcePolicy).then((url) => {
        if (cancelled || !url) return;
        const cached = durationCache.get(url);
        if (cached != null) {
          resolved.set(src, cached);
          commit();
          return;
        }
        probeVideoDuration(url).then((seconds) => {
          if (cancelled || seconds == null) return;
          durationCache.set(url, seconds);
          resolved.set(src, seconds);
          commit();
        });
      });
    }

    return () => {
      cancelled = true;
    };
  }, [srcKey, provider, basePath, resourcePolicy]);

  return durations;
}
