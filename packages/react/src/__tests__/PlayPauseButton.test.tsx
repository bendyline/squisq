import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { DocControlsBottom } from '../DocControlsBottom';
import { DocControlsOverlay } from '../DocControlsOverlay';
import { DocControlsSidebar } from '../DocControlsSidebar';
import type { PlaybackActions, PlaybackState } from '../types';

function makeState(overrides: Partial<PlaybackState> = {}): PlaybackState {
  return {
    isPlaying: false,
    currentTime: 0,
    totalDuration: 60,
    currentBlockIndex: 0,
    totalBlocks: 4,
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

const layouts = [
  [
    'bottom bar',
    (state: PlaybackState) => (
      <DocControlsBottom state={state} actions={actions} blockMarkers={[]} expandedBlocks={[]} />
    ),
  ],
  [
    'overlay',
    (state: PlaybackState) => (
      <DocControlsOverlay state={state} actions={actions} blockMarkers={[]} expandedBlocks={[]} />
    ),
  ],
  ['sidebar', (state: PlaybackState) => <DocControlsSidebar state={state} actions={actions} />],
] as const;

afterEach(() => vi.unstubAllGlobals());

describe.each(layouts)('%s Play/Pause button', (_name, renderControls) => {
  it('shows a loading ring while a requested start waits for audio', () => {
    const { getByRole, getByTestId } = render(
      renderControls(makeState({ isPlaying: true, isBuffering: true })),
    );
    // Still a Pause button: pressing it cancels the pending start.
    const button = getByRole('button', { name: 'Pause' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(getByTestId('play-pause-buffering').querySelector('animateTransform')).not.toBeNull();
  });

  it('shows the plain glyph once sound is playing', () => {
    const { getByRole, queryByTestId } = render(
      renderControls(makeState({ isPlaying: true, isBuffering: false })),
    );
    expect(getByRole('button', { name: 'Pause' }).hasAttribute('aria-busy')).toBe(false);
    expect(queryByTestId('play-pause-buffering')).toBeNull();
  });

  // The glyph is swapped the moment playback is requested; a click landing on
  // the swapped-out node would reach the player stage as a stage tap.
  it('leaves clicks to the button rather than the glyph', () => {
    for (const state of [
      makeState(),
      makeState({ isPlaying: true }),
      makeState({ isPlaying: true, isBuffering: true }),
    ]) {
      const { container, unmount } = render(renderControls(state));
      const button = container.querySelector(
        'button[aria-label="Play"], button[aria-label="Pause"]',
      );
      expect(button?.querySelector('svg')?.style.pointerEvents).toBe('none');
      unmount();
    }
  });

  it('never shows the ring on a paused player', () => {
    const { getByRole, queryByTestId } = render(
      renderControls(makeState({ isPlaying: false, isBuffering: true })),
    );
    expect(getByRole('button', { name: 'Play' }).hasAttribute('aria-busy')).toBe(false);
    expect(queryByTestId('play-pause-buffering')).toBeNull();
  });

  it('holds the ring still for readers who prefer reduced motion', () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) => ({ matches: query.includes('reduce'), media: query }) as MediaQueryList,
    );
    const { getByTestId } = render(
      renderControls(makeState({ isPlaying: true, isBuffering: true })),
    );
    const icon = getByTestId('play-pause-buffering');
    expect(icon.querySelector('circle')).not.toBeNull();
    expect(icon.querySelector('animateTransform')).toBeNull();
  });
});
