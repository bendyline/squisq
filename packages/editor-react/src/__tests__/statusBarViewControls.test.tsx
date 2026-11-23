/** @vitest-environment jsdom */

import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Doc } from '@bendyline/squisq/schemas';
import type {
  DocPlayerProps,
  PlaybackState,
  SlideshowControlsProps,
} from '@bendyline/squisq-react';

const playback: PlaybackState = {
  isPlaying: false,
  currentTime: 0,
  totalDuration: 10,
  currentBlockIndex: 1,
  totalBlocks: 3,
  docProgress: 0,
  hasCaptions: false,
  captionsEnabled: false,
  captionMode: 'off',
  currentSegmentIndex: 0,
  currentSegmentName: null,
  currentBlock: null,
};

function slideshowControls(
  overrides: Partial<SlideshowControlsProps> = {},
): SlideshowControlsProps {
  return {
    state: playback,
    slideNav: { nextSlide: vi.fn(), prevSlide: vi.fn(), goToSlide: vi.fn() },
    slides: [
      { id: 'a', label: '1', summary: 'Opening' },
      { id: 'b', label: '2', summary: 'The Philosophy' },
      { id: 'c', label: '3', summary: 'Closing' },
    ],
    ...overrides,
  };
}

// The player draws the controls DocPlayer would: the host's, or its own —
// the pill in slideshow mode, the overlay in video mode.
vi.mock('@bendyline/squisq-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bendyline/squisq-react')>();
  function MockDocPlayer(props: DocPlayerProps & { doc: Doc }) {
    if (!props.showControls) return <div data-testid="mock-doc-player" />;
    if (props.displayMode === 'video') {
      const playbackControls = {
        state: playback,
        actions: {
          toggle: vi.fn(),
          restart: vi.fn(),
          seekTo: vi.fn(),
          setCaptionsEnabled: vi.fn(),
          cycleCaptionMode: vi.fn(),
        },
        blockMarkers: [],
        expandedBlocks: [],
      };
      return (
        <div data-testid="mock-doc-player">
          {props.renderPlaybackControls ? (
            props.renderPlaybackControls(playbackControls)
          ) : (
            <div data-testid="video-overlay" />
          )}
        </div>
      );
    }
    return (
      <div data-testid="mock-doc-player">
        {props.renderSlideshowControls ? (
          props.renderSlideshowControls(slideshowControls())
        ) : (
          <div data-testid="overlay-pill" />
        )}
      </div>
    );
  }
  return { ...actual, useMediaProvider: () => null, DocPlayer: MockDocPlayer };
});

import { EditorProvider, useEditorContext } from '../EditorContext';
import { StatusBar } from '../StatusBar';
import { BlockCardView } from '../BlockCardView';
import { PreviewSettingsProvider } from '../PreviewControls';
import { PreviewPanel } from '../PreviewPanel';
import {
  PresentationModeControl,
  PresentationModeProvider,
} from '../presentation/PresentationMode';
import { StatusBarViewContent } from '../statusBar/StatusBarViewSlot';
import { useStatusBarViewTarget } from '../statusBar/statusBarViewTarget';
import { SlideshowStatusControls } from '../statusBar/SlideshowStatusControls';
import { FlashcardStatusControls } from '../statusBar/FlashcardStatusControls';
import type { FlashcardControls } from '@bendyline/squisq-react';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function statusBar() {
  return document.querySelector<HTMLElement>('.squisq-status-bar')!;
}

describe('the status bar view region', () => {
  it("holds the active view's content, between the counts and the host status", () => {
    render(
      <EditorProvider initialMarkdown="# Doc" articleId="view-region">
        <StatusBarViewContent>
          <span>View status</span>
        </StatusBarViewContent>
        <StatusBar slotRight={<span>Host status</span>} />
      </EditorProvider>,
    );

    const groups = Array.from(statusBar().children).map((child) => child.className);
    expect(groups).toEqual([
      'squisq-status-group squisq-status-doc',
      'squisq-status-view',
      'squisq-status-group squisq-status-end',
    ]);
    expect(within(statusBar().children[1] as HTMLElement).getByText('View status')).toBeTruthy();
    expect(within(statusBar().children[2] as HTMLElement).getByText('Host status')).toBeTruthy();
  });

  it('gives a view nowhere to draw without a status bar', () => {
    function Probe() {
      return <output data-testid="target">{String(useStatusBarViewTarget())}</output>;
    }
    render(
      <EditorProvider initialMarkdown="# Doc" articleId="no-status-bar">
        <StatusBarViewContent>
          <span>View status</span>
        </StatusBarViewContent>
        <Probe />
      </EditorProvider>,
    );
    expect(screen.queryByText('View status')).toBeNull();
    expect(screen.getByTestId('target').textContent).toBe('null');
  });

  it('tells its stylesheet whether an Edit or a Use view is on screen', () => {
    const { unmount } = render(
      <EditorProvider initialMarkdown="# Doc" articleId="edit-kind">
        <StatusBar />
      </EditorProvider>,
    );
    expect(statusBar().dataset.viewKind).toBe('edit');
    unmount();

    render(
      <EditorProvider initialMarkdown="# Doc" articleId="use-kind" initialView="preview">
        <StatusBar />
      </EditorProvider>,
    );
    expect(statusBar().dataset.viewKind).toBe('use');
  });
});

describe('BlockCardView navigation', () => {
  function Card({ inStatusBar }: { inStatusBar: boolean }) {
    const target = useStatusBarViewTarget();
    return (
      <BlockCardView
        blockCount={4}
        activeBlockKey={1}
        onPrev={() => undefined}
        onNext={() => undefined}
        onAdd={() => undefined}
        title="The Philosophy"
        navTarget={inStatusBar ? target : null}
      >
        <p>Block body</p>
      </BlockCardView>
    );
  }

  it('moves into the status bar when given its view region', () => {
    render(
      <EditorProvider initialMarkdown="# Doc" articleId="card-in-bar">
        <Card inStatusBar />
        <StatusBar />
      </EditorProvider>,
    );
    const nav = screen.getByRole('toolbar', { name: 'Block navigation' });
    expect(nav.closest('.squisq-status-view')).toBeTruthy();
    expect(nav.querySelector('.squisq-block-card-position')?.textContent).toBe(
      'Block 2 of 4 The Philosophy',
    );
    expect(screen.getByRole('button', { name: 'Add block' })).toBeTruthy();
  });

  it('stays under the card without one', () => {
    render(
      <EditorProvider initialMarkdown="# Doc" articleId="card-alone">
        <Card inStatusBar={false} />
        <StatusBar />
      </EditorProvider>,
    );
    const nav = screen.getByRole('toolbar', { name: 'Block navigation' });
    expect(nav.closest('.squisq-status-view')).toBeNull();
    expect(nav.closest('[data-testid="block-card-view"]')).toBeTruthy();
  });

  it('keeps the count and title the same width from block to block', () => {
    render(
      <BlockCardView
        blockCount={12}
        activeBlockKey={0}
        onPrev={() => undefined}
        onNext={() => undefined}
        title={null}
      >
        <p>Preamble</p>
      </BlockCardView>,
    );
    // Sized to the widest count the document can show.
    expect(document.querySelector<HTMLElement>('.squisq-block-card-count')?.dataset.sizer).toBe(
      'Block 12 of 12',
    );
    // A block without a heading keeps the title's place.
    expect(document.querySelector('.squisq-block-card-title')?.textContent).toBe('');
    expect(document.querySelector('.squisq-block-card-position')?.textContent).toBe(
      'Block 1 of 12 ',
    );
  });
});

describe('SlideshowStatusControls', () => {
  it('keeps the counter and title the same width from slide to slide', () => {
    render(
      <SlideshowStatusControls
        {...slideshowControls({
          state: { ...playback, currentBlockIndex: 0, totalBlocks: 12 },
          slides: [
            { id: 'cover', label: 'Cover', summary: '' },
            { id: 'a', label: '1', summary: 'Opening' },
          ],
        })}
      />,
    );
    const counter = screen.getByTestId('slide-counter').parentElement!;
    expect(counter.dataset.sizer).toBe('12 / 12');
    expect(counter.dataset.sizerAlt).toBe('Cover');
    // The title's place is kept for a slide with none.
    expect(document.querySelector('.squisq-status-view-title')?.textContent).toBe('');
  });

  it("shows the slide's number and title, and steps through slides", () => {
    const controls = slideshowControls();
    render(<SlideshowStatusControls {...controls} />);

    expect(screen.getByTestId('slide-counter').textContent).toBe('2 / 3');
    expect(screen.getByText('The Philosophy')).toBeTruthy();
    fireEvent.click(screen.getByTestId('slide-next'));
    fireEvent.click(screen.getByTestId('slide-prev'));
    expect(controls.slideNav.nextSlide).toHaveBeenCalledTimes(1);
    expect(controls.slideNav.prevSlide).toHaveBeenCalledTimes(1);
  });

  it('cannot go back from the first slide or on from the last', () => {
    const { rerender } = render(
      <SlideshowStatusControls
        {...slideshowControls({ state: { ...playback, currentBlockIndex: 0 } })}
      />,
    );
    expect((screen.getByTestId('slide-prev') as HTMLButtonElement).disabled).toBe(true);
    rerender(
      <SlideshowStatusControls
        {...slideshowControls({ state: { ...playback, currentBlockIndex: 2 } })}
      />,
    );
    expect((screen.getByTestId('slide-next') as HTMLButtonElement).disabled).toBe(true);
  });

  it('lists every slide from the counter and goes to the one chosen', () => {
    const controls = slideshowControls();
    render(<SlideshowStatusControls {...controls} />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Choose slide, current 2 / 3: The Philosophy' }),
    );
    const picker = screen.getByRole('menu', { name: 'Choose a slide' });
    expect(within(picker).getAllByRole('menuitem')).toHaveLength(3);
    expect(document.activeElement?.textContent).toBe('2The Philosophy');

    fireEvent.click(within(picker).getByRole('menuitem', { name: /Closing/ }));
    expect(controls.slideNav.goToSlide).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('offers build steps while a slide has them', () => {
    const showAllBuilds = vi.fn();
    const nextStep = vi.fn();
    const controls = slideshowControls({
      state: { ...playback, buildStep: 1, buildCount: 3 },
      slideNav: {
        nextSlide: vi.fn(),
        prevSlide: vi.fn(),
        goToSlide: vi.fn(),
        showAllBuilds,
        nextStep,
      },
    });
    render(<SlideshowStatusControls {...controls} />);

    expect(screen.getByRole('status').textContent).toBe('Build 1 of 3');
    fireEvent.click(screen.getByRole('button', { name: 'Show all build steps' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next build or slide' }));
    expect(showAllBuilds).toHaveBeenCalled();
    expect(nextStep).toHaveBeenCalled();
  });
});

describe('PreviewPanel slide navigation', () => {
  function Shell({ withStatusBar }: { withStatusBar: boolean }) {
    const { doc } = useEditorContext();
    const rootRef = useRef<HTMLDivElement>(null);
    return (
      <div ref={rootRef}>
        <PreviewSettingsProvider doc={doc}>
          <PresentationModeProvider rootRef={rootRef}>
            <PresentationModeControl />
            <PreviewPanel />
            {withStatusBar && <StatusBar />}
          </PresentationModeProvider>
        </PreviewSettingsProvider>
      </div>
    );
  }

  const SLIDESHOW = '---\ndisplay-mode: slideshow\n---\n\n# One\n\nFirst\n\n# Two\n\nSecond\n';

  it('puts the slideshow controls in the status bar', async () => {
    render(
      <EditorProvider initialMarkdown={SLIDESHOW} initialView="preview">
        <Shell withStatusBar />
      </EditorProvider>,
    );
    const controls = await screen.findByTestId('slideshow-controls');
    expect(controls.closest('.squisq-status-view')).toBeTruthy();
    expect(screen.queryByTestId('overlay-pill')).toBeNull();
  });

  it('keeps the overlay pill without a status bar', async () => {
    render(
      <EditorProvider initialMarkdown={SLIDESHOW} initialView="preview">
        <Shell withStatusBar={false} />
      </EditorProvider>,
    );
    expect(await screen.findByTestId('overlay-pill')).toBeTruthy();
    expect(screen.queryByTestId('slideshow-controls')).toBeNull();
  });

  it('gives the slide its pill back while a presentation hides the status bar', async () => {
    render(
      <EditorProvider initialMarkdown={SLIDESHOW} initialView="preview">
        <Shell withStatusBar />
      </EditorProvider>,
    );
    await screen.findByTestId('slideshow-controls');
    fireEvent.click(screen.getByRole('button', { name: 'Present: Fill canvas' }));

    await waitFor(() => expect(screen.getByTestId('overlay-pill')).toBeTruthy());
    expect(screen.queryByTestId('slideshow-controls')).toBeNull();
  });

  const VIDEO = '---\ndisplay-mode: video\n---\n\n# One\n\nFirst\n\n# Two\n\nSecond\n';

  it("puts video's playback controls, compact, in the status bar", async () => {
    render(
      <EditorProvider initialMarkdown={VIDEO} initialView="preview">
        <Shell withStatusBar />
      </EditorProvider>,
    );
    const controls = await screen.findByTestId('playback-controls-compact');
    expect(controls.closest('.squisq-status-view')).toBeTruthy();
    expect(within(controls).getByRole('slider', { name: 'Playback position' })).toBeTruthy();
    expect(screen.queryByTestId('video-overlay')).toBeNull();
  });

  it('keeps the overlay over the video without a status bar', async () => {
    render(
      <EditorProvider initialMarkdown={VIDEO} initialView="preview">
        <Shell withStatusBar={false} />
      </EditorProvider>,
    );
    expect(await screen.findByTestId('video-overlay')).toBeTruthy();
    expect(screen.queryByTestId('playback-controls-compact')).toBeNull();
  });

  it('gives the video its overlay back while a presentation hides the status bar', async () => {
    render(
      <EditorProvider initialMarkdown={VIDEO} initialView="preview">
        <Shell withStatusBar />
      </EditorProvider>,
    );
    await screen.findByTestId('playback-controls-compact');
    fireEvent.click(screen.getByRole('button', { name: 'Present: Fill canvas' }));
    await waitFor(() => expect(screen.getByTestId('video-overlay')).toBeTruthy());
    expect(screen.queryByTestId('playback-controls-compact')).toBeNull();
  });

  const NARRATE = '---\ndisplay-mode: narrate\n---\n\n# One\n\nFirst words here.\n';

  it("puts Narrate's toolbar row in the status bar, its settings staying put", async () => {
    render(
      <EditorProvider initialMarkdown={NARRATE} initialView="preview">
        <Shell withStatusBar />
      </EditorProvider>,
    );
    const rail = await screen.findByTestId('teleprompter-controls');
    const start = screen.getByRole('button', { name: 'Start prompter' });
    expect(start.closest('.squisq-status-view')).toBeTruthy();
    expect(rail.querySelector('.squisq-teleprompter-bar')).toBeNull();
  });

  it("keeps Narrate's toolbar row in its rail without a status bar", async () => {
    render(
      <EditorProvider initialMarkdown={NARRATE} initialView="preview">
        <Shell withStatusBar={false} />
      </EditorProvider>,
    );
    const rail = await screen.findByTestId('teleprompter-controls');
    expect(rail.querySelector('.squisq-teleprompter-bar')).toBeTruthy();
  });

  const FLASHCARDS =
    '---\ndisplay-mode: flashcards\n---\n\n## Capital of France\n\nParis.\n\n## Two plus two\n\nFour.\n';

  it('puts the flashcard controls in the status bar, and the card takes their room', async () => {
    render(
      <EditorProvider initialMarkdown={FLASHCARDS} initialView="preview">
        <Shell withStatusBar />
      </EditorProvider>,
    );
    const controls = await screen.findByTestId('flashcard-controls');
    expect(controls.closest('.squisq-status-view')).toBeTruthy();
    expect(document.querySelector('.squisq-flashcards__footer')).toBeNull();

    fireEvent.click(within(controls).getByRole('button', { name: 'Reveal' }));
    expect(screen.getByText('Paris.')).toBeTruthy();
    fireEvent.click(within(controls).getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('flashcard-position').textContent).toBe('Card 2 of 2');
  });

  it('keeps the flashcard controls in the deck without a status bar', async () => {
    render(
      <EditorProvider initialMarkdown={FLASHCARDS} initialView="preview">
        <Shell withStatusBar={false} />
      </EditorProvider>,
    );
    await waitFor(() => expect(document.querySelector('.squisq-flashcards__footer')).toBeTruthy());
    expect(screen.queryByTestId('flashcard-controls')).toBeNull();
  });
});

describe('FlashcardStatusControls', () => {
  function flashcardControls(overrides: Partial<FlashcardControls> = {}): FlashcardControls {
    return {
      cardIndex: 2,
      cardCount: 21,
      revealed: false,
      finished: false,
      cardKind: 'basic',
      lastCard: false,
      progress: 2 / 21,
      shuffled: false,
      missedCount: 0,
      canGoBack: true,
      previous: vi.fn(),
      next: vi.fn(),
      rate: vi.fn(),
      toggleShuffle: vi.fn(),
      restart: vi.fn(),
      retryMissed: vi.fn(),
      ...overrides,
    };
  }

  it('shows the position sized to its widest label, and Reveal before the answer', () => {
    const controls = flashcardControls();
    render(<FlashcardStatusControls {...controls} />);

    const position = screen.getByTestId('flashcard-position');
    expect(position.textContent).toBe('Card 3 of 21');
    expect(position.parentElement?.dataset.sizer).toBe('Card 21 of 21');
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(controls.next).toHaveBeenCalled();
    expect(controls.previous).toHaveBeenCalled();
  });

  it('rates a basic card once its answer shows', () => {
    const controls = flashcardControls({ revealed: true });
    render(<FlashcardStatusControls {...controls} />);

    fireEvent.click(screen.getByRole('button', { name: 'Again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(controls.rate).toHaveBeenNthCalledWith(1, 'again');
    expect(controls.rate).toHaveBeenNthCalledWith(2, 'got-it');
    expect(screen.queryByRole('button', { name: 'Reveal' })).toBeNull();
  });

  it('goes on from a quiz answer, and finishes on the last card', () => {
    const { rerender } = render(
      <FlashcardStatusControls
        {...flashcardControls({ revealed: true, cardKind: 'multiple-choice' })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Next card' })).toBeTruthy();
    rerender(
      <FlashcardStatusControls
        {...flashcardControls({ revealed: true, cardKind: 'multiple-choice', lastCard: true })}
      />,
    );
    expect(screen.getByRole('button', { name: 'Finish' })).toBeTruthy();
  });

  it('offers Shuffle as a setting that stays on, and Restart', () => {
    const controls = flashcardControls({ shuffled: true });
    render(<FlashcardStatusControls {...controls} />);

    const shuffle = screen.getByRole('button', { name: 'Shuffle' });
    expect(shuffle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(shuffle);
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(controls.toggleShuffle).toHaveBeenCalled();
    expect(controls.restart).toHaveBeenCalled();
  });

  it('reads Done with no card actions once the session is over', () => {
    render(
      <FlashcardStatusControls
        {...flashcardControls({ finished: true, cardIndex: 21, progress: 1, cardKind: undefined })}
      />,
    );
    expect(screen.getByTestId('flashcard-position').textContent).toBe('Done');
    for (const name of ['Reveal', 'Again', 'Next', 'Next card', 'Finish']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });
});
