/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MediaEntry, MediaProvider } from '@bendyline/squisq/schemas';
import { MediaBin } from '../MediaBin.js';

const ENTRIES: MediaEntry[] = [
  { name: 'attachments/photo.png', mimeType: 'image/png', size: 2048 },
  { name: 'attachments/clip.mp4', mimeType: 'video/mp4', size: 4096 },
  { name: 'attachments/voice.webm', mimeType: 'audio/webm', size: 1024 },
  { name: 'attachments/data.csv', mimeType: 'text/csv', size: 64 },
];

function createProvider(): MediaProvider {
  return {
    resolveUrl: vi.fn(async (path: string) => `blob:${path}`),
    async listMedia() {
      return [...ENTRIES];
    },
    async addMedia(name) {
      return name;
    },
    async removeMedia() {},
    dispose() {},
  };
}

function itemFor(name: string): HTMLElement {
  return screen.getByText(name).closest('.squisq-media-bin-item') as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MediaBin preview', () => {
  it('opens a picture full size in the image viewer', async () => {
    render(<MediaBin mediaProvider={createProvider()} isDark={false} />);
    await screen.findByText('photo.png');

    fireEvent.click(itemFor('photo.png'));

    const dialog = await screen.findByRole('dialog', { name: 'photo.png' });
    const img = dialog.querySelector('.squisq-image-viewer-img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('blob:attachments/photo.png');
    expect(dialog.textContent).toContain('2.0 KB · image/png');
  });

  it('plays a video in the native player', async () => {
    render(<MediaBin mediaProvider={createProvider()} isDark />);
    await screen.findByText('clip.mp4');

    fireEvent.click(itemFor('clip.mp4'));

    const dialog = await screen.findByRole('dialog', { name: 'clip.mp4' });
    await waitFor(() =>
      expect(dialog.querySelector('video')?.getAttribute('src')).toBe('blob:attachments/clip.mp4'),
    );
    expect(dialog.querySelector('video')?.hasAttribute('controls')).toBe(true);
    expect(screen.getByTestId('media-preview-dialog').closest('[data-theme]')).toHaveProperty(
      'dataset.theme',
      'dark',
    );
  });

  it('opens audio from the keyboard and closes with Escape', async () => {
    render(<MediaBin mediaProvider={createProvider()} isDark={false} />);
    await screen.findByText('voice.webm');
    const item = itemFor('voice.webm');
    item.focus();

    fireEvent.keyDown(item, { key: 'Enter' });

    const dialog = await screen.findByRole('dialog', { name: 'voice.webm' });
    await waitFor(() =>
      expect(dialog.querySelector('audio')?.getAttribute('src')).toBe(
        'blob:attachments/voice.webm',
      ),
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes from the close button and the backdrop', async () => {
    render(<MediaBin mediaProvider={createProvider()} isDark={false} />);
    await screen.findByText('photo.png');

    fireEvent.click(itemFor('photo.png'));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(itemFor('photo.png'));
    await screen.findByRole('dialog');
    fireEvent.mouseDown(document.querySelector('.squisq-media-preview') as HTMLElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not open for files that are not media, or from the download button', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<MediaBin mediaProvider={createProvider()} isDark={false} />);
    await screen.findByText('data.csv');

    fireEvent.click(itemFor('data.csv'));
    fireEvent.keyDown(itemFor('data.csv'), { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Download photo.png' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(itemFor('data.csv').classList.contains('squisq-media-bin-item--previewable')).toBe(
      false,
    );
    expect(itemFor('photo.png').classList.contains('squisq-media-bin-item--previewable')).toBe(
      true,
    );
  });
});
