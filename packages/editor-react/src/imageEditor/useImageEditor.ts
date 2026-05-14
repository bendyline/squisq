/**
 * React hook that bundles the image-editor reducer with sidecar
 * persistence, versioning, and an object-URL cache for asset bytes.
 *
 * Hosts pass an already-scoped {@link ContentContainer} (typically built
 * with `scopeContainer(parent, basename + '_files')`); the hook never
 * looks above that root.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ContentContainer } from '@bendyline/squisq/storage';
import type { ImageEditDoc, ImageEditLayer } from '@bendyline/squisq/schemas';
import {
  IMAGE_EDIT_ASSETS_PREFIX,
  IMAGE_EDIT_STATE_FILENAME,
  ImageEditVersionManager,
  createEmptyImageEditDoc,
  readImageEditDoc,
  writeImageEditDoc,
} from '@bendyline/squisq/imageEdit';
import {
  imageEditorReducer,
  initialImageEditorState,
  type ImageEditorAction,
  type ImageEditorState,
} from './state.js';

export interface UseImageEditorOptions {
  /** Sidecar container for the image being edited. */
  container: ContentContainer;
  /**
   * Initial source image URL — used to seed layer 0 when the sidecar has
   * no `state.json` yet. Bytes are fetched and copied into
   * `assets/source.<ext>` so the doc is portable.
   */
  initialSrc?: string;
  /** Override the state filename. Defaults to `state.json`. */
  stateFilename?: string;
  /** Enable version history. Default: `false`. */
  allowVersioning?: boolean;
  /** Auto-save idle delay (ms). `0` disables. Default: `5000`. */
  versioningAutoSaveIdleMs?: number;
  /** Debounced write delay for state.json (ms). Default: `500`. */
  persistDebounceMs?: number;
}

export interface UseImageEditorReturn {
  /** Current reducer state (or `null` while still loading the initial doc). */
  state: ImageEditorState | null;
  /** Dispatch a reducer action. No-op while loading. */
  dispatch: (action: ImageEditorAction) => void;
  /** Manually trigger a synchronous write of `state.json`. */
  flush: () => Promise<void>;
  /** Resolve an asset path inside the sidecar to a blob URL (cached). */
  resolveAssetUrl: (path: string) => Promise<string>;
  /**
   * Write a new asset (raster image) into `assets/` and return the
   * sidecar-relative path. The caller is then expected to push a layer
   * referencing that path.
   */
  uploadAsset: (file: Blob, suggestedName?: string) => Promise<string>;
  /** Versioning handle. `null` when `allowVersioning` is false or no container. */
  versioning: ImageEditVersionManager | null;
  /** True after the initial load completes (either an existing doc or seeded). */
  ready: boolean;
  /** Last load / persistence error, if any. */
  error: Error | null;
}

export function useImageEditor(options: UseImageEditorOptions): UseImageEditorReturn {
  const {
    container,
    initialSrc,
    stateFilename = IMAGE_EDIT_STATE_FILENAME,
    allowVersioning = false,
    versioningAutoSaveIdleMs = 5000,
    persistDebounceMs = 500,
  } = options;

  const [state, dispatch] = useReducer(
    (s: ImageEditorState | null, a: ImageEditorAction): ImageEditorState | null => {
      if (s === null) return a.type === 'load' ? initialImageEditorState(a.doc) : null;
      return imageEditorReducer(s, a);
    },
    null,
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  // Set to true inside the initial-load effect when we just seeded the
  // sidecar (no prior `state.json`). The versioning effect below reads
  // this flag to write an "original" snapshot once the manager exists.
  const seededOnLoadRef = useRef(false);

  // ── Initial load (or seed from initialSrc) ────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);

    (async () => {
      try {
        const existing = await readImageEditDoc(container, stateFilename);
        if (cancelled) return;
        if (existing) {
          dispatch({ type: 'load', doc: existing });
          setReady(true);
          return;
        }
        // No existing state — seed.
        const seeded = await seedFromSource(container, initialSrc);
        if (cancelled) return;
        await writeImageEditDoc(container, seeded, stateFilename);
        dispatch({ type: 'load', doc: seeded });
        setReady(true);
        // Capture an initial snapshot of the freshly-seeded state so the
        // version history always has an "original" entry the user can
        // revert to after their first edit.
        seededOnLoadRef.current = true;
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [container, stateFilename, initialSrc]);

  // ── Debounced persistence of state.json ────────────────────────────────
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docRef = useRef<ImageEditDoc | null>(null);
  docRef.current = state?.doc ?? null;

  useEffect(() => {
    if (!state?.dirty) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      const doc = docRef.current;
      if (!doc) return;
      writeImageEditDoc(container, doc, stateFilename)
        .then(() => dispatch({ type: 'mark-clean' }))
        .catch((err: unknown) => {
          console.warn(
            '[squisq-editor] image-edit state persist failed:',
            err instanceof Error ? err.message : err,
          );
        });
    }, persistDebounceMs);
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [state?.dirty, state?.doc, container, stateFilename, persistDebounceMs]);

  const flush = useCallback(async () => {
    const doc = docRef.current;
    if (!doc) return;
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    await writeImageEditDoc(container, doc, stateFilename);
    dispatch({ type: 'mark-clean' });
  }, [container, stateFilename]);

  // ── Versioning ─────────────────────────────────────────────────────────
  const versioning = useMemo(
    () => (allowVersioning ? new ImageEditVersionManager(container, { stateFilename }) : null),
    [allowVersioning, container, stateFilename],
  );

  // Drop the "original" snapshot once versioning is wired and we just
  // seeded a fresh sidecar. Guarded by `seededOnLoadRef` so we never
  // duplicate-snapshot on subsequent renders. Uses `force: true` so the
  // initial entry always lands even though no diff has occurred yet.
  useEffect(() => {
    if (!versioning) return;
    if (!ready) return;
    if (!seededOnLoadRef.current) return;
    seededOnLoadRef.current = false;
    versioning.saveVersion({ force: true }).catch((err: unknown) => {
      console.warn(
        '[squisq-editor] image-edit initial snapshot failed:',
        err instanceof Error ? err.message : err,
      );
    });
  }, [versioning, ready]);

  useEffect(() => {
    if (!versioning) return;
    if (versioningAutoSaveIdleMs <= 0) return;
    if (!state?.doc) return;
    const timer = setTimeout(() => {
      versioning.saveVersion({ doc: docRef.current ?? undefined }).catch((err: unknown) => {
        console.warn(
          '[squisq-editor] image-edit auto-save version failed:',
          err instanceof Error ? err.message : err,
        );
      });
    }, versioningAutoSaveIdleMs);
    return () => clearTimeout(timer);
  }, [versioning, versioningAutoSaveIdleMs, state?.doc]);

  // ── Asset URL cache ────────────────────────────────────────────────────
  const urlCacheRef = useRef<Map<string, string>>(new Map());

  const resolveAssetUrl = useCallback(
    async (path: string): Promise<string> => {
      const cache = urlCacheRef.current;
      const cached = cache.get(path);
      if (cached) return cached;
      const data = await container.readFile(path);
      if (!data) throw new Error(`useImageEditor: missing asset "${path}"`);
      const list = await container.listFiles(path);
      const mime = list.find((e) => e.path === path)?.mimeType ?? 'application/octet-stream';
      const url = URL.createObjectURL(new Blob([data], { type: mime }));
      cache.set(path, url);
      return url;
    },
    [container],
  );

  // Revoke all cached object URLs on unmount / container swap
  useEffect(() => {
    const cache = urlCacheRef.current;
    return () => {
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, [container]);

  const uploadAsset = useCallback(
    async (file: Blob, suggestedName?: string): Promise<string> => {
      const ext = guessExtensionFromMime(file.type) ?? extensionFromName(suggestedName) ?? 'bin';
      const id = randomId();
      const path = `${IMAGE_EDIT_ASSETS_PREFIX}${id}.${ext}`;
      const buf = await file.arrayBuffer();
      await container.writeFile(path, buf, file.type || undefined);
      return path;
    },
    [container],
  );

  return {
    state,
    dispatch,
    flush,
    resolveAssetUrl,
    uploadAsset,
    versioning,
    ready,
    error,
  };
}

// ============================================
// Helpers
// ============================================

async function seedFromSource(
  container: ContentContainer,
  initialSrc: string | undefined,
): Promise<ImageEditDoc> {
  if (!initialSrc) {
    return createEmptyImageEditDoc(800, 600);
  }
  // Fetch the source bytes (works for blob:, data:, http(s):, and same-origin
  // relative URLs).
  const resp = await fetch(initialSrc);
  if (!resp.ok) throw new Error(`useImageEditor: failed to fetch initialSrc (${resp.status})`);
  const blob = await resp.blob();
  const ext = guessExtensionFromMime(blob.type) ?? 'png';
  const assetPath = `${IMAGE_EDIT_ASSETS_PREFIX}source.${ext}`;
  await container.writeFile(assetPath, await blob.arrayBuffer(), blob.type || undefined);

  // Probe natural dimensions by loading into an Image.
  const dims = await probeImageDimensions(initialSrc);
  const w = dims?.width ?? 800;
  const h = dims?.height ?? 600;

  const layer: ImageEditLayer = {
    id: 'base',
    type: 'image',
    name: 'Background',
    position: { x: 0, y: 0, width: w, height: h },
    content: { src: assetPath, alt: '', fit: 'fill' },
  };
  return {
    version: 1,
    canvas: { width: w, height: h, background: 'transparent' },
    layers: [layer],
    meta: {
      sourcePath: assetPath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

function probeImageDimensions(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function guessExtensionFromMime(mime: string | undefined): string | null {
  if (!mime) return null;
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('svg')) return 'svg';
  return null;
}

function extensionFromName(name: string | undefined): string | null {
  if (!name) return null;
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : null;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
