import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Doc } from '@bendyline/squisq/schemas';
import { DocControlsCompact } from '../DocControlsCompact';
import { DocPlayer } from '../DocPlayer';
import type { PlaybackControlsProps } from '../DocControlsOverlay';
import type { PlaybackActions, PlaybackState } from '../types';

const state: PlaybackState = {
  isPlaying: false,
  currentTime: 42,
  totalDuration: 193,
  currentBlockIndex: 2,
  totalBlocks: 23,
  docProgress: 0,
  hasCaptions: true,
  captionsEnabled: false,
  captionMode: 'off',
  currentSegmentIndex: 0,
  currentSegmentName: null,
  currentBlock: null,
};

function actions(overrides: Partial<PlaybackActions> = {}): PlaybackActions {
  return {
    toggle: vi.fn(),
    restart: vi.fn(),
    seekTo: vi.fn(),
    setCaptionsEnabled: vi.fn(),
    cycleCaptionMode: vi.fn(),
    ...overrides,
  };
}

function controls(overrides: Partial<PlaybackControlsProps> = {}): PlaybackControlsProps {
  return { state, actions: actions(), blockMarkers: [], expandedBlocks: [], ...overrides };
}

describe('DocControlsCompact', () => {
  it('lays the playback controls out in one row around an inline timeline', () => {
    const props = controls();
    const { container } = render(<DocControlsCompact {...props} />);

    expect(screen.getByRole('group', { name: 'Playback controls' })).toBeTruthy();
    expect(screen.getByText('0:42 / 3:13')).toBeTruthy();
    expect(screen.getByText('3/23')).toBeTruthy();
    expect(container.querySelector('[data-variant="inline"]')).toBeTruthy();
    expect(
      screen.getByRole('slider', { name: 'Playback position' }).getAttribute('aria-valuenow'),
    ).toBe('42');

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart from beginning' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cycle caption style' }));
    expect(props.actions.toggle).toHaveBeenCalled();
    expect(props.actions.restart).toHaveBeenCalled();
    expect(props.actions.cycleCaptionMode).toHaveBeenCalled();
  });

  it('sizes the readouts to their longest values, so the timeline holds still', () => {
    const { container } = render(<DocControlsCompact {...controls()} />);
    const widest = Array.from(container.querySelectorAll('[aria-hidden="true"]')).map(
      (sizer) => sizer.textContent,
    );
    expect(widest).toContain('3:13 / 3:13');
    expect(widest).toContain('23/23');
  });

  it('offers captions only when the document has them, and fullscreen only when wired', () => {
    const toggleFullscreen = vi.fn();
    const { rerender } = render(
      <DocControlsCompact {...controls({ state: { ...state, hasCaptions: false } })} />,
    );
    expect(screen.queryByRole('button', { name: 'Cycle caption style' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enter fullscreen' })).toBeNull();

    rerender(<DocControlsCompact {...controls({ actions: actions({ toggleFullscreen }) })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
    expect(toggleFullscreen).toHaveBeenCalled();
  });

  it('names Pause, and says when it is still loading, while playing', () => {
    render(
      <DocControlsCompact
        {...controls({ state: { ...state, isPlaying: true, isBuffering: true } })}
      />,
    );
    const pause = screen.getByRole('button', { name: 'Pause' });
    expect(pause.getAttribute('aria-busy')).toBe('true');
    expect(pause.getAttribute('title')).toBe('Loading audio…');
  });
});

describe('DocPlayer renderPlaybackControls', () => {
  const doc: Doc = {
    articleId: 'host-playback',
    duration: 10,
    blocks: [
      { id: 'first', startTime: 0, duration: 5, audioSegment: 0, layers: [] },
      { id: 'second', startTime: 5, duration: 5, audioSegment: 0, layers: [] },
    ],
    audio: { segments: [] },
  };

  it('draws the overlay over the video when the host supplies no controls', () => {
    const { container } = render(<DocPlayer doc={doc} audioMode="synthetic" />);
    expect(container.querySelector('.doc-player__controls')).toBeTruthy();
  });

  it("draws the host's controls in place of the overlay", () => {
    const { container } = render(
      <DocPlayer
        doc={doc}
        audioMode="synthetic"
        renderPlaybackControls={(props) => <DocControlsCompact {...props} />}
      />,
    );
    expect(container.querySelector('.doc-player__controls')).toBeNull();
    expect(screen.getByTestId('playback-controls-compact')).toBeTruthy();
    expect(screen.getByText('0:00 / 0:10')).toBeTruthy();
  });

  it('leaves the slideshow to its own controls', () => {
    const renderPlayback = vi.fn(() => null);
    render(
      <DocPlayer
        doc={doc}
        displayMode="slideshow"
        audioMode="synthetic"
        renderPlaybackControls={renderPlayback}
      />,
    );
    expect(renderPlayback).not.toHaveBeenCalled();
    expect(screen.getByTestId('slideshow-controls')).toBeTruthy();
  });
});
