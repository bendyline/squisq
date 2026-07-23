/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { playTimelineMediaAt, useTimelineClock } from '../useTimelineClock';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function media(
  kind: 'audio' | 'video',
  start: number,
  end: number,
): HTMLAudioElement | HTMLVideoElement {
  const element = document.createElement(kind);
  element.dataset.clipId = `${kind}:${start}`;
  element.dataset.absStart = String(start);
  element.dataset.absEnd = String(end);
  return element;
}

describe('timeline media playback activation', () => {
  it('starts every overlapping media element and leaves inactive clips stopped', () => {
    const play = vi
      .spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve());
    const host = document.createElement('div');
    host.append(media('video', 0, 10), media('audio', 2, 8), media('video', 10, 20));

    playTimelineMediaAt(host, 4);

    expect(play).toHaveBeenCalledTimes(2);
  });

  it('unlocks registered media synchronously from play and toggle', () => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const play = vi
      .spyOn(window.HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve());
    const host = document.createElement('div');
    host.append(media('video', 0, 10));
    const { result } = renderHook(() => useTimelineClock(10));

    act(() => result.current.registerMediaHost?.(host));
    act(() => result.current.play());
    expect(play).toHaveBeenCalledTimes(1);
    expect(result.current.isPlaying).toBe(true);

    act(() => result.current.toggle());
    expect(result.current.isPlaying).toBe(false);
    expect(play).toHaveBeenCalledTimes(1);

    act(() => result.current.toggle());
    expect(result.current.isPlaying).toBe(true);
    expect(play).toHaveBeenCalledTimes(2);
  });
});
