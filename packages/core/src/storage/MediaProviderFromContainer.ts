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

  return {
    async resolveUrl(relativePath: string): Promise<string> {
      const cached = blobUrlCache.get(relativePath);
      if (cached) return cached;

      const data = await container.readFile(relativePath);
      if (!data) return relativePath;

      const entries = await container.listFiles();
      const entry = entries.find((e) => e.path === relativePath);
      const mimeType = entry?.mimeType ?? 'application/octet-stream';

      const blob = new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);
      blobUrlCache.set(relativePath, url);
      return url;
    },

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
      const cached = blobUrlCache.get(name);
      if (cached) {
        URL.revokeObjectURL(cached);
        blobUrlCache.delete(name);
      }

      let buffer: ArrayBuffer | Uint8Array;
      if (data instanceof Blob) {
        buffer = await data.arrayBuffer();
      } else {
        buffer = data;
      }
      await container.writeFile(name, buffer, mimeType);
      return name;
    },

    async removeMedia(relativePath: string): Promise<void> {
      const cached = blobUrlCache.get(relativePath);
      if (cached) {
        URL.revokeObjectURL(cached);
        blobUrlCache.delete(relativePath);
      }
      await container.removeFile(relativePath);
    },

    dispose(): void {
      for (const url of blobUrlCache.values()) {
        URL.revokeObjectURL(url);
      }
      blobUrlCache.clear();
    },
  };
}
