/** @vitest-environment jsdom */
/**
 * Closing the image-edit modal must not strand edits in the sidecar: the
 * layers autosave to `state.json`, so a close that skipped the picture
 * showed the edits again on reopen while the document kept the old image.
 */
import { forwardRef, useImperativeHandle } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import type { ImageEditDoc, MediaProvider } from '@bendyline/squisq/schemas';

const harness = vi.hoisted(() => ({
  doc: null as ImageEditDoc | null,
  saveSucceeds: true,
  saves: 0,
}));

vi.mock('../ImageEditor', () => ({
  ImageEditor: forwardRef(function ImageEditorStub(
    props: {
      saveFormat: 'png' | 'jpeg' | 'webp';
      onExport: (blob: Blob, format: 'png' | 'jpeg' | 'webp', doc: ImageEditDoc) => Promise<void>;
    },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      getDoc: () => harness.doc,
      save: async () => {
        harness.saves += 1;
        if (!harness.saveSucceeds || !harness.doc) return false;
        await props.onExport(new Blob(['jpeg']), props.saveFormat, harness.doc);
        return true;
      },
    }));
    return <div data-testid="image-editor-stub" />;
  }),
}));

import { ImageEditModal } from '../imageEditor/ImageEditModal';
import { IMAGE_EDIT_WRITE_BACK_FILENAME, imageEditSignature } from '../imageEditor/writeBack';

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
        content: { src: 'assets/source.jpg', alt: '', fit: 'fill' },
      },
    ],
    meta: { sourcePath: 'assets/source.jpg' },
  };
}

function withText(): ImageEditDoc {
  const doc = seeded();
  doc.layers.push({
    id: 'layer-1',
    type: 'text',
    name: 'Text',
    position: { x: 10, y: 20, width: 240, height: 48 },
    content: { text: 'Yess yat', style: { fontSize: 32, color: '#111111' } },
  });
  return doc;
}

function provider(): MediaProvider & { addMedia: ReturnType<typeof vi.fn> } {
  return {
    addMedia: vi.fn(async (name: string) => name),
    resolveUrl: vi.fn(async (name: string) => `blob:${name}`),
    listMedia: vi.fn(async () => []),
    removeMedia: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
}

function renderModal(container: MemoryContentContainer, mediaProvider: MediaProvider) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const view = render(
    <ImageEditModal
      relativePath="Unicorns_files/image.jpg"
      container={container}
      mediaProvider={mediaProvider}
      onClose={onClose}
      onSaved={onSaved}
      allowVersioning={false}
    />,
  );
  return { ...view, onClose, onSaved };
}

async function recordedSignatures(container: MemoryContentContainer): Promise<string[]> {
  const entries = await container.listFiles('.imageEdits');
  const records = entries.filter((e) => e.path.endsWith(`/${IMAGE_EDIT_WRITE_BACK_FILENAME}`));
  return Promise.all(
    records.map(async (e) => {
      const data = await container.readFile(e.path);
      return (JSON.parse(new TextDecoder().decode(data!)) as { signature: string }).signature;
    }),
  );
}

beforeEach(() => {
  harness.doc = null;
  harness.saveSucceeds = true;
  harness.saves = 0;
});

describe('ImageEditModal close', () => {
  it('writes edits back to the picture when × is tapped', async () => {
    const container = new MemoryContentContainer();
    const mediaProvider = provider();
    harness.doc = withText();
    const { onClose, onSaved } = renderModal(container, mediaProvider);
    await screen.findByTestId('image-editor-stub');

    fireEvent.click(screen.getByTestId('image-edit-modal-close'));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(mediaProvider.addMedia).toHaveBeenCalledWith(
      'Unicorns_files/image.jpg',
      expect.any(Blob),
      'image/jpeg',
    );
    expect(await recordedSignatures(container)).toEqual([imageEditSignature(withText())]);
  });

  it('saves on Escape the same way', async () => {
    const mediaProvider = provider();
    harness.doc = withText();
    const { onSaved } = renderModal(new MemoryContentContainer(), mediaProvider);
    await screen.findByTestId('image-editor-stub');

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mediaProvider.addMedia).toHaveBeenCalledTimes(1);
  });

  it('just closes an untouched image', async () => {
    const mediaProvider = provider();
    harness.doc = seeded();
    const { onClose, onSaved } = renderModal(new MemoryContentContainer(), mediaProvider);
    await screen.findByTestId('image-editor-stub');

    fireEvent.click(screen.getByTestId('image-edit-modal-close'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();
    expect(harness.saves).toBe(0);
    expect(mediaProvider.addMedia).not.toHaveBeenCalled();
  });

  it('remembers across sessions that the picture already matches the layers', async () => {
    const container = new MemoryContentContainer();
    const mediaProvider = provider();
    harness.doc = withText();
    const first = renderModal(container, mediaProvider);
    await screen.findByTestId('image-editor-stub');
    fireEvent.click(screen.getByTestId('image-edit-modal-close'));
    await waitFor(() => expect(first.onSaved).toHaveBeenCalledTimes(1));
    first.unmount();

    const second = renderModal(container, mediaProvider);
    await screen.findByTestId('image-editor-stub');
    fireEvent.click(screen.getByTestId('image-edit-modal-close'));

    await waitFor(() => expect(second.onClose).toHaveBeenCalledTimes(1));
    expect(second.onSaved).not.toHaveBeenCalled();
    expect(mediaProvider.addMedia).toHaveBeenCalledTimes(1);
  });

  it('saves edits a previous session left unsaved', async () => {
    // A sidecar from before write-back records existed, holding edits the
    // picture never got: the case that hid "Yess yat" from the document.
    const mediaProvider = provider();
    harness.doc = withText();
    const { onSaved } = renderModal(new MemoryContentContainer(), mediaProvider);
    await screen.findByTestId('image-editor-stub');

    fireEvent.click(screen.getByTestId('image-edit-modal-close'));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('stays open when the save fails, and the next × closes without saving', async () => {
    const mediaProvider = provider();
    harness.doc = withText();
    harness.saveSucceeds = false;
    const { onClose, onSaved } = renderModal(new MemoryContentContainer(), mediaProvider);
    await screen.findByTestId('image-editor-stub');

    fireEvent.click(screen.getByTestId('image-edit-modal-close'));

    expect(await screen.findByText(/weren’t saved to the image/i)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('image-edit-modal-close').getAttribute('aria-label')).toBe(
      'Close without saving',
    );

    fireEvent.click(screen.getByTestId('image-edit-modal-close'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(harness.saves).toBe(1);
    expect(onSaved).not.toHaveBeenCalled();
    expect(mediaProvider.addMedia).not.toHaveBeenCalled();
  });
});
