/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ScheduledClip } from '@bendyline/squisq/schemas';
import { MediaClipLayer } from '../MediaClipLayer';
import { clipLevelAt, mountedClips } from '../mediaClipPlayback';

const base: ScheduledClip = {
  id: 'c',
  src: 'a.webm',
  kind: 'audio',
  absoluteStart: 10,
  absoluteEnd: 20,
  sourceIn: 0,
  anchor: 'document',
};

function segments(count: number): ScheduledClip[] {
  return Array.from({ length: count }, (_, index) => ({
    ...base,
    id: `take#${index}`,
    absoluteStart: index * 5,
    absoluteEnd: index * 5 + 5,
    sourceIn: index * 6,
    segment: { groupId: 'take', index, count },
  }));
}

describe('clipLevelAt', () => {
  it('is unity for an unedited clip', () => {
    expect(clipLevelAt(base, 15)).toBe(1);
  });

  it('applies gain and ramps fades at the clip edges', () => {
    const clip = { ...base, gain: -6, fadeIn: 2, fadeOut: 4 };
    const g = Math.pow(10, -6 / 20);
    expect(clipLevelAt(clip, 10)).toBe(0);
    expect(clipLevelAt(clip, 11)).toBeCloseTo(g / 2, 6);
    expect(clipLevelAt(clip, 14)).toBeCloseTo(g, 6);
    expect(clipLevelAt(clip, 18)).toBeCloseTo(g / 2, 6);
  });

  it('allows boosts above unity', () => {
    expect(clipLevelAt({ ...base, gain: 6 }, 15)).toBeCloseTo(Math.pow(10, 6 / 20), 6);
  });
});

describe('mountedClips', () => {
  it('keeps ordinary clips as they are', () => {
    expect(mountedClips([base], 0)).toEqual([{ key: 'c', clip: base }]);
  });

  it('mounts only the current and next segment, on alternating slots', () => {
    const clips = segments(5);
    expect(mountedClips(clips, 7).map((m) => [m.key, m.clip.id])).toEqual([
      ['take#slot1', 'take#1'],
      ['take#slot0', 'take#2'],
    ]);
    expect(mountedClips(clips, 11).map((m) => [m.key, m.clip.id])).toEqual([
      ['take#slot0', 'take#2'],
      ['take#slot1', 'take#3'],
    ]);
    // Past the end: the last segment stays mounted.
    expect(mountedClips(clips, 99).map((m) => m.clip.id)).toEqual(['take#4']);
  });
});

describe('MediaClipLayer with cut segments', () => {
  const setTimes: number[] = [];
  beforeEach(() => {
    setTimes.length = 0;
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get() {
        return (this as { _t?: number })._t ?? 0;
      },
      set(value: number) {
        (this as { _t?: number })._t = value;
        setTimes.push(value);
      },
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders two elements and parks the upcoming segment on its in-point', () => {
    const { container } = render(
      <MediaClipLayer schedule={segments(4)} currentTime={4.5} isPlaying basePath="" />,
    );
    const audios = container.querySelectorAll('audio');
    expect(audios).toHaveLength(2);
    const upcoming = [...audios].find((a) => a.getAttribute('data-clip-id') === 'take#1')!;
    expect(upcoming.currentTime).toBe(6);
  });

  it('sets element volume from the recipe gain', () => {
    const { container } = render(
      <MediaClipLayer schedule={[{ ...base, gain: -6 }]} currentTime={15} isPlaying basePath="" />,
    );
    expect(container.querySelector('audio')!.volume).toBeCloseTo(Math.pow(10, -6 / 20), 6);
  });

  it('tags a cropped video for export', () => {
    const { container } = render(
      <MediaClipLayer
        schedule={[{ ...base, kind: 'video', crop: { x: 0.1, y: 0, w: 0.8, h: 1 } }]}
        currentTime={15}
        isPlaying={false}
        basePath=""
      />,
    );
    expect(container.querySelector('video')!.getAttribute('data-crop')).toBe('0.1 0 0.8 1');
  });
});
