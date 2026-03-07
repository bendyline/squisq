/**
 * Storage - Abstract persistence interface
 *
 * Defines the contract for persistent storage across different environments.
 * All values are JSON-serialized, so any serializable value can be stored.
 * Keys can be automatically namespaced with a configurable prefix.
 */

/** Storage adapter interface - implemented by environment-specific adapters */
export interface StorageAdapter {
  /** Get a value by key, returns null if not found */
  get<T>(key: string): Promise<T | null>;

  /** Set a value for a key */
  set<T>(key: string, value: T): Promise<void>;

  /** Remove a value by key */
  remove(key: string): Promise<void>;

  /** Clear all stored values (within our namespace) */
  clear(): Promise<void>;

  /** Get all keys (within our namespace) */
  keys(): Promise<string[]>;

  /** Check if this adapter supports enumeration */
  readonly supportsEnumeration: boolean;
}