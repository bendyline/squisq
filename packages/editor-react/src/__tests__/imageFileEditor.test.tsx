/** @vitest-environment jsdom */
/**
 * Outside-in editing of an image file: the picture stays the file, its
 * layers live in the sidecar, and the two must never disagree for long —
 * nor may stale layers be flattened over a picture replaced outside.
 */
import { forwardRef, useImperativeHandle } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryContentContainer, scopeContainer } from '@bendyline/squisq/storage';
import { writeImageEditDoc } from '@bendyline/squisq/imageEdit';
import type { ImageEditDoc } from '@bendyline/squisq/schemas';

const harness = vi.hoisted(() => ({
  /** A Blob of `text`; jsdom's Blob lacks arrayBuffer(), so supply it. */
  textBlob(text: string): Blob {
    const bytes = new TextEncoder().encode(text);
    const blob = new Blob([bytes]);
    if (typeof blob.arrayBuffer !== 'function') {
      Object.defineProperty(blob, 'arrayBuffer', { value: async () => bytes.slice().buffer });
    }
    return blob;
  },
  doc: null as ImageEditDoc | null,
  mounts: 0,
  props: null as null | {
    initialSrc?: string;
    saveBehavior?: string;
    saveFormat?: string;
    exportBasename?: string;
    onExport?: (blob: Blob, format: 'png' | 'jpeg' | 'webp', doc: ImageEditDoc) => Promise<void>;
  },
}));

vi.mock('../ImageEditor', async () => {
  const { useEffect } = await import('react');
  return {
    ImageEditor: forwardRef(function ImageEditorStub(
      props: NonNullable<typeof harness.props>,
      ref,
    ) {
      harness.props = props;
      useEffect(() => {
        harness.mounts += 1;
      }, []);
      useImperativeHandle(ref, () => ({
        getDoc: () => harness.doc,
        save: async () => false,
      }));
      return (
        <button
          type="button"
          data-testid="image-editor-stub"
          onClick={() => void props.onExport?.(harness.textBlob('saved'), 'png', harness.doc!)}
        >
          Save
        </button>
      );
    }),
  };
});

vi.mock('@bendyline/squisq/imageEdit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bendyline/squisq/imageEdit')>();
  // jsdom cannot rasterize.
  return { ...actual, exportImageEditDoc: vi.fn(async () => harness.textBlob('flattened')) };
});

import { ImageFileEditor } from '../imageEditor/ImageFileEditor';
import { prepareImageFileSidecar } from '../imageEditor/imageFileSidecar';
import {
  IMAGE_EDIT_WRITE_BACK_FILENAME,
  digestBytes,
  imageEditSignature,
  readWriteBackState,
  writeWriteBackSignature,
} from '../imageEditor/writeBack';

// ── Fixtures ──────────────────────────────────────────────────────────

const u32be = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const pngChunk = (type: string, data: number[]) => [
  ...u32be(data.length),
  ...ascii(type),
  ...data,
  0,
  0,
  0,
  0,
];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function stillPng(fill: number): Uint8Array {
  return new Uint8Array([
    ...PNG_SIGNATURE,
    ...pngChunk('IHDR', new Array(13).fill(0)),
    ...pngChunk('IDAT', [fill, fill, fill]),
    ...pngChunk('IEND', []),
  ]);
}

function animatedPng(): Uint8Array {
  return new Uint8Array([
    ...PNG_SIGNATURE,
    ...pngChunk('IHDR', new Array(13).fill(0)),
    ...pngChunk('acTL', [...u32be(2), ...u32be(0)]),
    ...pngChunk('fcTL', [...u32be(0), ...new Array(16).fill(0), 0, 1, 0, 10, 0, 0]),
    ...pngChunk('IDAT', [1, 2, 3]),
    ...pngChunk('fcTL', [...u32be(1), ...new Array(16).fill(0), 0, 1, 0, 10, 0, 0]),
    ...pngChunk('fdAT', [1, 2, 3]),
    ...pngChunk('IEND', []),
  ]);
}

function dataUrl(bytes: Uint8Array, mime = 'image/png'): string {
  return `data:${mime};base64,${btoa(String.fromCharCode(...bytes))}`;
}

const PICTURE = stillPng(1);
const REPLACED = stillPng(2);

function seeded(): ImageEditDoc {
  return {
    version: 1,
    canvas: { width: 300, height: 400, background: 'transparent' },
    layers: [
      {
        id: 'base',
        type: 'image',
        name: 'Background',
        position: { x: 0, y: 0, width: 300, height: 400 },
        content: { src: 'assets/source.png', alt: '', fit: 'fill' },
      },
    ],
    meta: { sourcePath: 'assets/source.png' },
  };
}

function withText(): ImageEditDoc {
  const doc = seeded();
  doc.layers.push({
    id: 'layer-1',
    type: 'text',
    name: 'Text',
    position: { x: 10, y: 20, width: 240, height: 48 },
    content: { text: 'Look here', style: { fontSize: 32, color: '#111111' } },
  });
  return doc;
}

function sidecar() {
  return scopeContainer(new MemoryContentContainer(), 'photo.png_files');
}

function renderEditor(
  props: Partial<Parameters<typeof ImageFileEditor>[0]> & {
    container: ReturnType<typeof sidecar>;
  },
) {
  const onWriteBack = props.onWriteBack ?? vi.fn(async () => {});
  const element = (
    <ImageFileEditor
      src={dataUrl(PICTURE)}
      fileName="shots/photo.png"
      fallback={<div data-testid="viewer-fallback" />}
      {...props}
      onWriteBack={onWriteBack}
    />
  );
  return { ...render(element), onWriteBack };
}

beforeEach(() => {
  harness.doc = null;
  harness.mounts = 0;
  harness.props = null;
});

// ── Lifecycle ─────────────────────────────────────────────────────────

describe('ImageFileEditor', () => {
  it('saves in the file’s own format and names exports after it', async () => {
    renderEditor({ container: sidecar(), fileName: 'shots/Photo.JPG' });
    await screen.findByTestId('image-editor-stub');
    expect(harness.props).toMatchObject({
      saveBehavior: 'export',
      saveFormat: 'jpeg',
      exportBasename: 'Photo',
    });
  });

  it('writes edits back when the editor goes away', async () => {
    const container = sidecar();
    const { unmount, onWriteBack } = renderEditor({ container });
    await screen.findByTestId('image-editor-stub');
    harness.doc = withText();

    unmount();

    await waitFor(() => expect(onWriteBack).toHaveBeenCalledTimes(1));
    expect(onWriteBack).toHaveBeenCalledWith(expect.any(Blob), 'png', { reason: 'leave' });
    await waitFor(async () =>
      expect(await readWriteBackState(container)).toEqual({
        signature: imageEditSignature(withText()),
        pictureDigest: digestBytes(new TextEncoder().encode('flattened')),
      }),
    );
  });

  it('leaves an untouched picture alone', async () => {
    const { unmount, onWriteBack } = renderEditor({ container: sidecar() });
    await screen.findByTestId('image-editor-stub');
    harness.doc = seeded();

    unmount();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onWriteBack).not.toHaveBeenCalled();
  });

  it('does not write the picture again on leave after Save wrote it', async () => {
    const container = sidecar();
    const { unmount, onWriteBack } = renderEditor({ container });
    harness.doc = withText();
    fireEvent.click(await screen.findByTestId('image-editor-stub'));
    await waitFor(() => expect(onWriteBack).toHaveBeenCalledTimes(1));
    expect(onWriteBack).toHaveBeenCalledWith(expect.any(Blob), 'png', { reason: 'save' });

    unmount();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onWriteBack).toHaveBeenCalledTimes(1);
    expect((await readWriteBackState(container))?.pictureDigest).toBe(
      digestBytes(new TextEncoder().encode('saved')),
    );
  });

  it('keeps its session when the host hands it a fresh URL for the same file', async () => {
    const container = sidecar();
    const onWriteBack = vi.fn(async () => {});
    const first = dataUrl(PICTURE);
    const { rerender } = renderEditor({ container, onWriteBack, src: first });
    await screen.findByTestId('image-editor-stub');

    rerender(
      <ImageFileEditor
        container={container}
        src={dataUrl(REPLACED)}
        fileName="shots/photo.png"
        onWriteBack={onWriteBack}
        fallback={null}
      />,
    );

    expect(harness.mounts).toBe(1);
    expect(harness.props?.initialSrc).toBe(first);
  });

  it('starts a new session for another file, writing the old one back through its own callback', async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    const { rerender } = renderEditor({ container: sidecar(), onWriteBack: first });
    await screen.findByTestId('image-editor-stub');
    harness.doc = withText();

    const next = scopeContainer(new MemoryContentContainer(), 'other.png_files');
    rerender(
      <ImageFileEditor
        container={next}
        src={dataUrl(REPLACED)}
        fileName="other.png"
        onWriteBack={second}
        fallback={null}
      />,
    );

    await waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(harness.mounts).toBe(2));
    expect(second).not.toHaveBeenCalled();
  });

  it('opens formats it cannot save back in the fallback', async () => {
    renderEditor({ container: sidecar(), fileName: 'loop.gif' });
    expect(screen.getByTestId('viewer-fallback')).toBeTruthy();
    expect(screen.queryByTestId('image-editor-stub')).toBeNull();
  });

  it('opens an animated PNG in the fallback instead of flattening it', async () => {
    renderEditor({ container: sidecar(), src: dataUrl(animatedPng()) });
    await screen.findByTestId('viewer-fallback');
    expect(screen.queryByTestId('image-editor-stub')).toBeNull();
  });

  it('opens in the fallback when the picture cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderEditor({ container: sidecar(), src: 'javascript:alert(1)' });
    await screen.findByTestId('viewer-fallback');
    warn.mockRestore();
  });

  it('drops stale layers before the editor loads when the picture was replaced outside', async () => {
    const container = sidecar();
    await writeImageEditDoc(container, withText());
    await writeWriteBackSignature(container, imageEditSignature(withText()), digestBytes(PICTURE));

    renderEditor({ container, src: dataUrl(REPLACED) });
    await screen.findByTestId('image-editor-stub');

    expect(await container.readFile('state.json')).toBeNull();
    expect(await container.readFile(IMAGE_EDIT_WRITE_BACK_FILENAME)).toBeNull();
  });
});

// ── Sidecar preparation ───────────────────────────────────────────────

describe('prepareImageFileSidecar', () => {
  it('has nothing to check for a new sidecar', async () => {
    expect(await prepareImageFileSidecar(sidecar(), PICTURE)).toEqual({
      kind: 'ready',
      written: null,
      reseeded: false,
    });
  });

  it('keeps layers while the picture is the one their write-back produced', async () => {
    const container = sidecar();
    await writeImageEditDoc(container, withText());
    await writeWriteBackSignature(container, 'sig', digestBytes(PICTURE));

    expect(await prepareImageFileSidecar(container, PICTURE)).toEqual({
      kind: 'ready',
      written: 'sig',
      reseeded: false,
    });
    expect(await container.readFile('state.json')).not.toBeNull();
  });

  it('drops layers once the picture differs from what their write-back produced', async () => {
    const container = sidecar();
    await writeImageEditDoc(container, withText());
    await writeWriteBackSignature(container, 'sig', digestBytes(PICTURE));

    expect(await prepareImageFileSidecar(container, REPLACED)).toEqual({
      kind: 'ready',
      written: null,
      reseeded: true,
    });
    expect(await container.readFile('state.json')).toBeNull();
  });

  it('re-seeds untouched layers whose source is no longer the picture, and keeps them otherwise', async () => {
    const container = sidecar();
    await writeImageEditDoc(container, seeded());
    await container.writeFile('assets/source.png', PICTURE, 'image/png');

    expect((await prepareImageFileSidecar(container, PICTURE)).kind).toBe('ready');
    expect(await container.readFile('state.json')).not.toBeNull();

    expect(await prepareImageFileSidecar(container, REPLACED)).toMatchObject({ reseeded: true });
    expect(await container.readFile('state.json')).toBeNull();
  });

  it('keeps edited layers no write-back recorded while the picture is still their original', async () => {
    const container = sidecar();
    await writeImageEditDoc(container, withText());
    await container.writeFile('assets/source.png', PICTURE, 'image/png');

    // A session that never wrote back: the next save or leave writes these.
    expect(await prepareImageFileSidecar(container, PICTURE)).toEqual({
      kind: 'ready',
      written: null,
      reseeded: false,
    });
    // A picture that is neither their original nor anything they wrote is
    // not theirs; flattening them over it would lose it.
    expect(await prepareImageFileSidecar(container, REPLACED)).toMatchObject({ reseeded: true });
    expect(await container.readFile('state.json')).toBeNull();
  });

  it('removes nothing once the session that asked has gone', async () => {
    const container = sidecar();
    await writeImageEditDoc(container, withText());
    await writeWriteBackSignature(container, 'sig', digestBytes(PICTURE));

    expect(await prepareImageFileSidecar(container, REPLACED, () => true)).toEqual({
      kind: 'cancelled',
    });
    expect(await container.readFile('state.json')).not.toBeNull();
  });

  it('refuses animated pictures', async () => {
    expect(await prepareImageFileSidecar(sidecar(), animatedPng())).toEqual({ kind: 'animated' });
  });
});
