import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioTrack } from '@bendyline/squisq/schemas';
import { useAudioSync } from '../hooks/useAudioSync';
import { findSegmentAtTime } from '../hooks/AudioController';

const track: AudioTrack = {
  segments: [{ src: 'https://cdn.example.test/a.mp3', name: 'a', duration: 2, startTime: 0 }],
};

/** What `markdownToDoc` emits for a document with no narration. */
const emptyTrack: AudioTrack = { segments: [] };

afterEach(() => vi.restoreAllMocks());

/**
 * jsdom leaves `currentTime` unimplemented, but it is precisely the value these
 * seek regressions are about — so back it with a real field. Everything else
 * (events, src, readyState, paused) is the genuine element, and `readyState`
 * stays at HAVE_NOTHING so every load waits for an explicit `canplay`.
 */
function createAudioElement(): HTMLAudioElement {
  const audio = document.createElement('audio');
  let time = 0;
  Object.defineProperty(audio, 'currentTime', {
    configurable: true,
    get: () => time,
    set: (next: number) => {
      time = next;
    },
  });
  return audio;
}

/** Serves every segment as a distinct, name-derived blob URL. */
function mockSegmentFetches(): void {
  let lastName = '';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    lastName = String(input).split('/').pop() ?? '';
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'audio/mpeg' },
    });
  });
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${lastName}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
}

const threeSegments: AudioTrack = {
  segments: [
    { src: 'a.mp3', name: 'a', duration: 2, startTime: 0 },
    { src: 'b.mp3', name: 'b', duration: 3, startTime: 2 },
    { src: 'c.mp3', name: 'c', duration: 2, startTime: 5 },
  ],
};

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
    // The media itself must load fine: this test is about the play() rejection
    // being benign, not about a failed fetch (which IS a real unavailability).
    mockSegmentFetches();
    const { result } = renderHook(() => useAudioSync({ current: audio }, track));
    await waitFor(() => expect(audio.src).toBe('blob:a.mp3'));

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

  // The whole point of synthetic mode is a document with no audio asset, and
  // `markdownToDoc` emits exactly that: `audio: { segments: [] }`. Taking the
  // clock length from the segments alone left it at 0, and the fallback timer
  // refuses to arm without one — `play()` set isPlaying on a timeline frozen
  // at 0:00 / 0:00, so the player looked like it was playing the first block
  // forever.
  it('takes the synthetic clock length from the caller when the track has no segments', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useAudioSync({ current: null }, emptyTrack, '', true, 'synthetic', 75),
    );

    expect(result.current.totalDuration).toBe(75);
    expect(result.current.isReady).toBe(true);

    await act(() => result.current.play());
    expect(frames).not.toHaveLength(0);
    act(() => frames[frames.length - 1](performance.now() + 1000));

    expect(result.current.currentTime).toBeGreaterThan(0.5);
    expect(result.current.isEnded).toBe(false);
  });

  it('seeks and ends on a synthetic clock with no segments', async () => {
    const { result } = renderHook(() =>
      useAudioSync({ current: null }, undefined, '', true, 'synthetic', 75),
    );

    await act(() => result.current.seekTo(40));
    expect(result.current.currentTime).toBe(40);

    // Past the end clamps rather than running on into empty timeline.
    await act(() => result.current.seekTo(900));
    expect(result.current.currentTime).toBe(75);
  });

  it('leaves the clock at zero in media mode even when a synthetic length is passed', async () => {
    const { result } = renderHook(() =>
      useAudioSync({ current: null }, emptyTrack, '', true, 'media', 75),
    );

    expect(result.current.totalDuration).toBe(0);
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

describe('findSegmentAtTime boundaries', () => {
  // Starts [0, 2, 5], total 7. `segmentStart` must always be the segment's OWN
  // start — the drifted copy in useAudioSync used to leave it past the end.
  const { segments } = threeSegments;
  const starts = [0, 2, 5];

  it.each([
    [0, 0, 0],
    [1.9, 0, 0],
    [2, 1, 2],
    [4.9, 1, 2],
    [5, 2, 5],
    [6.9, 2, 5],
    [7, 2, 5],
  ])('time %s resolves to segment %s starting at %s', (time, index, start) => {
    expect(findSegmentAtTime(time, segments, starts)).toEqual({
      segmentIndex: index,
      segmentStart: start,
    });
  });
});

describe('useAudioSync seeking', () => {
  /** Drives a seek and pumps the `canplay` a cross-segment load waits on. */
  async function seek(
    result: { current: ReturnType<typeof useAudioSync> },
    audio: HTMLAudioElement,
    time: number,
    expectedSrc: string,
  ): Promise<void> {
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.seekTo(time);
    });
    // The canplay listener is attached immediately before src is assigned, so
    // observing the new src means the listener is live. A same-segment seek has
    // already resolved and simply ignores the event.
    await waitFor(() => expect(audio.src).toBe(expectedSrc));
    await act(async () => {
      audio.dispatchEvent(new Event('canplay'));
      await pending;
    });
  }

  it('seeks to the end of the last segment when seeking to exactly totalDuration', async () => {
    const audio = createAudioElement();
    mockSegmentFetches();
    const { result } = renderHook(() => useAudioSync({ current: audio }, threeSegments));
    await waitFor(() => expect(audio.src).toBe('blob:a.mp3'));

    // Land on the last segment first, so the seek to the end takes the
    // same-segment branch — where the off-by-one lived.
    await seek(result, audio, 5.5, 'blob:c.mp3');
    await seek(result, audio, 7, 'blob:c.mp3');

    expect(result.current.currentSegment).toBe(2);
    // 7 - segmentStart(5) = 2, i.e. the END of the last segment — not 0.
    expect(audio.currentTime).toBe(2);
    expect(result.current.currentTime).toBe(7);
  });

  it('lands on the correct segment and offset at every segment boundary', async () => {
    const audio = createAudioElement();
    mockSegmentFetches();
    const { result } = renderHook(() => useAudioSync({ current: audio }, threeSegments));
    await waitFor(() => expect(audio.src).toBe('blob:a.mp3'));

    await seek(result, audio, 2, 'blob:b.mp3');
    expect(result.current.currentSegment).toBe(1);
    expect(audio.currentTime).toBe(0);

    await seek(result, audio, 5, 'blob:c.mp3');
    expect(result.current.currentSegment).toBe(2);
    expect(audio.currentTime).toBe(0);

    // Back into the middle segment: offset must be measured from ITS start.
    await seek(result, audio, 4.9, 'blob:b.mp3');
    expect(result.current.currentSegment).toBe(1);
    expect(audio.currentTime).toBeCloseTo(2.9, 5);

    // Same-segment seek to that segment's own boundary-adjacent start.
    await seek(result, audio, 2.5, 'blob:b.mp3');
    expect(result.current.currentSegment).toBe(1);
    expect(audio.currentTime).toBeCloseTo(0.5, 5);
  });

  it('clamps an overshooting seek to the end of the last segment', async () => {
    const audio = createAudioElement();
    mockSegmentFetches();
    const { result } = renderHook(() => useAudioSync({ current: audio }, threeSegments));
    await waitFor(() => expect(audio.src).toBe('blob:a.mp3'));

    await seek(result, audio, 99, 'blob:c.mp3');

    expect(result.current.currentSegment).toBe(2);
    expect(result.current.currentTime).toBe(7);
    expect(audio.currentTime).toBe(2);
  });
});

describe('useAudioSync source binding', () => {
  // `11.mp3` resolves to a URL ENDING IN `1.mp3`. Matching the loaded source by
  // suffix therefore reports segment `1.mp3` as already loaded, skips its load,
  // and applies the seek inside the wrong file.
  const suffixColliding: AudioTrack = {
    segments: [
      { src: '11.mp3', name: 'eleven', duration: 2, startTime: 0 },
      { src: '1.mp3', name: 'one', duration: 2, startTime: 2 },
    ],
  };

  it('binds a segment whose src is a suffix of the loaded segment src', async () => {
    const audio = createAudioElement();
    mockSegmentFetches();
    const { result } = renderHook(() => useAudioSync({ current: audio }, suffixColliding));
    await waitFor(() => expect(audio.src).toBe('blob:11.mp3'));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.seekTo(2.5);
    });
    // The element must actually swap to `1.mp3` rather than keep playing
    // `11.mp3` and seek 0.5s into it.
    await waitFor(() => expect(audio.src).toBe('blob:1.mp3'));
    await act(async () => {
      audio.dispatchEvent(new Event('canplay'));
      await pending;
    });

    expect(result.current.currentSegment).toBe(1);
    expect(audio.currentTime).toBeCloseTo(0.5, 5);
  });

  it('still skips a redundant reload when the segment has not changed', async () => {
    const audio = createAudioElement();
    mockSegmentFetches();
    const load = vi.spyOn(audio, 'load');
    const { result } = renderHook(() => useAudioSync({ current: audio }, threeSegments));
    await waitFor(() => expect(audio.src).toBe('blob:a.mp3'));
    load.mockClear();

    // A same-segment seek must go straight to applyPendingSeek: exact binding
    // must not turn every in-segment scrub into a reload.
    await act(async () => {
      await result.current.seekTo(1);
    });

    expect(load).not.toHaveBeenCalled();
    expect(audio.currentTime).toBeCloseTo(1, 5);
  });
});

describe('useAudioSync play after ended', () => {
  it('restarts from the first segment and actually plays', async () => {
    const audio = createAudioElement();
    mockSegmentFetches();
    const play = vi.spyOn(audio, 'play').mockResolvedValue(undefined);
    const twoSegments: AudioTrack = {
      segments: [
        { src: 'a.mp3', name: 'a', duration: 2, startTime: 0 },
        { src: 'b.mp3', name: 'b', duration: 2, startTime: 2 },
      ],
    };
    const { result } = renderHook(() => useAudioSync({ current: audio }, twoSegments));
    await waitFor(() => expect(audio.src).toBe('blob:a.mp3'));

    // Advance to the final segment, then let it run out.
    let seekPromise!: Promise<void>;
    act(() => {
      seekPromise = result.current.seekTo(2.5);
    });
    await waitFor(() => expect(audio.src).toBe('blob:b.mp3'));
    await act(async () => {
      audio.dispatchEvent(new Event('canplay'));
      await seekPromise;
    });
    act(() => {
      audio.dispatchEvent(new Event('ended'));
    });
    await waitFor(() => expect(result.current.isEnded).toBe(true));
    play.mockClear();

    let playPromise!: Promise<void>;
    act(() => {
      playPromise = result.current.play();
    });
    // The element must be swapped back to segment 0 BEFORE anything plays,
    // otherwise the last segment blips and playback then stalls.
    await waitFor(() => expect(audio.src).toBe('blob:a.mp3'));
    expect(play).not.toHaveBeenCalled();

    await act(async () => {
      audio.dispatchEvent(new Event('canplay'));
      await playPromise;
    });

    expect(play).toHaveBeenCalledTimes(1);
    expect(result.current.currentSegment).toBe(0);
    expect(result.current.isEnded).toBe(false);
    expect(audio.currentTime).toBe(0);
  });
});

describe('useAudioSync unloadable segments', () => {
  it('settles a cross-segment seek and still completes restart when loading fails', async () => {
    const audio = createAudioElement();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const play = vi.spyOn(audio, 'play').mockResolvedValue(undefined);
    const twoSegments: AudioTrack = {
      segments: [
        { src: 'a.mp3', name: 'a', duration: 2, startTime: 0 },
        { src: 'b.mp3', name: 'b', duration: 2, startTime: 2 },
      ],
    };
    const { result } = renderHook(() => useAudioSync({ current: audio }, twoSegments));
    await waitFor(() => expect(result.current.isAvailable).toBe(false));

    // A failed fetch yields no source, so `canplay` never fires. The seek must
    // still settle rather than hang the caller forever. Kick the call off in a
    // sync act() so the segment effect flushes, then await it separately —
    // awaiting inside an async act() would block the very flush that settles it.
    let seekPromise!: Promise<void>;
    act(() => {
      seekPromise = result.current.seekTo(2.5);
    });
    await act(async () => {
      await seekPromise;
    });
    expect(result.current.currentSegment).toBe(1);
    // No stale source may be left attached to stand in for the missing segment.
    expect(audio.src).toBe('');

    // Restart awaits seekTo and then plays; a stranded seek would strand this.
    let restartPromise!: Promise<void>;
    act(() => {
      restartPromise = result.current.restart();
    });
    await act(async () => {
      await restartPromise;
    });
    expect(play).toHaveBeenCalled();
    expect(result.current.currentSegment).toBe(0);
  });

  it('settles a pending seek when the media element reports an error', async () => {
    const audio = createAudioElement();
    mockSegmentFetches();
    const twoSegments: AudioTrack = {
      segments: [
        { src: 'a.mp3', name: 'a', duration: 2, startTime: 0 },
        { src: 'b.mp3', name: 'b', duration: 2, startTime: 2 },
      ],
    };
    const { result } = renderHook(() => useAudioSync({ current: audio }, twoSegments));
    await waitFor(() => expect(audio.src).toBe('blob:a.mp3'));

    let seekPromise!: Promise<void>;
    act(() => {
      seekPromise = result.current.seekTo(2.5);
    });
    await waitFor(() => expect(audio.src).toBe('blob:b.mp3'));

    // The blob loaded but the element cannot decode it: error, never canplay.
    await act(async () => {
      audio.dispatchEvent(new Event('error'));
      await seekPromise;
    });

    expect(result.current.isAvailable).toBe(false);
    expect(result.current.isPlaying).toBe(false);
  });
});
