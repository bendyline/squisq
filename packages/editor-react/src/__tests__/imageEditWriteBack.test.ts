import { describe, expect, it } from 'vitest';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import type { ImageEditDoc } from '@bendyline/squisq/schemas';
import {
  IMAGE_EDIT_WRITE_BACK_FILENAME,
  digestBytes,
  imageEditSignature,
  imageSaveFormatForPath,
  isPristineImageEditDoc,
  needsWriteBack,
  readWriteBackSignature,
  readWriteBackState,
  writeWriteBackSignature,
} from '../imageEditor/writeBack';

function seeded(): ImageEditDoc {
  return {
    version: 1,
    canvas: { width: 3024, height: 4032, background: 'transparent' },
    layers: [
      {
        id: 'base',
        type: 'image',
        name: 'Background',
        position: { x: 0, y: 0, width: 3024, height: 4032 },
        content: { src: 'assets/source.jpg', alt: '', fit: 'fill' },
      },
    ],
    meta: { sourcePath: 'assets/source.jpg', createdAt: 'a', updatedAt: 'a' },
  };
}

function withText(doc: ImageEditDoc): ImageEditDoc {
  return {
    ...doc,
    layers: [
      ...doc.layers,
      {
        id: 'layer-1',
        type: 'text',
        name: 'Text',
        position: { x: 892, y: 872, width: 240, height: 48 },
        content: {
          text: 'Yess yat',
          style: { fontSize: 320, color: '#111111', fontFamily: 'sans-serif' },
        },
      },
    ],
  };
}

describe('image-edit write-back bookkeeping', () => {
  it('ignores meta timestamps and key order in the signature', () => {
    const a = withText(seeded());
    const b: ImageEditDoc = JSON.parse(JSON.stringify(a));
    b.meta = { ...b.meta, updatedAt: 'later' };
    const [base] = b.layers;
    // Same layer, keys inserted in a different order.
    b.layers[0] = {
      content: base!.content,
      position: base!.position,
      name: base!.name,
      type: 'image',
      id: base!.id,
    } as ImageEditDoc['layers'][number];
    expect(imageEditSignature(b)).toBe(imageEditSignature(a));
  });

  it('changes the signature when a layer changes', () => {
    const a = withText(seeded());
    const b = withText(seeded());
    const text = b.layers[1]!;
    if (text.type !== 'text') throw new Error('expected text layer');
    text.content = { ...text.content, text: 'Yes yet' };
    expect(imageEditSignature(b)).not.toBe(imageEditSignature(a));
  });

  it('treats only the untouched seed as pristine', () => {
    expect(isPristineImageEditDoc(seeded())).toBe(true);
    expect(isPristineImageEditDoc(withText(seeded()))).toBe(false);
    const moved = seeded();
    moved.layers[0]!.position = { x: 203, y: -591, width: 3024, height: 4032 };
    expect(isPristineImageEditDoc(moved)).toBe(false);
    const hidden = seeded();
    hidden.layers[0]!.visible = false;
    expect(isPristineImageEditDoc(hidden)).toBe(false);
  });

  it('needs a write-back for unrecorded edits, and only for changes after a record', () => {
    const edited = withText(seeded());
    // Edits left by a session that closed without writing the picture.
    expect(needsWriteBack(edited, null)).toBe(true);
    expect(needsWriteBack(seeded(), null)).toBe(false);
    const written = imageEditSignature(edited);
    expect(needsWriteBack(edited, written)).toBe(false);
    // Reverting to the seed after a write-back must restore the picture.
    expect(needsWriteBack(seeded(), written)).toBe(true);
  });

  it('round-trips the record through the sidecar and tolerates junk', async () => {
    const sidecar = new MemoryContentContainer();
    expect(await readWriteBackSignature(sidecar)).toBeNull();
    await writeWriteBackSignature(sidecar, 'abc123');
    expect(await readWriteBackSignature(sidecar)).toBe('abc123');
    await sidecar.writeFile(IMAGE_EDIT_WRITE_BACK_FILENAME, new TextEncoder().encode('{nope'));
    expect(await readWriteBackSignature(sidecar)).toBeNull();
  });

  it('records the picture digest beside the signature, and reads old records without one', async () => {
    const sidecar = new MemoryContentContainer();
    await writeWriteBackSignature(sidecar, 'abc123');
    expect(await readWriteBackState(sidecar)).toEqual({ signature: 'abc123', pictureDigest: null });
    await writeWriteBackSignature(sidecar, 'def456', 'digest-1');
    expect(await readWriteBackState(sidecar)).toEqual({
      signature: 'def456',
      pictureDigest: 'digest-1',
    });
    expect(await readWriteBackSignature(sidecar)).toBe('def456');
  });

  it('digests bytes by content, for any view of them', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    expect(digestBytes(a)).toBe(digestBytes(new Uint8Array([1, 2, 3, 4]).buffer));
    expect(digestBytes(a)).not.toBe(digestBytes(new Uint8Array([1, 2, 3, 5])));
    // Same prefix, different length.
    expect(digestBytes(a)).not.toBe(digestBytes(new Uint8Array([1, 2, 3, 4, 0])));
    // A view into a larger buffer digests only its own bytes.
    const view = new Uint8Array([9, 1, 2, 3, 4, 9]).subarray(1, 5);
    expect(digestBytes(view)).toBe(digestBytes(a));
  });

  it('saves pictures back only in a format that keeps the file type', () => {
    expect(imageSaveFormatForPath('a.png')).toBe('png');
    expect(imageSaveFormatForPath('shots/Photo.JPG')).toBe('jpeg');
    expect(imageSaveFormatForPath('x.jpeg?v=2')).toBe('jpeg');
    expect(imageSaveFormatForPath('x.webp#frag')).toBe('webp');
    for (const name of ['x.gif', 'x.svg', 'x.avif', 'x.bmp', 'x.ico', 'png']) {
      expect(imageSaveFormatForPath(name)).toBeNull();
    }
  });
});
