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
 */

import {
  MEDIA_FX_ORDER,
  MEDIA_RENDER_MANIFEST_VERSION,
  buildMediaRenderIndex,
  collectDocMediaClips,
  mediaClipRenderKey,
  mediaRenderFilePath,
  mediaRenderManifestPath,
  mediaRenderStaleness,
  parseMediaRenderManifest,
  referencedMediaRenderKeys,
  selectMediaRendersForGc,
  serializeMediaFx,
  serializeMediaRenderManifest,
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
  /**
   * Delete renders of this document's sources that no current recipe
   * references and that are older than the GC age. Renders of other sources
   * are never touched — a media folder can be shared by several documents.
   * Returns the removed paths.
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

  const refreshIndex = async (): Promise<void> => {
    const entries = await provider.listMedia();
    const before = indexSignature();
    index = buildMediaRenderIndex(entries);
    sourceSizes = new Map(entries.map((e) => [e.name, e.size]));
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
          if (!wanted.has(queue[i].key)) {
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
      return paths;
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
