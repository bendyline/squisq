import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The slot workspace's core invariant: the `ContentContainer` and the
 * `MediaProvider` derived from it are two views of ONE namespace.
 *
 * This is the guarantee a document narration depends on. The recorder writes
 * `<media>.timing.json` through the MediaProvider and `applyNarrationTiming`
 * reads it back through the container; when those were separate stores the
 * sidecar was written correctly and then never found, and block timings
 * silently never updated.
 */

const backing = new Map<string, unknown>();

vi.mock('localforage', () => ({
  default: {
    createInstance: () => ({
      getItem: async (key: string) => (backing.has(key) ? backing.get(key) : null),
      setItem: async (key: string, value: unknown) => {
        backing.set(key, value);
        return value;
      },
      removeItem: async (key: string) => {
        backing.delete(key);
      },
      keys: async () => [...backing.keys()],
      clear: async () => backing.clear(),
    }),
  },
}));

const { createSlotContentContainer } = await import('../slotStorage.js');
const { createMediaProviderFromContainer } = await import('@bendyline/squisq/storage');

const bytes = (text: string) => new TextEncoder().encode(text);

describe('createSlotContentContainer', () => {
  beforeEach(() => backing.clear());

  it('reads back a sidecar the MediaProvider wrote beside a media asset', async () => {
    const container = createSlotContentContainer(3);
    const provider = createMediaProviderFromContainer(container);

    await provider.addMedia('video/take.webm', bytes('video-bytes'), 'video/webm');
    await provider.addMedia(
      'video/take.webm.timing.json',
      bytes('{"version":3}'),
      'application/json',
    );

    const sidecar = await container.readFile('video/take.webm.timing.json');
    expect(sidecar).not.toBeNull();
    expect(new TextDecoder().decode(sidecar!)).toBe('{"version":3}');

    provider.dispose();
  });

  it('round-trips writes through the container itself', async () => {
    const container = createSlotContentContainer(0);
    await container.writeFile('audio/n.webm.timing.json', bytes('sidecar'), 'application/json');

    expect(new TextDecoder().decode((await container.readFile('audio/n.webm.timing.json'))!)).toBe(
      'sidecar',
    );
    expect(await container.exists('audio/n.webm.timing.json')).toBe(true);
    expect(await container.exists('audio/missing.json')).toBe(false);
    expect(await container.readFile('audio/missing.json')).toBeNull();
  });

  it('lists entries with their mime types and filters by prefix', async () => {
    const container = createSlotContentContainer(1);
    await container.writeFile('images/hero.png', bytes('png'), 'image/png');
    await container.writeFile('audio/take.webm', bytes('webm'), 'audio/webm');

    const all = await container.listFiles();
    expect(all.map((e) => e.path).sort()).toEqual(['audio/take.webm', 'images/hero.png']);
    expect(all.find((e) => e.path === 'images/hero.png')?.mimeType).toBe('image/png');

    const audio = await container.listFiles('audio/');
    expect(audio.map((e) => e.path)).toEqual(['audio/take.webm']);
  });

  it('scopes each slot to its own namespace', async () => {
    await createSlotContentContainer(4).writeFile(
      'a.bin',
      bytes('four'),
      'application/octet-stream',
    );
    expect(await createSlotContentContainer(5).readFile('a.bin')).toBeNull();
    expect(await createSlotContentContainer(5).listFiles()).toEqual([]);
  });

  it('removes files', async () => {
    const container = createSlotContentContainer(2);
    await container.writeFile('x.bin', bytes('x'), 'application/octet-stream');
    await container.removeFile('x.bin');
    expect(await container.exists('x.bin')).toBe(false);
    expect(await container.listFiles()).toEqual([]);
  });

  it('reports no document — a slot keeps its markdown outside the media namespace', async () => {
    const container = createSlotContentContainer(6);
    await container.writeFile('images/hero.png', bytes('png'), 'image/png');
    expect(await container.getDocumentPath()).toBeNull();
    expect(await container.readDocument()).toBeNull();
  });

  it('shares one mutation lock per slot', () => {
    expect(createSlotContentContainer(7).mutationLock).toBe(
      createSlotContentContainer(7).mutationLock,
    );
    expect(createSlotContentContainer(7).mutationLock).not.toBe(
      createSlotContentContainer(8).mutationLock,
    );
  });
});
