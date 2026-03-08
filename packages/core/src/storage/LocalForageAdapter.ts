/**
 * LocalForage adapter - IndexedDB storage with automatic fallbacks.
 *
 * Uses localforage which provides IndexedDB storage with automatic
 * fallbacks to WebSQL and localStorage. This allows storing much more
 * data than raw localStorage (which is limited to ~5MB).
 *
 * Unlike LocalStorageAdapter, this adapter can store binary data
 * (ArrayBuffer, Blob, Uint8Array) natively without JSON serialization.
 *
 * Ported from qualla-internal/shared/services/StorageAdapters.ts with
 * configurable store name and key prefix.
 */

import localforage from 'localforage';
import type { StorageAdapter } from './Storage.js';

export interface LocalForageAdapterOptions {
  /** IndexedDB database name (default: 'squisq') */
  name?: string;
  /** IndexedDB object store name (default: 'data') */
  storeName?: string;
  /** Key prefix for namespacing (default: '') */
  prefix?: string;
  /** Human-readable description (default: 'Squisq storage') */
  description?: string;
}

export class LocalForageAdapter implements StorageAdapter {
  readonly supportsEnumeration = true;
  private store: LocalForage;
  private prefix: string;

  constructor(options: LocalForageAdapterOptions = {}) {
    const {
      name = 'squisq',
      storeName = 'data',
      prefix = '',
      description = 'Squisq storage',
    } = options;

    this.prefix = prefix;
    this.store = localforage.createInstance({ name, storeName, description });
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.store.getItem<T>(this.prefix + key);
      return value;
    } catch (e) {
      console.warn('[Storage] get (IndexedDB) failed:', key, e);
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      await this.store.setItem(this.prefix + key, value);
    } catch (e) {
      console.error('[Storage] set (IndexedDB) failed:', key, e);
      throw e;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.store.removeItem(this.prefix + key);
    } catch (e) {
      console.warn('[Storage] remove (IndexedDB) failed:', key, e);
    }
  }

  async clear(): Promise<void> {
    try {
      if (this.prefix) {
        // Only remove keys with our prefix
        const keys = await this.store.keys();
        const keysToRemove = keys.filter((k) => k.startsWith(this.prefix));
        await Promise.all(keysToRemove.map((k) => this.store.removeItem(k)));
      } else {
        // No prefix — clear the entire store
        await this.store.clear();
      }
    } catch (e) {
      console.error('[Storage] clear (IndexedDB) failed:', e);
    }
  }

  async keys(): Promise<string[]> {
    try {
      const allKeys = await this.store.keys();
      if (this.prefix) {
        return allKeys
          .filter((k) => k.startsWith(this.prefix))
          .map((k) => k.slice(this.prefix.length));
      }
      return allKeys;
    } catch (e) {
      console.warn('[Storage] keys (IndexedDB) failed:', e);
      return [];
    }
  }
}
