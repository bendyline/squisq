/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MediaEntry, MediaProvider } from '@bendyline/squisq/schemas';
import { MediaBin } from '../MediaBin.js';

function createProvider(): { provider: MediaProvider; added: string[] } {
  const entries: MediaEntry[] = [];
  const added: string[] = [];
  return {
    added,
    provider: {
      async addMedia(name, data, mimeType) {
        const relativePath = `attachments/${name}`;
        added.push(relativePath);
        entries.push({
          name: relativePath,
          mimeType,
          size: data instanceof Blob ? data.size : data.byteLength,
        });
        return relativePath;
      },
      async resolveUrl(path) {
        return `blob:${path}`;
      },
      async listMedia() {
        return [...entries];
      },
      async removeMedia() {},
      dispose() {},
    },
  };
}

function dataTransfer(files: File[], itemTypes: string[]) {
  return {
    files,
    items: itemTypes.map((type) => ({ kind: 'file', type })),
    types: ['Files'],
    dropEffect: 'none',
  };
}

describe('MediaBin image drop target', () => {
  it('shows a drop affordance and uploads a dropped image through the normal callback', async () => {
    const { provider, added } = createProvider();
    const onMediaUploaded = vi.fn();
    const image = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
    Object.defineProperty(image, 'arrayBuffer', {
      configurable: true,
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });

    const { container } = render(
      <MediaBin mediaProvider={provider} isDark onMediaUploaded={onMediaUploaded} />,
    );
    const bin = container.querySelector('.squisq-media-bin') as HTMLElement;
    const transfer = dataTransfer([image], ['image/png']);
    await screen.findByText('No files yet.');

    fireEvent.dragEnter(bin, { dataTransfer: transfer });
    expect(bin.classList.contains('squisq-media-bin--drop-active')).toBe(true);
    expect(screen.getByText('Drop images here')).toBeTruthy();

    fireEvent.drop(bin, { dataTransfer: transfer });

    await waitFor(() => expect(added).toEqual(['attachments/photo.png']));
    expect(onMediaUploaded).toHaveBeenCalledWith('attachments/photo.png', 'photo.png', 'image/png');
    expect(await screen.findByText('photo.png')).toBeTruthy();
    expect(screen.queryByText('Drop images here')).toBeNull();
  });

  it('does not activate or upload for a non-image file', async () => {
    const { provider, added } = createProvider();
    const text = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    const { container } = render(<MediaBin mediaProvider={provider} isDark={false} />);
    const bin = container.querySelector('.squisq-media-bin') as HTMLElement;
    const transfer = dataTransfer([text], ['text/plain']);
    await screen.findByText('No files yet.');

    fireEvent.dragEnter(bin, { dataTransfer: transfer });
    fireEvent.drop(bin, { dataTransfer: transfer });

    expect(bin.classList.contains('squisq-media-bin--drop-active')).toBe(false);
    expect(screen.queryByText('Drop images here')).toBeNull();
    await waitFor(() => expect(added).toEqual([]));
  });
});
