/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ScheduledClip } from '@bendyline/squisq/schemas';
import { TimelineVideoPanel } from '../TimelineVideoPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TimelineVideoPanel', () => {
  it('shows the active video and follows paused playhead seeks', () => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const clip: ScheduledClip = {
      id: 'recording',
      kind: 'video',
      src: 'video/recording.webm',
      absoluteStart: 2,
      absoluteEnd: 12,
      sourceIn: 1,
      anchor: 'document',
    };
    const onClose = vi.fn();
    const { container, rerender } = render(
      <TimelineVideoPanel schedule={[clip]} currentTime={4} isPlaying={false} onClose={onClose} />,
    );

    expect(screen.getByText('recording.webm')).toBeTruthy();
    expect(container.querySelector('video')?.currentTime).toBe(3);

    rerender(
      <TimelineVideoPanel
        schedule={[clip]}
        currentTime={4.1}
        isPlaying={false}
        onClose={onClose}
      />,
    );
    expect(container.querySelector('video')?.currentTime).toBeCloseTo(3.1);

    fireEvent.click(screen.getByRole('button', { name: 'Hide video preview' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps the panel mounted between clips and explains the empty frame', () => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const clip: ScheduledClip = {
      id: 'later',
      kind: 'video',
      src: 'later.mp4',
      absoluteStart: 5,
      absoluteEnd: 10,
      sourceIn: 0,
      anchor: 'document',
    };
    render(<TimelineVideoPanel schedule={[clip]} currentTime={1} isPlaying={false} />);

    expect(screen.getByText('No video at this time')).toBeTruthy();
    expect(screen.getByText('Move the playhead onto a video clip')).toBeTruthy();
  });
});
