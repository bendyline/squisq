import { describe, expect, it, vi } from 'vitest';
import { MemoryContentContainer } from '../storage/ContentContainer.js';
import { createMediaProviderFromContainer } from '../storage/MediaProviderFromContainer.js';

describe('uploaded media display cache', () => {
  it('uses the durable upload bytes and MIME without a read or container scan', async () => {
    const container = new MemoryContentContainer();
    const provider = createMediaProviderFromContainer(container);
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:new');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const read = vi.spyOn(container, 'readFile');
    const list = vi.spyOn(container, 'listFiles');
    try {
      await provider.addMedia('photo', new Uint8Array([0, 1, 2, 3]).subarray(1, 3), 'image/png');
      expect(await provider.resolveUrl('photo')).toBe('blob:new');
      expect(read).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
      const blob = create.mock.calls[0][0] as Blob;
      expect(blob.type).toBe('image/png');
      expect(blob.size).toBe(2);
    } finally {
      provider.dispose();
      expect(revoke).toHaveBeenCalledWith('blob:new');
      vi.restoreAllMocks();
    }
  });

  it('creates no display URL for a failed write', async () => {
    const container = new MemoryContentContainer();
    const provider = createMediaProviderFromContainer(container);
    vi.spyOn(container, 'writeFile').mockRejectedValue(new Error('Disk full'));
    const create = vi.spyOn(URL, 'createObjectURL');
    try {
      await expect(
        provider.addMedia('photo.png', new Uint8Array([1]), 'image/png'),
      ).rejects.toThrow('Disk full');
      expect(create).not.toHaveBeenCalled();
    } finally {
      provider.dispose();
      vi.restoreAllMocks();
    }
  });
});
