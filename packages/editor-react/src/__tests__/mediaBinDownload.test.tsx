/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MediaEntry, MediaProvider } from '@bendyline/squisq/schemas';
import { MediaBin } from '../MediaBin.js';

function createProvider(entry: MediaEntry) {
  const resolveUrl = vi.fn(async () => `blob:${entry.name}`);
  const provider: MediaProvider = {
    resolveUrl,
    async listMedia() {
      return [entry];
    },
    async addMedia(name) {
      return name;
    },
    async removeMedia() {},
    dispose() {},
  };
  return { provider, resolveUrl };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MediaBin binary downloads', () => {
  it('downloads an entry through its MediaProvider URL by default', async () => {
    const { provider, resolveUrl } = createProvider({
      name: 'attachments/archive/data.bin',
      mimeType: 'application/octet-stream',
      size: 2048,
    });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    render(<MediaBin mediaProvider={provider} isDark={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download data.bin' }));

    await waitFor(() => expect(resolveUrl).toHaveBeenCalledWith('attachments/archive/data.bin'));
    expect(clickSpy).toHaveBeenCalledOnce();
    const clickedLink = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(clickedLink.getAttribute('href')).toBe('blob:attachments/archive/data.bin');
    expect(clickedLink.getAttribute('download')).toBe('data.bin');
    expect(document.body.contains(clickedLink)).toBe(false);
  });

  it('removes the download affordance when the host disables it', async () => {
    const { provider, resolveUrl } = createProvider({
      name: 'recordings/take.webm',
      mimeType: 'video/webm',
      size: 4096,
    });

    render(<MediaBin mediaProvider={provider} isDark allowBinaryDownloads={false} />);

    expect(await screen.findByText('take.webm')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download take.webm' })).toBeNull();
    expect(resolveUrl).not.toHaveBeenCalled();
  });
});
