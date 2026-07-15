import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioTrack } from '@bendyline/squisq/schemas';
import { useAudioSync } from '../hooks/useAudioSync';

const track: AudioTrack = {
  segments: [{ src: 'https://cdn.example.test/a.mp3', name: 'a', duration: 2, startTime: 0 }],
};

afterEach(() => vi.restoreAllMocks());

describe('useAudioSync resource loading', () => {
  it('does not prefix absolute URLs and aborts a pending bounded fetch on cleanup', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    });
    const audioRef = { current: null };
    const { unmount } = renderHook(() => useAudioSync(audioRef, track, '.'));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls[0][0]).toBe('https://cdn.example.test/a.mp3');
    unmount();
    expect(requestSignal?.aborted).toBe(true);
  });

  it('does not preload when an external controller disables the hook', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Blob(['audio'], { type: 'audio/mpeg' })));
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

describe('useAudioSync playback modes', () => {
  it('reports a real media element error instead of silently advancing', async () => {
    const audio = document.createElement('audio');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    const { result } = renderHook(() => useAudioSync({ current: audio }, track));

    act(() => audio.dispatchEvent(new Event('error')));

    await waitFor(() => expect(result.current.isAvailable).toBe(false));
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.unavailableMessage).toContain('could not be loaded');
  });

  it('does not treat an autoplay-policy rejection as missing media or a synthetic clock', async () => {
    const audio = document.createElement('audio');
    const blocked = new Error('User gesture required');
    blocked.name = 'NotAllowedError';
    vi.spyOn(audio, 'play').mockRejectedValue(blocked);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    const { result } = renderHook(() => useAudioSync({ current: audio }, track));

    await act(() => result.current.play());

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isAvailable).toBe(true);
    expect(result.current.unavailableMessage).toBeUndefined();
  });

  it('uses a synthetic clock only when explicitly requested', async () => {
    const audio = document.createElement('audio');
    const play = vi.spyOn(audio, 'play');
    const { result } = renderHook(() =>
      useAudioSync({ current: audio }, track, '', true, 'synthetic'),
    );

    await act(() => result.current.play());

    expect(play).not.toHaveBeenCalled();
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.isAvailable).toBe(true);
  });

  it('waits for a cross-segment seek to finish before restart plays', async () => {
    const audio = document.createElement('audio');
    const twoSegments: AudioTrack = {
      segments: [
        { src: 'a.mp3', name: 'a', duration: 2, startTime: 0 },
        { src: 'b.mp3', name: 'b', duration: 2, startTime: 2 },
      ],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'audio/mpeg' },
      }),
    );
    vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:a').mockReturnValueOnce('blob:b');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const play = vi.spyOn(audio, 'play').mockResolvedValue(undefined);
    const { result } = renderHook(() => useAudioSync({ current: audio }, twoSegments));

    await waitFor(() => expect(audio.src).toBe('blob:a'));
    let seekPromise!: Promise<void>;
    act(() => {
      seekPromise = result.current.seekTo(2.5);
    });
    await waitFor(() => expect(audio.src).toBe('blob:b'));
    await act(async () => {
      audio.dispatchEvent(new Event('canplay'));
      await seekPromise;
    });

    let restartPromise!: Promise<void>;
    act(() => {
      restartPromise = result.current.restart();
    });
    await waitFor(() => expect(audio.src).toBe('blob:a'));
    expect(play).not.toHaveBeenCalled();

    await act(async () => {
      audio.dispatchEvent(new Event('canplay'));
      await restartPromise;
    });
    expect(play).toHaveBeenCalledTimes(1);
  });
});
