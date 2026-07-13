/** @vitest-environment jsdom */

import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Doc } from '@bendyline/squisq/schemas';
import type { DocPlayerProps, PlaybackState } from '@bendyline/squisq-react';

vi.mock('@bendyline/squisq-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bendyline/squisq-react')>();
  const { useEffect } = await import('react');
  const state: PlaybackState = {
    isPlaying: false,
    currentTime: 0,
    totalDuration: 10,
    isCoverVisible: true,
    currentBlockIndex: 0,
    totalBlocks: 2,
    docProgress: 0,
    hasCaptions: false,
    captionsEnabled: false,
    captionMode: 'off',
    currentSegmentIndex: 0,
    currentSegmentName: null,
    currentBlock: null,
  };
  function MockDocPlayer(props: DocPlayerProps & { doc: Doc }) {
    const { onPlaybackStateChange, onControlsReady } = props;
    useEffect(() => {
      if (props.audioController) return;
      onPlaybackStateChange?.(state);
      onControlsReady?.({
        play: () => undefined,
        pause: () => undefined,
        toggle: () => undefined,
        restart: () => undefined,
        seekTo: () => undefined,
        setCaptionsEnabled: () => undefined,
        cycleCaptionMode: () => undefined,
      });
    }, [onControlsReady, onPlaybackStateChange, props.audioController]);
    return (
      <div
        data-testid="mock-doc-player"
        data-article={props.doc.articleId}
        data-audience={props.audioController ? 'true' : 'false'}
        data-controls={props.showControls ? 'true' : 'false'}
        data-cover={String(props.coverVisible)}
      />
    );
  }
  return {
    ...actual,
    useMediaProvider: () => null,
    DocPlayer: MockDocPlayer,
  };
});

import { EditorProvider, useEditorContext } from '../EditorContext';
import { PreviewSettingsProvider } from '../PreviewControls';
import { PreviewPanel } from '../PreviewPanel';
import {
  PresentationModeControl,
  PresentationModeProvider,
} from '../presentation/PresentationMode';

function Harness() {
  const { doc } = useEditorContext();
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={rootRef}>
      <PreviewSettingsProvider doc={doc}>
        <PresentationModeProvider rootRef={rootRef}>
          <PresentationModeControl />
          <PreviewPanel />
        </PresentationModeProvider>
      </PreviewSettingsProvider>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PreviewPanel presentation audience', () => {
  it('renders a clockless, controlled audience follower in the popup', async () => {
    const popupDocument = document.implementation.createHTMLDocument('');
    const popupEvents = new EventTarget();
    let closed = false;
    const popup = {
      document: popupDocument,
      get closed() {
        return closed;
      },
      close: vi.fn(() => {
        closed = true;
      }),
      focus: vi.fn(),
      addEventListener: popupEvents.addEventListener.bind(popupEvents),
      removeEventListener: popupEvents.removeEventListener.bind(popupEvents),
    } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(popup);

    render(
      <EditorProvider initialMarkdown="# Audience mirror\n\nBody" initialView="preview">
        <Harness />
      </EditorProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('mock-doc-player')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Presentation options' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /New window/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Present: New window' }));

    await waitFor(() => {
      const audience = popupDocument.querySelector<HTMLElement>(
        '[data-testid="mock-doc-player"][data-audience="true"]',
      );
      expect(audience).toBeTruthy();
      expect(audience?.dataset.controls).toBe('false');
      expect(audience?.dataset.cover).toBe('true');
    });
  });
});
