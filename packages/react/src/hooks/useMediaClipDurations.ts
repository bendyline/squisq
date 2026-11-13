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
 *
 * The same probe measures the videos a block plays, which hold the block open
 * for their length (`applyVideoDurations` in core): {@link useVideoDurations}
 * for any list of sources, and {@link probeVideoDurations} for non-React
 * callers such as an exporter.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Doc, MediaProvider, ScheduledClip } from '@bendyline/squisq/schemas';
import { applyVideoDurations, collectVideoDurationSources } from '@bendyline/squisq/doc';
import {
  DEFAULT_INTERACTIVE_RESOURCE_POLICY,
  isResourceUrlAllowed,
  type ResourcePolicy,
} from '@bendyline/squisq/markdown';
import { useMediaProvider, useResourcePolicy } from './MediaContext.js';

/**
 * Session cache: resolved URL → the probe of it, shared by every caller so a
 * file several surfaces ask about is decoded once. A probe that fails is
 * dropped, so a later call can try again (the file may not exist yet).
 */
const probeCache = new Map<string, Promise<number | null>>();

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

/** The cached probe of `url` (see {@link probeCache}). */
function probeCachedVideoDuration(url: string): Promise<number | null> {
  let probe = probeCache.get(url);
  if (!probe) {
    probe = probeVideoDuration(url).then((seconds) => {
      if (seconds == null) probeCache.delete(url);
      return seconds;
    });
    probeCache.set(url, probe);
  }
  return probe;
}

/** Where {@link probeVideoDurations} resolves sources from. */
export interface VideoDurationProbeOptions {
  /** Resolves document-relative sources (a workspace's files). */
  provider?: MediaProvider | null;
  /** Base for relative sources when there is no provider. Default `/`. */
  basePath?: string;
  /** URLs the document may load. Default: the interactive policy. */
  resourcePolicy?: ResourcePolicy;
}

/**
 * Measure the length of each video source, resolved the way the player
 * resolves it. Resolves to a map of the lengths that could be read (keyed by
 * the raw `src`); an unreadable, disallowed or slow file is left out. Never
 * rejects. Browser-only — outside a DOM it resolves empty.
 */
export async function probeVideoDurations(
  srcs: Iterable<string>,
  options: VideoDurationProbeOptions = {},
): Promise<Map<string, number>> {
  const {
    provider = null,
    basePath = '/',
    resourcePolicy = DEFAULT_INTERACTIVE_RESOURCE_POLICY,
  } = options;
  const durations = new Map<string, number>();
  const unique = [...new Set(srcs)].filter((src) => src.length > 0);
  await Promise.all(
    unique.map(async (src) => {
      try {
        const url = await resolveMediaUrl(src, provider, basePath, resourcePolicy);
        if (!url) return;
        const seconds = await probeCachedVideoDuration(url);
        if (seconds != null) durations.set(src, seconds);
      } catch {
        /* an unreadable file sets no length */
      }
    }),
  );
  return durations;
}

/**
 * Hold each block of `doc` open for the videos it plays: measure the files
 * whose length the document does not state and apply core's
 * `applyVideoDurations`. The async counterpart of what the editor does live,
 * for pipelines that build their own Doc (exporters). Call it on
 * `markdownToDoc` output, before `resolveAudioMapping` and `buildPreviewDoc`.
 * Returns `doc` unchanged when nothing needs measuring or nothing grows.
 */
export async function resolveVideoDurations(
  doc: Doc,
  options: VideoDurationProbeOptions = {},
): Promise<Doc> {
  const sources = collectVideoDurationSources(doc);
  if (sources.length === 0) return doc;
  const durations = await probeVideoDurations(sources, options);
  return durations.size > 0 ? applyVideoDurations(doc, (src) => durations.get(src)) : doc;
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
  const srcs = useMemo(
    () => schedule.filter((clip) => clip.kind === 'video' && clip.src).map((clip) => clip.src),
    [schedule],
  );
  return useVideoDurations(srcs, basePath, mediaProviderOverride);
}

/**
 * Probe the intrinsic durations of `srcs` (video files). Returns a map keyed by
 * the raw `src`, filled in as each file's metadata arrives; a file that cannot
 * be read is simply absent. Provider resolution follows
 * {@link useMediaClipDurations}.
 */
export function useVideoDurations(
  srcs: readonly string[],
  basePath: string,
  mediaProviderOverride?: MediaProvider | null,
): Map<string, number> {
  const contextProvider = useMediaProvider();
  const provider = mediaProviderOverride !== undefined ? mediaProviderOverride : contextProvider;
  const resourcePolicy = useResourcePolicy();

  // Distinct sources, as a stable key so the effect only re-runs when the
  // actual set of files changes (not on every re-derivation of the list).
  const srcKey = useMemo(
    () =>
      Array.from(new Set(srcs.filter((src) => src.length > 0)))
        .sort()
        .join('\n'),
    [srcs],
  );

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
      resolveMediaUrl(src, provider, basePath, resourcePolicy)
        .then((url) => (cancelled || !url ? null : probeCachedVideoDuration(url)))
        .then(
          (seconds) => {
            if (cancelled || seconds == null) return;
            resolved.set(src, seconds);
            commit();
          },
          () => {
            /* an unreadable file sets no length */
          },
        );
    }

    return () => {
      cancelled = true;
    };
  }, [srcKey, provider, basePath, resourcePolicy]);

  return durations;
}
