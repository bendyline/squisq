/**
 * MediaProviderFromContainer — bridges ContentContainer to MediaProvider.
 *
 * Creates a MediaProvider that resolves relative paths by reading binary data
 * from a ContentContainer and generating blob URLs. Blob URLs are cached and
 * revoked on dispose().
 *
 * This allows any ContentContainer (memory, slot-backed, zip-loaded) to be
 * used with existing rendering components (DocPlayer, ImageLayer, VideoLayer)
 * that consume MediaProvider.
 */

import type { MediaProvider, MediaEntry } from '../schemas/MediaProvider.js';
import type { ContentContainer } from './ContentContainer.js';

/**
 * Create a MediaProvider backed by a ContentContainer.
 *
 * @param container — The ContentContainer to read/write media from
 * @returns A MediaProvider that resolves paths to blob URLs
 */
export function createMediaProviderFromContainer(container: ContentContainer): MediaProvider {
  const blobUrlCache = new Map<string, string>();
  const pending = new Map<string, Promise<string>>();
  const generations = new Map<string, number>();
  let disposed = false;

  function invalidate(path: string): void {
    generations.set(path, (generations.get(path) ?? 0) + 1);
    pending.delete(path);
    const cached = blobUrlCache.get(path);
    if (cached) URL.revokeObjectURL(cached);
    blobUrlCache.delete(path);
  }

  function resolveUrl(relativePath: string): Promise<string> {
    if (disposed) return Promise.resolve(relativePath);
    const cached = blobUrlCache.get(relativePath);
    if (cached) return Promise.resolve(cached);
    const existing = pending.get(relativePath);
    if (existing) return existing;
    const generation = generations.get(relativePath) ?? 0;
    const work = (async () => {
      const data = await container.readFile(relativePath);
      if (disposed) return relativePath;
      if ((generations.get(relativePath) ?? 0) !== generation) return resolveUrl(relativePath);
      const entries = data ? await container.listFiles() : [];
      if (disposed) return relativePath;
      // A read begun before a write must never refill the new cache.
      if ((generations.get(relativePath) ?? 0) !== generation) return resolveUrl(relativePath);
      if (!data) return relativePath;
      const mimeType = entries.find((e) => e.path === relativePath)?.mimeType;
      const url = URL.createObjectURL(
        new Blob([data], { type: mimeType ?? 'application/octet-stream' }),
      );
      blobUrlCache.set(relativePath, url);
      return url;
    })().finally(() => {
      if (pending.get(relativePath) === work) pending.delete(relativePath);
    });
    pending.set(relativePath, work);
    return work;
  }

  return {
    resolveUrl,

    async listMedia(): Promise<MediaEntry[]> {
      const entries = await container.listFiles();
      return entries
        .filter((e) => !e.path.toLowerCase().endsWith('.md'))
        .map((e) => ({
          name: e.path,
          mimeType: e.mimeType,
          size: e.size,
        }));
    },

    async addMedia(
      name: string,
      data: ArrayBuffer | Blob | Uint8Array,
      mimeType: string,
    ): Promise<string> {
      // Invalidate any cached blob URL for this path before overwriting
      invalidate(name);
      const generation = generations.get(name);

      let buffer: ArrayBuffer | Uint8Array;
      if (data instanceof Blob) {
        buffer = await data.arrayBuffer();
      } else {
        buffer = data;
      }
      await container.writeFile(name, buffer, mimeType);
      const canCacheUpload = generations.get(name) === generation;
      invalidate(name);
      // The upload is durable and its bytes/MIME are already available. Avoid
      // reading it back and listing the whole container before it can appear.
      if (!disposed && canCacheUpload) {
        const bytes = ArrayBuffer.isView(buffer) ? new Uint8Array(buffer).slice().buffer : buffer;
        blobUrlCache.set(name, URL.createObjectURL(new Blob([bytes], { type: mimeType })));
      }
      return name;
    },

    async removeMedia(relativePath: string): Promise<void> {
      invalidate(relativePath);
      await container.removeFile(relativePath);
      invalidate(relativePath);
    },

    dispose(): void {
      disposed = true;
      pending.clear();
      for (const url of blobUrlCache.values()) {
        URL.revokeObjectURL(url);
      }
      blobUrlCache.clear();
    },
  };
}
