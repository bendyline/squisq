import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioTrack } from '@bendyline/squisq/schemas';
import { useAudioSync } from '../hooks/useAudioSync';

const track: AudioTrack = {
  segments: [{ src: 'https://cdn.example.test/a.mp3', name: 'a', duration: 2, startTime: 0 }],
};

afterEach(() => vi.restoreAllMocks());

describe('useAudioSync resource loading', () => {
  it('does not prefix absolute URLs and revokes a blob that resolves after cleanup', async () => {
    let resolveFetch!: (value: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockReturnValue(fetchPromise as Promise<Response>);
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:late');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const audioRef = { current: null };
    const { unmount } = renderHook(() => useAudioSync(audioRef, track, '.'));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls[0][0]).toBe('https://cdn.example.test/a.mp3');
    unmount();

    await act(async () => {
      resolveFetch({ ok: true, blob: async () => new Blob(['audio']) });
      await fetchPromise;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(create).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('blob:late');
  });

  it('does not preload when an external controller disables the hook', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['audio']),
    } as Response);
    renderHook(() => useAudioSync({ current: null }, track, '.', false));
    await act(async () => Promise.resolve());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('loads only the active segment instead of downloading the full track', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['audio']),
    } as Response);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:active');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const longTrack: AudioTrack = {
      segments: [
        { src: 'a.mp3', name: 'a', duration: 2, startTime: 0 },
        { src: 'b.mp3', name: 'b', duration: 2, startTime: 2 },
        { src: 'c.mp3', name: 'c', duration: 2, startTime: 4 },
      ],
    };

    renderHook(() => useAudioSync({ current: null }, longTrack, '/audio'));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy).toHaveBeenCalledWith('/audio/a.mp3', expect.any(Object));
  });
});
