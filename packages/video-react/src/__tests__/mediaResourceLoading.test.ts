import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Doc } from '@bendyline/squisq/schemas';
import { collectDocumentMediaReferences } from '../hooks/useVideoExport.js';
import { createInlineProvider } from '../hooks/useFrameCapture.js';

afterEach(() => vi.restoreAllMocks());

describe('video export media resource loading', () => {
  it('collects document references without treating unrelated provider files as needed', () => {
    const doc = {
      blocks: [{ layers: [{ type: 'image', src: 'used.png' }] }],
      audioTrack: { segments: [{ src: './narration.mp3' }] },
    } as unknown as Doc;
    const references = collectDocumentMediaReferences(doc);
    expect(references).toContain('used.png');
    expect(references).toContain('narration.mp3');
    expect(references).not.toContain('unrelated.png');
  });

  it('uses revocable blob URLs instead of base64-expanded data URLs', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export-media');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const provider = createInlineProvider(
      new Map([['hero.png', new Uint8Array([1, 2, 3]).buffer]]),
    );

    expect(await provider.resolveUrl('hero.png')).toBe('blob:export-media');
    expect(create).toHaveBeenCalledOnce();
    provider.dispose();
    expect(revoke).toHaveBeenCalledWith('blob:export-media');
  });
});
