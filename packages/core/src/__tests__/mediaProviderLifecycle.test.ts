import { describe, expect, it, vi } from 'vitest';
import { MemoryContentContainer } from '../storage/ContentContainer.js';
import { createMediaProviderFromContainer } from '../storage/MediaProviderFromContainer.js';
const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
describe('review: media provider lifetime', () => {
  it('invalidates an old URL populated while an overwrite was still pending', async () => {
    const container = new MemoryContentContainer();
    await container.writeFile('image.png', encode('old'), 'image/png');
    const p = createMediaProviderFromContainer(container);
    let sequence = 0;
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => `blob:test-${++sequence}`);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const write = container.writeFile.bind(container);
    vi.spyOn(container, 'writeFile').mockImplementation(async (...args) => {
      await gate;
      return write(...args);
    });
    try {
      const saving = p.addMedia('image.png', encode('new'), 'image/png');
      const oldUrl = await p.resolveUrl('image.png');
      finish();
      await saving;
      expect(new TextDecoder().decode((await container.readFile('image.png'))!)).toBe('new');
      expect(await p.resolveUrl('image.png')).not.toBe(oldUrl);
    } finally {
      p.dispose();
      create.mockRestore();
      revoke.mockRestore();
    }
  });
  it('revokes every URL when the same asset is requested concurrently', async () => {
    const container = new MemoryContentContainer();
    await container.writeFile('image.png', encode('image'), 'image/png');
    const p = createMediaProviderFromContainer(container);
    let sequence = 0;
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => `blob:test-${++sequence}`);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      const urls = await Promise.all([p.resolveUrl('image.png'), p.resolveUrl('image.png')]);
      p.dispose();
      expect(new Set(revoke.mock.calls.map((args) => args[0]))).toEqual(new Set(urls));
    } finally {
      create.mockRestore();
      revoke.mockRestore();
    }
  });
});
