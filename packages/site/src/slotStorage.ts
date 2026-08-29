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
 * The createSlotContentContainer(n) factory exposes a slot's media
 * namespace as a `ContentContainer`, which is what the editor needs for
 * everything that reads files *beside* a media asset rather than the asset
 * itself — narration `.timing.json` sidecars, image-edit sidecars, version
 * snapshots. Pair it with `createMediaProviderFromContainer()` so the
 * MediaProvider and the container are two views of one namespace and can
 * never disagree about what a relative path means.
 */

import { LocalForageAdapter, findDocumentPath } from '@bendyline/squisq/storage';
import type { ContentContainer, ContentEntry } from '@bendyline/squisq/storage';
import type { MediaEntry } from '@bendyline/squisq/schemas';

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

/** Return only binary media keys, excluding each asset's `:info` sidecar. */
export function filterMediaDataKeys(allKeys: string[], slot: number): string[] {
  const prefix = mediaKeyPrefix(slot);
  return allKeys.filter((key) => key.startsWith(prefix) && !key.endsWith(':info'));
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
export async function saveSlot(slot: number, markdown: string, name?: string): Promise<void> {
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
  const mediaKeys = filterMediaDataKeys(allKeys, slot);

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
  const size =
    data instanceof Blob
      ? data.size
      : ((data as ArrayBuffer).byteLength ?? (data as Uint8Array).length);
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

// ============================================
// ContentContainer Factory
// ============================================

/** Coerce whatever IndexedDB handed back into an ArrayBuffer. */
async function toArrayBuffer(value: unknown): Promise<ArrayBuffer | null> {
  if (value == null) return null;
  if (value instanceof ArrayBuffer) return value;
  if (value instanceof Blob) return value.arrayBuffer();
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  }
  return null;
}

/**
 * A slot's media namespace, exposed as a `ContentContainer`.
 *
 * Paths map 1:1 onto the `slot:{n}:media:{path}` keys the MediaProvider
 * resolves, so `container.readFile('audio/take.webm.timing.json')` finds the
 * sidecar the recorder wrote next to `audio/take.webm`. That shared namespace
 * is the whole point: a container and a MediaProvider built over different
 * stores would silently disagree, which is exactly how a written sidecar ends
 * up never being read.
 *
 * The slot's markdown lives at `slot:{n}:doc`, OUTSIDE this namespace — the
 * site keeps the document in React state and saves it explicitly. So
 * `getDocumentPath()` is honest about finding nothing unless someone actually
 * writes a `.md` file into the container.
 */
class SlotContentContainer implements ContentContainer {
  readonly mutationLock: object;

  constructor(private readonly slot: number) {
    this.mutationLock = mutationLockFor(slot);
  }

  async readFile(path: string): Promise<ArrayBuffer | null> {
    return toArrayBuffer(await store.get<unknown>(mediaKey(this.slot, path)));
  }

  async writeFile(path: string, data: ArrayBuffer | Uint8Array, mimeType?: string): Promise<void> {
    await addSlotMedia(this.slot, path, data, mimeType ?? 'application/octet-stream');
  }

  async removeFile(path: string): Promise<void> {
    await removeSlotMedia(this.slot, path);
  }

  async listFiles(prefix?: string): Promise<ContentEntry[]> {
    const entries = await listSlotMedia(this.slot);
    return entries
      .filter((entry) => (prefix ? entry.name.startsWith(prefix) : true))
      .map((entry) => ({ path: entry.name, mimeType: entry.mimeType, size: entry.size }));
  }

  async exists(path: string): Promise<boolean> {
    const key = mediaKey(this.slot, path);
    // The companion `:info` record is written with every asset, so it answers
    // existence without pulling the binary back out of IndexedDB. Fall back to
    // the data key for anything written before the companion existed.
    if ((await store.get<unknown>(key + ':info')) != null) return true;
    return (await store.get<unknown>(key)) != null;
  }

  async getDocumentPath(): Promise<string | null> {
    return findDocumentPath(await this.listFiles());
  }

  async readDocument(): Promise<string | null> {
    const path = await this.getDocumentPath();
    if (!path) return null;
    const data = await this.readFile(path);
    return data ? new TextDecoder().decode(data) : null;
  }

  async writeDocument(markdown: string, filename = 'index.md'): Promise<void> {
    await this.writeFile(filename, new TextEncoder().encode(markdown), 'text/markdown');
  }
}

/**
 * Shared per-slot identity so two containers over the same slot serialize
 * their in-process mutations against each other rather than racing.
 */
const mutationLocks = new Map<number, object>();
function mutationLockFor(slot: number): object {
  let lock = mutationLocks.get(slot);
  if (!lock) {
    lock = {};
    mutationLocks.set(slot, lock);
  }
  return lock;
}

/**
 * Create a `ContentContainer` over a storage slot's media namespace.
 *
 * Wrap it in `createMediaProviderFromContainer()` to get the slot's
 * MediaProvider — the two then share one namespace by construction.
 */
export function createSlotContentContainer(slot: number): ContentContainer {
  return new SlotContentContainer(slot);
}
