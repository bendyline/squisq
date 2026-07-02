import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
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
});
