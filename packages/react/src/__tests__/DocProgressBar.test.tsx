import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DocProgressBar } from '../DocProgressBar';
import type { PlaybackState, PlaybackActions } from '../types';

function makeState(overrides: Partial<PlaybackState> = {}): PlaybackState {
  return {
    isPlaying: true,
    currentTime: 0,
    totalDuration: 60,
    currentBlockIndex: 0,
    totalBlocks: 3,
    docProgress: 0,
    hasCaptions: false,
    captionsEnabled: false,
    captionMode: 'off',
    currentSegmentIndex: 0,
    currentSegmentName: null,
    currentBlock: null,
    ...overrides,
  };
}

const actions: PlaybackActions = {
  toggle: () => {},
  restart: () => {},
  seekTo: () => {},
  setCaptionsEnabled: () => {},
  cycleCaptionMode: () => {},
};

/** The progress fill is the div tagged `doc-progress-fill`. */
function fillWidth(container: HTMLElement): string {
  const fill = container.querySelector<HTMLElement>('[data-testid="doc-progress-fill"]');
  if (!fill) throw new Error('progress fill not found');
  return fill.style.width;
}

describe('DocProgressBar fill', () => {
  it('tracks elapsed time over totalDuration (the clock/marker timeline)', () => {
    const { container } = render(
      <DocProgressBar
        state={makeState({ currentTime: 12, totalDuration: 23, docProgress: 0.99 })}
        actions={actions}
        blockMarkers={[]}
        expandedBlocks={[]}
      />,
    );
    // Must reflect 12/23 ≈ 52%, NOT the divergent docProgress (0.99).
    expect(fillWidth(container)).toBe(`${(12 / 23) * 100}%`);
  });

  it('is 0% when totalDuration is 0 (no divide-by-zero)', () => {
    const { container } = render(
      <DocProgressBar
        state={makeState({ currentTime: 5, totalDuration: 0, docProgress: 0.5 })}
        actions={actions}
        blockMarkers={[]}
        expandedBlocks={[]}
      />,
    );
    expect(fillWidth(container)).toBe('0%');
  });

  it('clamps to 100% when currentTime exceeds totalDuration', () => {
    const { container } = render(
      <DocProgressBar
        state={makeState({ currentTime: 30, totalDuration: 23 })}
        actions={actions}
        blockMarkers={[]}
        expandedBlocks={[]}
      />,
    );
    expect(fillWidth(container)).toBe('100%');
  });

  it('exposes keyboard seeking and accessible marker buttons', () => {
    const seekTo = vi.fn();
    render(
      <DocProgressBar
        state={makeState({ currentTime: 12, totalDuration: 23 })}
        actions={{ ...actions, seekTo }}
        blockMarkers={[
          {
            block: { id: 'b', startTime: 8, duration: 5, audioSegment: 0, layers: [] },
            index: 0,
            position: 35,
            title: 'Chapter two',
            isSectionStart: false,
          },
        ]}
        expandedBlocks={[]}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Playback position' });
    expect(slider.getAttribute('aria-valuenow')).toBe('12');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(seekTo).toHaveBeenCalledWith(17);
    fireEvent.click(screen.getByRole('button', { name: 'Seek to Chapter two' }));
    expect(seekTo).toHaveBeenLastCalledWith(8);
  });

  it('draws chapter starts larger than slide transitions and keeps only chapters in the tab order', () => {
    const block = (id: string, startTime: number, audioSegment: number) => ({
      id,
      startTime,
      duration: 5,
      audioSegment,
      layers: [],
    });
    const { container } = render(
      <DocProgressBar
        state={makeState({ currentTime: 12, totalDuration: 30, currentBlockIndex: 2 })}
        actions={actions}
        blockMarkers={[
          { block: block('a', 0, 0), index: 0, position: 0, title: 'One', isSectionStart: true },
          { block: block('b', 5, 0), index: 1, position: 16, title: 'One b', isSectionStart: false },
          { block: block('c', 10, 1), index: 2, position: 33, title: 'Two', isSectionStart: true },
          { block: block('d', 15, 1), index: 3, position: 50, title: 'Two b', isSectionStart: false },
        ]}
        expandedBlocks={[]}
      />,
    );
    const chapters = container.querySelectorAll<HTMLElement>('[data-marker="chapter"]');
    const slides = container.querySelectorAll<HTMLElement>('[data-marker="slide"]');
    expect(chapters).toHaveLength(2);
    expect(slides).toHaveLength(2);

    // Chapter dots: 14px with a ring. Slide beads: a 6px dot inside a 12px hit area.
    expect(chapters[0].style.width).toBe('14px');
    expect(chapters[0].style.border).toContain('2px');
    expect(slides[0].style.width).toBe('12px');
    expect(slides[0].style.padding).toBe('3px');
    expect(slides[0].style.backgroundClip).toBe('content-box');

    expect(chapters[0].tabIndex).toBe(0);
    expect(slides[0].tabIndex).toBe(-1);

    // The playhead (12s) is in chapter "Two", so that chapter dot is lit.
    expect(chapters[1].style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(chapters[0].style.backgroundColor).not.toBe('rgb(255, 255, 255)');
  });
});
