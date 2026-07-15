import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalStorageAdapter } from '../storage/LocalStorageAdapter';

describe('LocalStorageAdapter', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips JSON values inside its namespace', async () => {
    const storage = new LocalStorageAdapter('app:');

    await storage.set('settings', { compact: true, zoom: 1.25 });
    await storage.set('count', 3);

    expect(storage.supportsEnumeration).toBe(true);
    expect(localStorage.getItem('app:settings')).toBe('{"compact":true,"zoom":1.25}');
    expect(await storage.get('settings')).toEqual({ compact: true, zoom: 1.25 });
    expect(await storage.get('count')).toBe(3);
    expect((await storage.keys()).sort()).toEqual(['count', 'settings']);
  });

  it('returns null for missing, malformed, or inaccessible values', async () => {
    const storage = new LocalStorageAdapter('app:');
    localStorage.setItem('app:malformed', '{not-json');

    expect(await storage.get('missing')).toBeNull();
    expect(await storage.get('malformed')).toBeNull();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(await storage.get('blocked')).toBeNull();
  });

  it('removes individual values without affecting other namespaces', async () => {
    const storage = new LocalStorageAdapter('app:');
    await storage.set('first', 1);
    await storage.set('second', 2);
    localStorage.setItem('other:first', 'preserve me');

    await storage.remove('first');

    expect(await storage.get('first')).toBeNull();
    expect(await storage.get('second')).toBe(2);
    expect(localStorage.getItem('other:first')).toBe('preserve me');
  });

  it('clears only keys belonging to its prefix', async () => {
    const storage = new LocalStorageAdapter('app:');
    await storage.set('first', 1);
    await storage.set('second', 2);
    localStorage.setItem('other:first', 'preserve me');

    await storage.clear();

    expect(await storage.keys()).toEqual([]);
    expect(localStorage.getItem('app:first')).toBeNull();
    expect(localStorage.getItem('app:second')).toBeNull();
    expect(localStorage.getItem('other:first')).toBe('preserve me');
  });
});
