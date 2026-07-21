/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import type { AudioController } from '@bendyline/squisq-react';
import type { TimelineClock } from '../useTimelineClock';
import { TimelineCompositionPanel } from '../TimelineCompositionPanel';

vi.mock('@bendyline/squisq-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bendyline/squisq-react')>();
  return {
    ...actual,
    DocPlayer: (props: {
      audioController: AudioController;
      displayMode: string;
      videoPresentation: string;
      showControls: boolean;
    }) => (
      <button
        type="button"
        data-testid="mock-composition-player"
        data-current-time={props.audioController.currentTime}
        data-display-mode={props.displayMode}
        data-presentation={props.videoPresentation}
        data-controls={String(props.showControls)}
        onClick={() => void props.audioController.toggle()}
      />
    ),
  };
});

vi.mock('../PreviewControls', () => ({
  usePreviewSettings: () => ({
    activeViewport: { width: 1600, height: 900 },
    activeTheme: {},
    activeTransformStyle: '',
    activeCaptionStyle: 'subtitle',
    activeCaptionsEnabled: true,
    activeVideoPresentation: 'picture-in-picture',
    activePipSize: 'small',
    activePipPosition: 'bottom-right',
    activeCoverSlide: true,
  }),
}));

vi.mock('../usePreviewProjection', () => ({
  usePreviewProjection: (doc: unknown) => (doc ? { contentDoc: doc, playerDoc: doc } : null),
}));

vi.mock('../EditorContext', () => ({
  useEditorContext: () => ({ fileName: 'composition.md' }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TimelineCompositionPanel', () => {
  it('renders Video mode from the shared timeline clock', () => {
    const doc = markdownToDoc(parseMarkdown('# First\n\nComposed content.'), {
      articleId: 'timeline-composition',
    });
    const toggle = vi.fn();
    const onClose = vi.fn();
    const clock: TimelineClock = {
      currentTime: 3.5,
      isPlaying: false,
      play: vi.fn(),
      pause: vi.fn(),
      toggle,
      seek: vi.fn(),
    };
    const { rerender } = render(
      <TimelineCompositionPanel doc={doc} clock={clock} onClose={onClose} />,
    );

    const player = screen.getByTestId('mock-composition-player');
    expect(player.getAttribute('data-display-mode')).toBe('video');
    expect(player.getAttribute('data-presentation')).toBe('picture-in-picture');
    expect(player.getAttribute('data-controls')).toBe('false');
    expect(player.getAttribute('data-current-time')).toBe('3.5');
    expect(screen.getByText('0:03')).toBeTruthy();

    fireEvent.click(player);
    expect(toggle).toHaveBeenCalledOnce();

    rerender(
      <TimelineCompositionPanel
        doc={doc}
        clock={{ ...clock, currentTime: 8.2 }}
        onClose={onClose}
      />,
    );
    expect(screen.getByTestId('mock-composition-player').getAttribute('data-current-time')).toBe(
      '8.2',
    );
    expect(screen.getByText('0:08')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hide video composition' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
