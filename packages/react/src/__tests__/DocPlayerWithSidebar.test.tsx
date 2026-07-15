import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import type { Doc } from '@bendyline/squisq/schemas';
import type { AudioController } from '../hooks/AudioController';
import type { PlaybackState } from '../types';

// Stand in for the real sidebar so every render it performs is countable.
const { sidebarRender } = vi.hoisted(() => ({ sidebarRender: vi.fn() }));
vi.mock('../DocControlsSidebar', () => ({
  DocControlsSidebar: ({ state }: { state: PlaybackState }) => {
    sidebarRender(state.currentTime);
    return <span data-testid="sidebar">{state.currentTime}</span>;
  },
}));

import { DocPlayerWithSidebar } from '../DocPlayerWithSidebar';

function minimalDoc(): Doc {
  return {
    articleId: 'sidebar',
    duration: 10,
    blocks: [
      { id: 'b1', startTime: 0, duration: 5, audioSegment: 0, layers: [] },
      { id: 'b2', startTime: 5, duration: 5, audioSegment: 0, layers: [] },
    ],
    audio: { segments: [] },
  };
}

function controller(overrides: Partial<AudioController> = {}): AudioController {
  return {
    currentTime: 0,
    isPlaying: false,
    currentSegment: 0,
    totalDuration: 10,
    isEnded: false,
    isReady: true,
    isAvailable: true,
    play: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    toggle: vi.fn(async () => {}),
    seekTo: vi.fn(async () => {}),
    skipToSegment: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    ...overrides,
  };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('DocPlayerWithSidebar tick interval', () => {
  beforeEach(() => {
    sidebarRender.mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  // The 250ms interval used to run unconditionally, forcing 4 re-renders/sec of
  // the sidebar forever — on an idle, paused, backgrounded tab — for output
  // that cannot have changed.
  it('does not re-render while paused and idle', async () => {
    render(<DocPlayerWithSidebar doc={minimalDoc()} audioController={controller()} />);
    await settle();
    const baseline = sidebarRender.mock.calls.length;
    expect(baseline).toBeGreaterThan(0); // the sidebar is mounted and painted

    // Four seconds of wall clock on a paused player.
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    expect(sidebarRender.mock.calls.length).toBe(baseline);
  });

  it('re-renders on the interval while playing', async () => {
    render(
      <DocPlayerWithSidebar doc={minimalDoc()} audioController={controller({ isPlaying: true })} />,
    );
    await settle();
    const baseline = sidebarRender.mock.calls.length;

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(sidebarRender.mock.calls.length).toBeGreaterThan(baseline);
  });

  // Gating the interval on playback must not cost a paused scrub its repaint:
  // `handleStateChange` writes to a ref, so without an explicit render the
  // sidebar would keep showing the pre-seek position.
  it('still repaints a paused seek', async () => {
    const audioController = controller();
    const { rerender } = render(
      <DocPlayerWithSidebar doc={minimalDoc()} audioController={audioController} />,
    );
    await settle();
    sidebarRender.mockClear();

    // A paused scrub: the controller reports a new time, still not playing.
    rerender(
      <DocPlayerWithSidebar
        doc={minimalDoc()}
        audioController={{ ...audioController, currentTime: 7 }}
      />,
    );
    await settle();

    expect(sidebarRender).toHaveBeenCalledWith(7);
  });
});
