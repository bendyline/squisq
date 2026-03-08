/**
 * LocalForageAdapter tests
 *
 * Uses the localforage library (which falls back to an in-memory driver
 * in jsdom/Node environments) to verify the adapter contract.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LocalForageAdapter } from '../storage/LocalForageAdapter';

describe('LocalForageAdapter', () => {
  let storage: LocalForageAdapter;

  beforeEach(async () => {
    storage = new LocalForageAdapter({ name: 'test-db', storeName: 'test-store' });
    await storage.clear();
  });

  it('supports enumeration', () => {
    expect(storage.supportsEnumeration).toBe(true);
  });

  it('get returns null for missing key', async () => {
    expect(await storage.get('nonexistent')).toBeNull();
  });

  it('set and get round-trip', async () => {
    await storage.set('key', { hello: 'world' });
    expect(await storage.get('key')).toEqual({ hello: 'world' });
  });

  it('stores primitives', async () => {
    await storage.set('str', 'hello');
    await storage.set('num', 42);
    await storage.set('bool', true);
    expect(await storage.get('str')).toBe('hello');
    expect(await storage.get('num')).toBe(42);
    expect(await storage.get('bool')).toBe(true);
  });

  it('overwrites existing values', async () => {
    await storage.set('key', 'first');
    await storage.set('key', 'second');
    expect(await storage.get('key')).toBe('second');
  });

  it('remove deletes a key', async () => {
    await storage.set('key', 'value');
    await storage.remove('key');
    expect(await storage.get('key')).toBeNull();
  });

  it('clear removes all keys', async () => {
    await storage.set('a', 1);
    await storage.set('b', 2);
    await storage.clear();
    expect(await storage.get('a')).toBeNull();
    expect(await storage.get('b')).toBeNull();
    expect(await storage.keys()).toEqual([]);
  });

  it('keys returns all stored keys', async () => {
    await storage.set('alpha', 1);
    await storage.set('beta', 2);
    const keys = await storage.keys();
    expect(keys.sort()).toEqual(['alpha', 'beta']);
  });

  it('stores binary data (ArrayBuffer)', async () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    await storage.set('binary', buffer);
    const result = await storage.get<ArrayBuffer>('binary');
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result!)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it('stores Uint8Array', async () => {
    const data = new Uint8Array([10, 20, 30]);
    await storage.set('bytes', data);
    const result = await storage.get<Uint8Array>('bytes');
    expect(new Uint8Array(result!)).toEqual(new Uint8Array([10, 20, 30]));
  });
});

describe('LocalForageAdapter with prefix', () => {
  let storage: LocalForageAdapter;

  beforeEach(async () => {
    storage = new LocalForageAdapter({
      name: 'test-db-prefix',
      storeName: 'test-store',
      prefix: 'slot1:',
    });
    await storage.clear();
  });

  it('get/set respects prefix', async () => {
    await storage.set('doc', { title: 'My Doc' });
    expect(await storage.get('doc')).toEqual({ title: 'My Doc' });
  });

  it('keys strips prefix', async () => {
    await storage.set('alpha', 1);
    await storage.set('beta', 2);
    const keys = await storage.keys();
    expect(keys.sort()).toEqual(['alpha', 'beta']);
  });

  it('clear only removes prefixed keys', async () => {
    // Write directly to a separate adapter (no prefix) to verify isolation
    const other = new LocalForageAdapter({
      name: 'test-db-prefix',
      storeName: 'test-store',
      prefix: 'slot2:',
    });
    await other.set('other-key', 'should-survive');
    await storage.set('my-key', 'will-be-cleared');

    await storage.clear();

    expect(await storage.get('my-key')).toBeNull();
    expect(await other.get('other-key')).toBe('should-survive');

    // Cleanup
    await other.clear();
  });

  it('different prefixes are isolated', async () => {
    const slot1 = new LocalForageAdapter({
      name: 'test-isolation',
      storeName: 'test-store',
      prefix: 'slot1:',
    });
    const slot2 = new LocalForageAdapter({
      name: 'test-isolation',
      storeName: 'test-store',
      prefix: 'slot2:',
    });

    await slot1.set('doc', 'slot1-doc');
    await slot2.set('doc', 'slot2-doc');

    expect(await slot1.get('doc')).toBe('slot1-doc');
    expect(await slot2.get('doc')).toBe('slot2-doc');

    const keys1 = await slot1.keys();
    const keys2 = await slot2.keys();
    expect(keys1).toEqual(['doc']);
    expect(keys2).toEqual(['doc']);

    // Cleanup
    await slot1.clear();
    await slot2.clear();
  });
});
