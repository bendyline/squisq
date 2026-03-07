import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStorageAdapter } from '../storage/MemoryStorageAdapter';

describe('MemoryStorageAdapter', () => {
  let storage: MemoryStorageAdapter;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
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
});
