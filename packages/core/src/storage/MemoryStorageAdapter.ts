/**
 * In-memory storage adapter for testing and SSR environments.
 * Data does not persist across page reloads.
 */

import type { StorageAdapter } from './Storage.js';

export class MemoryStorageAdapter implements StorageAdapter {
  readonly supportsEnumeration = true;
  private store = new Map<string, string>();

  async get<T>(key: string): Promise<T | null> {
    const val = this.store.get(key);
    if (val === undefined) return null;
    try {
      return JSON.parse(val) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async keys(): Promise<string[]> {
    return Array.from(this.store.keys());
  }
}