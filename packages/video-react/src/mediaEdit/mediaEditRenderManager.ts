/**
 * Keeps a document's processed-audio renders in step with its recipes.
 *
 * One manager per media scope (a document's `MediaProvider`). `sync(doc)`
 * indexes the `.mediaEdits/` folder, finds every clip whose `fx` recipe has no
 * current render, and renders them one at a time in the background through a
 * {@link MediaEditRenderer}. Playback and export read `processedAudio(clip)`,
 * which answers only with renders that exist — an edited clip plays its
 * original audio until its render lands, never silence.
 *
 * Renders are written through the provider next to the document's other
 * media, so they travel with it. A render is stale when its source changed
 * size (a re-recorded take under the same name) or when it skipped ops this
 * engine now knows; stale renders are replaced.
 *
 * The manager also makes BAKED clips — a clip's whole recipe (trim, cuts,
 * processed audio, gain, fades, crop) in one ordinary file, for players that
 * cannot apply a recipe. Those are made only when asked for (`bake`): an
 * export that needs them, or "Save edited copy". They share the folder and
 * are replaced as the recipe changes.
 */

import {
  MEDIA_BAKE_MANIFEST_VERSION,
  MEDIA_FX_ORDER,
  MEDIA_RENDER_MANIFEST_VERSION,
  buildMediaBakeIndex,
  buildMediaRenderIndex,
  collectDocMediaClips,
  isMediaBakeStale,
  mediaBakeCuts,
  mediaBakeFilePath,
  mediaBakeKey,
  mediaBakeManifestPath,
  mediaBakeSpec,
  mediaClipRenderKey,
  mediaRenderFilePath,
  mediaRenderManifestPath,
  mediaRenderStaleness,
  parseMediaBakeManifest,
  parseMediaRenderManifest,
  referencedMediaRenderKeys,
  selectMediaRendersForGc,
  selectSupersededMediaBakes,
  serializeMediaBakeManifest,
  serializeMediaFx,
  serializeMediaRenderManifest,
  type MediaBakeEntry,
  type MediaBakeManifest,
  type MediaRenderEntry,
  type MediaRenderManifest,
} from '@bendyline/squisq/mediaEdit';
import type { Doc, MediaClip, MediaProvider } from '@bendyline/squisq/schemas';
import { createMediaEditRenderer, type MediaEditRenderer } from './mediaEditRenderer.js';

export type MediaEditRenderState = 'queued' | 'rendering' | 'ready' | 'failed';

export interface MediaEditRenderStatus {
  key: string;
  state: MediaEditRenderState;
  /** 0…1 while rendering. */
  progress?: number;
  error?: string;
}

export interface MediaBakeOptions {
  signal?: AbortSignal;
  /** 0…1 across the whole job, including a processed-audio render it has to wait for. */
  onProgress?: (fraction: number) => void;
}

export interface MediaEditRenderManager {
  /** The engine client, shared for previews and analysis. */
  readonly renderer: MediaEditRenderer;
  /**
   * Reconcile with a document: index renders and queue missing or stale ones.
   * `extraClips` adds media the document model does not schedule itself —
   * an editor passes body-embedded `<audio>`/`<video>` tags here. Omitted,
   * the extras from the previous call carry over.
   */
  sync(doc: Doc, extraClips?: readonly MediaClip[]): void;
  /** The render an edited clip should play, when one exists. */
  processedAudio(clip: MediaClip): string | undefined;
  /** Render status for a clip, or null when its recipe renders nothing. */
  status(clip: MediaClip): MediaEditRenderStatus | null;
  /** Resolves once every render the document needs is ready or has failed. */
  whenReady(doc: Doc, signal?: AbortSignal): Promise<void>;
  /** Re-render a clip even if a render exists (e.g. after a failure). */
  retry(clip: MediaClip): void;
  /** Load a media reference as a Blob (sources for previews). */
  loadSource(src: string): Promise<Blob>;
  /** The baked copy of a clip — its whole recipe in one file — when a current one exists. */
  bakedMedia(clip: MediaClip): string | undefined;
  /**
   * Make the baked copy of a clip, or reuse a current one, and resolve with
   * its path. A recipe with a signal chain first gets its processed-audio
   * render (queued here if it is not already), so the baked sound is the
   * cleaned-up sound. Rejects when the clip cannot be baked (a browser that
   * cannot encode video, a failed render) or the job is cancelled.
   */
  bake(clip: MediaClip, options?: MediaBakeOptions): Promise<string>;
  /**
   * Delete renders of this document's sources that no current recipe
   * references and that are older than the GC age, and its baked clips that
   * no current recipe asks for (at once: they are made again on demand).
   * Files of other sources are never touched — a media folder can be shared
   * by several documents. Returns the removed paths.
   */
  collectGarbage(doc: Doc, now?: Date): Promise<string[]>;
  /** Change notifications (index, status, progress). Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Bumps on every change (status, progress, renders), for `useSyncExternalStore`. */
  getVersion(): number;
  /**
   * Bumps only when the set of available renders changes — what
   * {@link MediaEditRenderManager.processedAudio} answers. Progress ticks leave it alone,
   * so playback schedules keyed on it do not churn while a render runs.
   */
  getIndexVersion(): number;
  dispose(): void;
}

export interface MediaEditRenderManagerOptions {
  mediaProvider: MediaProvider;
  /** Shared engine client; the manager creates (and disposes) its own when omitted. */
  renderer?: MediaEditRenderer;
  /** For tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Clock for manifests and GC; defaults to `new Date()`. */
  now?: () => Date;
}

/** Share of a bake's progress bar that waiting for a processed-audio render takes. */
const RENDER_SHARE_OF_BAKE = 0.6;

interface Job {
  key: string;
  clip: MediaClip;
  fx: string;
}

function sourceSizeOf(sizes: ReadonlyMap<string, number>, src: string): number | null {
  const direct = sizes.get(src);
  if (direct != null) return direct;
  for (const [name, size] of sizes) if (name.endsWith(`/${src}`)) return size;
  return null;
}

export function createMediaEditRenderManager(
  options: MediaEditRenderManagerOptions,
): MediaEditRenderManager {
  const provider = options.mediaProvider;
  const ownsRenderer = !options.renderer;
  const renderer = options.renderer ?? createMediaEditRenderer();
  const fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => new Date());

  let index = new Map<string, MediaRenderEntry>();
  let sourceSizes = new Map<string, number>();
  const manifests = new Map<string, MediaRenderManifest | null>();
  const staleKeys = new Set<string>();
  const statuses = new Map<string, MediaEditRenderStatus>();
  const queue: Job[] = [];
  const listeners = new Set<() => void>();
  let version = 0;
  let indexVersion = 0;
  let indexLoad: Promise<void> | null = null;
  let running: { key: string; controller: AbortController } | null = null;
  let disposed = false;
  let latestDoc: Doc | null = null;
  let lastExtras: readonly MediaClip[] = [];
  let bakeIndex = new Map<string, MediaBakeEntry>();
  const bakeManifests = new Map<string, MediaBakeManifest | null>();
  const staleBakes = new Set<string>();
  const bakesInFlight = new Map<string, Promise<string>>();
  /** Render keys a bake is waiting on: `sync` must not drop them from the queue. */
  const pinnedRenders = new Set<string>();

  /** What processedAudio can answer: current renders and their paths. */
  const indexSignature = () =>
    [...index]
      .filter(([key]) => !staleKeys.has(key))
      .map(([key, entry]) => `${key}=${entry.path}`)
      .sort()
      .join('|');

  const notify = () => {
    version++;
    for (const listener of listeners) listener();
  };

  const loadText = async (path: string): Promise<string | null> => {
    try {
      const url = await provider.resolveUrl(path);
      const response = await fetchImpl(url);
      return response.ok ? await response.text() : null;
    } catch {
      return null;
    }
  };

  const manifestFor = async (key: string): Promise<MediaRenderManifest | null> => {
    if (manifests.has(key)) return manifests.get(key) ?? null;
    const entry = index.get(key);
    const manifest = entry?.manifestPath
      ? parseMediaRenderManifest((await loadText(entry.manifestPath)) ?? '')
      : null;
    manifests.set(key, manifest);
    return manifest;
  };

  const bakeManifestFor = async (key: string): Promise<MediaBakeManifest | null> => {
    if (bakeManifests.has(key)) return bakeManifests.get(key) ?? null;
    const entry = bakeIndex.get(key);
    const manifest = entry?.manifestPath
      ? parseMediaBakeManifest((await loadText(entry.manifestPath)) ?? '')
      : null;
    bakeManifests.set(key, manifest);
    return manifest;
  };

  const refreshIndex = async (): Promise<void> => {
    const entries = await provider.listMedia();
    const before = indexSignature();
    index = buildMediaRenderIndex(entries);
    sourceSizes = new Map(entries.map((e) => [e.name, e.size]));
    bakeIndex = buildMediaBakeIndex(entries);
    staleBakes.clear();
    for (const [key] of bakeIndex) {
      const manifest = await bakeManifestFor(key);
      if (
        manifest &&
        isMediaBakeStale(manifest, { sourceSize: sourceSizeOf(sourceSizes, manifest.src) })
      ) {
        staleBakes.add(key);
      }
    }
    staleKeys.clear();
    for (const [key] of index) {
      const manifest = await manifestFor(key);
      if (!manifest) continue;
      const staleness = mediaRenderStaleness(manifest, {
        sourceSize: sourceSizeOf(sourceSizes, manifest.src),
        knownOps: MEDIA_FX_ORDER,
      });
      if (staleness) staleKeys.add(key);
    }
    if (indexSignature() !== before) indexVersion++;
    notify();
  };

  const ensureIndex = (): Promise<void> => {
    indexLoad ??= refreshIndex().catch(() => {
      // An unlistable provider (no media folder yet) just has no renders.
      indexLoad = null;
    });
    return indexLoad;
  };

  const isCurrent = (key: string) => index.has(key) && !staleKeys.has(key);
  const isBakeCurrent = (key: string) => bakeIndex.has(key) && !staleBakes.has(key);

  const pump = async (): Promise<void> => {
    if (running || disposed) return;
    const job = queue.shift();
    if (!job) return;
    const controller = new AbortController();
    running = { key: job.key, controller };
    statuses.set(job.key, { key: job.key, state: 'rendering', progress: 0 });
    notify();
    let lastReported = 0;
    try {
      const source = await loadSource(job.clip.src);
      const result = await renderer.render(
        { source, fx: job.fx },
        {
          signal: controller.signal,
          onProgress: (fraction) => {
            if (fraction - lastReported < 0.01 && fraction < 1) return;
            lastReported = fraction;
            statuses.set(job.key, { key: job.key, state: 'rendering', progress: fraction });
            notify();
          },
        },
      );
      const renderPath = await provider.addMedia(
        mediaRenderFilePath(job.clip.src, job.key, result.extension),
        result.bytes,
        result.mimeType,
      );
      const manifest: MediaRenderManifest = {
        version: MEDIA_RENDER_MANIFEST_VERSION,
        src: job.clip.src,
        key: job.key,
        fx: job.fx,
        ignoredOps: result.ignoredOps,
        file: renderPath,
        mimeType: result.mimeType,
        sourceSize: source.size,
        sourceDuration: result.sourceDuration,
        engine: result.engine,
        createdAt: now().toISOString(),
        analysis: {
          ...(result.analysis.integratedLufs != null
            ? { integratedLufs: result.analysis.integratedLufs }
            : {}),
          appliedGainDb: result.analysis.loudnessGainDb,
          breathCount: result.analysis.breaths.length,
        },
      };
      const manifestPath = await provider.addMedia(
        mediaRenderManifestPath(job.clip.src, job.key),
        new TextEncoder().encode(serializeMediaRenderManifest(manifest)),
        'application/json',
      );
      index.set(job.key, {
        key: job.key,
        path: renderPath,
        manifestPath,
        size: result.bytes.byteLength,
      });
      manifests.set(job.key, manifest);
      staleKeys.delete(job.key);
      indexVersion++;
      statuses.set(job.key, { key: job.key, state: 'ready' });
    } catch (err: unknown) {
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      if (aborted) statuses.delete(job.key);
      else {
        statuses.set(job.key, {
          key: job.key,
          state: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      running = null;
      notify();
      void pump();
    }
  };

  const enqueue = (clip: MediaClip, force: boolean) => {
    const key = mediaClipRenderKey(clip);
    const fx = clip.edits?.fx;
    if (!key || !fx) return;
    if (!force && (isCurrent(key) || statuses.get(key)?.state === 'failed')) return;
    if (running?.key === key || queue.some((job) => job.key === key)) return;
    queue.push({ key, clip, fx: serializeMediaFx({ ops: fx.ops, unknown: [] }) });
    statuses.set(key, { key, state: 'queued' });
  };

  async function loadSource(src: string): Promise<Blob> {
    const url = await provider.resolveUrl(src);
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`Could not read ${src} (${response.status}).`);
    return response.blob();
  }

  const cancelled = () => new DOMException('The bake was cancelled.', 'AbortError');

  /** The clip's processed-audio render, rendering it first when it is missing. */
  const processedAudioFor = async (
    clip: MediaClip,
    renderKey: string,
    options: MediaBakeOptions,
  ): Promise<string> => {
    if (!isCurrent(renderKey)) {
      pinnedRenders.add(renderKey);
      try {
        // A render that failed earlier gets another try: the caller asked for the result.
        if (statuses.get(renderKey)?.state === 'failed') statuses.delete(renderKey);
        enqueue(clip, false);
        notify();
        void pump();
        await new Promise<void>((resolve, reject) => {
          const check = () => {
            const status = statuses.get(renderKey);
            if (options.signal?.aborted) settle(() => reject(cancelled()));
            else if (isCurrent(renderKey)) settle(resolve);
            else if (status?.state === 'failed') {
              settle(() => reject(new Error(`Audio cleanup failed: ${status.error}`)));
            } else options.onProgress?.((status?.progress ?? 0) * RENDER_SHARE_OF_BAKE);
          };
          const settle = (finish: () => void) => {
            unsubscribe();
            options.signal?.removeEventListener('abort', check);
            finish();
          };
          const unsubscribe = manager.subscribe(check);
          options.signal?.addEventListener('abort', check);
          check();
        });
      } finally {
        pinnedRenders.delete(renderKey);
      }
    }
    const path = index.get(renderKey)?.path;
    if (!path) throw new Error('The processed audio for this clip is missing.');
    return path;
  };

  /** Bake keys the current document — plus the editor's extra clips — asks for. */
  const referencedBakeKeys = (): Set<string> => {
    const clips = [...(latestDoc ? collectDocMediaClips(latestDoc) : []), ...lastExtras];
    return new Set([...clips.map((clip) => mediaBakeKey(clip)), ...bakesInFlight.keys()]);
  };

  /** Remove baked clips of `sources` that no current recipe asks for. Returns the removed paths. */
  const pruneBakes = async (sources: ReadonlySet<string>, keep?: string): Promise<string[]> => {
    const loaded = new Map<string, MediaBakeManifest>();
    for (const [key] of bakeIndex) {
      const manifest = await bakeManifestFor(key);
      if (manifest) loaded.set(key, manifest);
    }
    const referenced = referencedBakeKeys();
    if (keep) referenced.add(keep);
    const paths = selectSupersededMediaBakes(bakeIndex, loaded, sources, referenced);
    for (const path of paths) await provider.removeMedia(path).catch(() => {});
    for (const [key, entry] of [...bakeIndex]) {
      if (!paths.includes(entry.path)) continue;
      bakeIndex.delete(key);
      bakeManifests.delete(key);
      staleBakes.delete(key);
    }
    return paths;
  };

  const runBake = async (clip: MediaClip, key: string, options: MediaBakeOptions) => {
    const renderKey = mediaClipRenderKey(clip);
    const audioPath = renderKey ? await processedAudioFor(clip, renderKey, options) : null;
    // With a render to wait for, the bake itself fills the rest of the bar.
    const from = renderKey ? RENDER_SHARE_OF_BAKE : 0;
    const source = await loadSource(clip.src);
    const audio = audioPath ? await loadSource(audioPath) : undefined;
    let lastReported = 0;
    const result = await renderer.bake(
      {
        source,
        kind: clip.kind,
        ...(audio ? { audio } : {}),
        ...(clip.clipStart != null ? { clipStart: clip.clipStart } : {}),
        ...(clip.clipEnd != null ? { clipEnd: clip.clipEnd } : {}),
        cuts: mediaBakeCuts(clip),
        ...(clip.edits?.gain ? { gain: clip.edits.gain } : {}),
        ...(clip.edits?.fadeIn ? { fadeIn: clip.edits.fadeIn } : {}),
        ...(clip.edits?.fadeOut ? { fadeOut: clip.edits.fadeOut } : {}),
        ...(clip.kind === 'video' && clip.edits?.crop ? { crop: clip.edits.crop } : {}),
      },
      {
        signal: options.signal,
        onProgress: (fraction) => {
          if (fraction - lastReported < 0.01 && fraction < 1) return;
          lastReported = fraction;
          options.onProgress?.(from + fraction * (1 - from));
        },
      },
    );
    const size = result.bytes.byteLength;
    const bakePath = await provider.addMedia(
      mediaBakeFilePath(clip.src, key, result.extension),
      result.bytes,
      result.mimeType,
    );
    const manifest: MediaBakeManifest = {
      version: MEDIA_BAKE_MANIFEST_VERSION,
      src: clip.src,
      key,
      spec: mediaBakeSpec(clip),
      file: bakePath,
      mimeType: result.mimeType,
      sourceSize: source.size,
      duration: result.durationSec,
      engine: result.engine,
      createdAt: now().toISOString(),
    };
    const manifestPath = await provider.addMedia(
      mediaBakeManifestPath(clip.src, key),
      new TextEncoder().encode(serializeMediaBakeManifest(manifest)),
      'application/json',
    );
    bakeIndex.set(key, { key, path: bakePath, manifestPath, size });
    bakeManifests.set(key, manifest);
    staleBakes.delete(key);
    // The recipe moved on: the copies it left behind are only taking up room.
    await pruneBakes(new Set([clip.src]), key);
    notify();
    return bakePath;
  };

  /** Render keys the document — plus the editor's extra clips — needs. */
  const requiredKeys = (doc: Doc): Set<string> => {
    const keys = referencedMediaRenderKeys(doc);
    for (const clip of lastExtras) {
      const key = mediaClipRenderKey(clip);
      if (key) keys.add(key);
    }
    return keys;
  };

  const manager: MediaEditRenderManager = {
    renderer,
    sync(doc, extraClips) {
      latestDoc = doc;
      // Callers without editor context (export's whenReady) keep the extras
      // the editor last supplied, so its embedded renders are not dropped.
      const extras = extraClips ?? lastExtras;
      lastExtras = extras;
      void ensureIndex().then(() => {
        if (disposed || latestDoc !== doc) return;
        // Drop queued work the document no longer asks for.
        const clips = [...collectDocMediaClips(doc), ...extras];
        const wanted = new Set(
          clips.map((clip) => mediaClipRenderKey(clip)).filter((key): key is string => key != null),
        );
        for (let i = queue.length - 1; i >= 0; i--) {
          if (!wanted.has(queue[i].key) && !pinnedRenders.has(queue[i].key)) {
            statuses.delete(queue[i].key);
            queue.splice(i, 1);
          }
        }
        for (const clip of clips) enqueue(clip, false);
        notify();
        void pump();
      });
    },
    processedAudio(clip) {
      const key = mediaClipRenderKey(clip);
      return key && isCurrent(key) ? index.get(key)?.path : undefined;
    },
    status(clip) {
      const key = mediaClipRenderKey(clip);
      if (!key) return null;
      if (isCurrent(key)) return statuses.get(key) ?? { key, state: 'ready' };
      return statuses.get(key) ?? { key, state: 'queued' };
    },
    whenReady(doc, signal) {
      manager.sync(doc);
      return new Promise<void>((resolve, reject) => {
        const check = () => {
          if (signal?.aborted) {
            unsubscribe();
            reject(new DOMException('Waiting for renders was cancelled.', 'AbortError'));
            return;
          }
          const pending = [...requiredKeys(doc)].some((key) => {
            if (isCurrent(key)) return false;
            return statuses.get(key)?.state !== 'failed';
          });
          if (!pending && indexLoad) {
            unsubscribe();
            resolve();
          }
        };
        const unsubscribe = manager.subscribe(check);
        signal?.addEventListener('abort', check, { once: true });
        void ensureIndex().then(check);
      });
    },
    retry(clip) {
      const key = mediaClipRenderKey(clip);
      if (!key) return;
      statuses.delete(key);
      enqueue(clip, true);
      notify();
      void pump();
    },
    loadSource,
    bakedMedia(clip) {
      const key = mediaBakeKey(clip);
      return isBakeCurrent(key) ? bakeIndex.get(key)?.path : undefined;
    },
    async bake(clip, bakeOptions = {}) {
      if (bakeOptions.signal?.aborted) throw cancelled();
      await ensureIndex();
      const key = mediaBakeKey(clip);
      const current = isBakeCurrent(key) ? bakeIndex.get(key)?.path : undefined;
      if (current) {
        bakeOptions.onProgress?.(1);
        return current;
      }
      // Two requests for the same clip share one job (the first caller's signal governs it).
      let job = bakesInFlight.get(key);
      if (!job) {
        job = runBake(clip, key, bakeOptions).finally(() => bakesInFlight.delete(key));
        bakesInFlight.set(key, job);
      }
      return job;
    },
    async collectGarbage(doc, at = now()) {
      await refreshIndex();
      const docSources = new Set(
        [...collectDocMediaClips(doc), ...lastExtras].map((clip) => clip.src),
      );
      const busy = new Set([...queue.map((job) => job.key), ...(running ? [running.key] : [])]);
      const candidates = new Map<string, MediaRenderEntry>();
      const loaded = new Map<string, MediaRenderManifest>();
      for (const [key, entry] of index) {
        const manifest = await manifestFor(key);
        if (!manifest || !docSources.has(manifest.src) || busy.has(key)) continue;
        candidates.set(key, entry);
        loaded.set(key, manifest);
      }
      const paths = selectMediaRendersForGc(candidates, requiredKeys(doc), loaded, at);
      for (const path of paths) await provider.removeMedia(path);
      const bakes = latestDoc === doc ? await pruneBakes(docSources) : [];
      if (bakes.length > 0) notify();
      if (paths.length > 0) {
        for (const key of candidates.keys()) {
          const entry = index.get(key);
          if (entry && paths.includes(entry.path)) {
            index.delete(key);
            manifests.delete(key);
          }
        }
        indexVersion++;
        notify();
      }
      return [...paths, ...bakes];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getVersion: () => version,
    getIndexVersion: () => indexVersion,
    dispose() {
      disposed = true;
      queue.length = 0;
      running?.controller.abort();
      listeners.clear();
      if (ownsRenderer) renderer.dispose();
    },
  };
  return manager;
}
