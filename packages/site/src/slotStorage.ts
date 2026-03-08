/**
 * SlotStorage — 10-slot document + media storage backed by IndexedDB.
 *
 * Each slot holds:
 *   - A markdown document string
 *   - Metadata (name, last modified)
 *   - Zero or more binary media assets (images, videos)
 *
 * Key schema within the LocalForageAdapter:
 *   slot:{n}:doc       → string (markdown source)
 *   slot:{n}:meta      → SlotMeta object
 *   slot:{n}:media:{filename} → ArrayBuffer (binary asset)
 *
 * The createSlotMediaProvider(n) factory returns a MediaProvider that
 * resolves relative paths to blob URLs from the slot's stored media.
 */

import { LocalForageAdapter } from '@bendyline/squisq/storage';
import type { MediaProvider, MediaEntry } from '@bendyline/squisq/schemas';

// ============================================
// Constants
// ============================================

export const SLOT_COUNT = 10;

const DB_NAME = 'squisq-site';
const STORE_NAME = 'slots';

// ============================================
// Types
// ============================================

export interface SlotMeta {
  /** User-visible name (defaults to 'Slot N') */
  name: string;
  /** ISO timestamp of last save */
  lastModified: string;
  /** Number of media assets stored */
  mediaCount: number;
}

// ============================================
// Storage Singleton
// ============================================

const store = new LocalForageAdapter({
  name: DB_NAME,
  storeName: STORE_NAME,
});

// ============================================
// Key Helpers
// ============================================

function docKey(slot: number): string {
  return `slot:${slot}:doc`;
}

function metaKey(slot: number): string {
  return `slot:${slot}:meta`;
}

function mediaKeyPrefix(slot: number): string {
  return `slot:${slot}:media:`;
}

function mediaKey(slot: number, filename: string): string {
  return `${mediaKeyPrefix(slot)}${filename}`;
}

// ============================================
// Slot Metadata
// ============================================

/**
 * Get metadata for a single slot. Returns null if the slot is empty.
 */
export async function getSlotMeta(slot: number): Promise<SlotMeta | null> {
  return store.get<SlotMeta>(metaKey(slot));
}

/**
 * Get metadata for all slots. Returns an array of length SLOT_COUNT
 * where empty slots are null.
 */
export async function getAllSlotMeta(): Promise<(SlotMeta | null)[]> {
  const results: (SlotMeta | null)[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    results.push(await store.get<SlotMeta>(metaKey(i)));
  }
  return results;
}

// ============================================
// Save / Load / Clear
// ============================================

/**
 * Save a document to a slot.
 */
export async function saveSlot(
  slot: number,
  markdown: string,
  name?: string,
): Promise<void> {
  const existing = await getSlotMeta(slot);
  const mediaCount = existing?.mediaCount ?? 0;

  const meta: SlotMeta = {
    name: name ?? existing?.name ?? `Slot ${slot + 1}`,
    lastModified: new Date().toISOString(),
    mediaCount,
  };

  await store.set(docKey(slot), markdown);
  await store.set(metaKey(slot), meta);
}

/**
 * Load a document from a slot. Returns null if the slot is empty.
 */
export async function loadSlot(slot: number): Promise<string | null> {
  return store.get<string>(docKey(slot));
}

/**
 * Clear a slot — removes the document, metadata, and all media.
 */
export async function clearSlot(slot: number): Promise<void> {
  await store.remove(docKey(slot));
  await store.remove(metaKey(slot));

  // Remove all media for this slot
  const prefix = mediaKeyPrefix(slot);
  const allKeys = await store.keys();
  const mediaKeys = allKeys.filter((k) => k.startsWith(prefix));
  await Promise.all(mediaKeys.map((k) => store.remove(k)));
}

// ============================================
// Media Operations
// ============================================

/**
 * List media assets stored in a slot.
 */
export async function listSlotMedia(slot: number): Promise<MediaEntry[]> {
  const prefix = mediaKeyPrefix(slot);
  const allKeys = await store.keys();
  const mediaKeys = allKeys.filter((k) => k.startsWith(prefix));

  const entries: MediaEntry[] = [];
  for (const key of mediaKeys) {
    const filename = key.slice(prefix.length);
    // Stored alongside the binary is a companion meta key
    const metaInfo = await store.get<{ mimeType: string; size: number }>(key + ':info');
    entries.push({
      name: filename,
      mimeType: metaInfo?.mimeType ?? 'application/octet-stream',
      size: metaInfo?.size ?? 0,
    });
  }
  return entries;
}

/**
 * Add a media asset to a slot. Returns the relative path for document references.
 */
export async function addSlotMedia(
  slot: number,
  filename: string,
  data: ArrayBuffer | Blob | Uint8Array,
  mimeType: string,
): Promise<string> {
  const key = mediaKey(slot, filename);

  // Store binary data
  await store.set(key, data);
  // Store companion metadata
  const size = data instanceof Blob ? data.size : (data as ArrayBuffer).byteLength ?? (data as Uint8Array).length;
  await store.set(key + ':info', { mimeType, size });

  // Update slot meta media count
  const meta = await getSlotMeta(slot);
  if (meta) {
    meta.mediaCount = (await listSlotMedia(slot)).length;
    await store.set(metaKey(slot), meta);
  }

  return filename;
}

/**
 * Remove a media asset from a slot.
 */
export async function removeSlotMedia(slot: number, filename: string): Promise<void> {
  const key = mediaKey(slot, filename);
  await store.remove(key);
  await store.remove(key + ':info');

  // Update slot meta media count
  const meta = await getSlotMeta(slot);
  if (meta) {
    meta.mediaCount = (await listSlotMedia(slot)).length;
    await store.set(metaKey(slot), meta);
  }
}

/**
 * Get raw media data from a slot.
 */
export async function getSlotMedia(slot: number, filename: string): Promise<ArrayBuffer | null> {
  const key = mediaKey(slot, filename);
  return store.get<ArrayBuffer>(key);
}

// ============================================
// MediaProvider Factory
// ============================================

/**
 * Create a MediaProvider backed by a specific storage slot.
 *
 * Resolves relative paths to blob URLs by reading binary data from IndexedDB.
 * Blob URLs are cached and revoked on dispose().
 */
export function createSlotMediaProvider(slot: number): MediaProvider {
  // Cache: filename → blob URL (to avoid re-creating blob URLs on every render)
  const blobUrlCache = new Map<string, string>();

  return {
    async resolveUrl(relativePath: string): Promise<string> {
      // Check cache first
      const cached = blobUrlCache.get(relativePath);
      if (cached) return cached;

      // Try to load from storage
      const data = await getSlotMedia(slot, relativePath);
      if (!data) {
        // No stored media — return the path as-is (fallback)
        return relativePath;
      }

      // Get MIME type from companion metadata
      const key = mediaKey(slot, relativePath);
      const info = await store.get<{ mimeType: string; size: number }>(key + ':info');
      const mimeType = info?.mimeType ?? 'application/octet-stream';

      // Create blob URL
      const blob = new Blob([data], { type: mimeType });
      const url = URL.createObjectURL(blob);
      blobUrlCache.set(relativePath, url);
      return url;
    },

    async listMedia(): Promise<MediaEntry[]> {
      return listSlotMedia(slot);
    },

    async addMedia(name: string, data: ArrayBuffer | Blob | Uint8Array, mimeType: string): Promise<string> {
      return addSlotMedia(slot, name, data, mimeType);
    },

    async removeMedia(relativePath: string): Promise<void> {
      // Revoke cached blob URL
      const cached = blobUrlCache.get(relativePath);
      if (cached) {
        URL.revokeObjectURL(cached);
        blobUrlCache.delete(relativePath);
      }
      return removeSlotMedia(slot, relativePath);
    },

    dispose(): void {
      // Revoke all cached blob URLs
      for (const url of blobUrlCache.values()) {
        URL.revokeObjectURL(url);
      }
      blobUrlCache.clear();
    },
  };
}
