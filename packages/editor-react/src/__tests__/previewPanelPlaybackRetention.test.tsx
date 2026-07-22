/** @vitest-environment jsdom */

import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Doc } from '@bendyline/squisq/schemas';
import type { DocPlayerProps } from '@bendyline/squisq-react';
import type { ContentContainer } from '@bendyline/squisq/storage';

vi.mock('@bendyline/squisq/doc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bendyline/squisq/doc')>();
  return {
    ...actual,
    resolveAudioMapping: async (doc: Doc) => ({
      ...doc,
      audio: {
        segments: [
          {
            src: 'narration.mp3',
            name: 'Narration',
            duration: 184,
            startTime: 0,
          },
        ],
      },
    }),
  };
});

vi.mock('@bendyline/squisq-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@bendyline/squisq-react')>();

  function MockDocPlayer(props: DocPlayerProps & { doc: Doc }) {
    const [currentTime, setCurrentTime] = useState(0);

    // Mirrors the real internal audio controller's track-change behavior. An
    // equivalent track should retain its identity across a theme-only reparse.
    useEffect(() => setCurrentTime(0), [props.doc.audio]);

    return (
      <div
        data-testid="mock-doc-player"
        data-current-time={currentTime}
        data-doc-theme={props.doc.themeId ?? ''}
        data-render-theme={props.theme?.id ?? ''}
        data-audio-src={props.doc.audio.segments[0]?.src ?? ''}
      >
        <button type="button" onClick={() => setCurrentTime(91)}>
          Seek preview
        </button>
      </div>
    );
  }

  return {
    ...actual,
    useMediaProvider: () => null,
    DocPlayer: MockDocPlayer,
  };
});

import { EditorProvider, useEditorContext } from '../EditorContext';
import { PreviewPanel } from '../PreviewPanel';
import { PreviewSettingsProvider, usePreviewSettings } from '../PreviewControls';

const WORKSPACE_CONTAINER = {} as ContentContainer;

function SelectThemeButton() {
  const { setSelectedThemeId } = usePreviewSettings();
  return (
    <button type="button" onClick={() => setSelectedThemeId('bold')}>
      Select bold theme
    </button>
  );
}

function Harness() {
  const { doc } = useEditorContext();
  return (
    <PreviewSettingsProvider doc={doc}>
      <SelectThemeButton />
      <PreviewPanel workspaceContainer={WORKSPACE_CONTAINER} />
    </PreviewSettingsProvider>
  );
}

afterEach(cleanup);

describe('PreviewPanel playback retention', () => {
  it.each(['video', 'slideshow'])('keeps the %s position when the theme changes', async (mode) => {
    render(
      <EditorProvider
        initialMarkdown={`---\ndisplay-mode: ${mode}\n---\n\n# One\n\nFirst slide.\n\n# Two\n\nSecond slide.`}
        initialView="preview"
      >
        <Harness />
      </EditorProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('mock-doc-player').dataset.audioSrc).toBe('narration.mp3');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Seek preview' }));
    expect(screen.getByTestId('mock-doc-player').dataset.currentTime).toBe('91');

    fireEvent.click(screen.getByRole('button', { name: 'Select bold theme' }));

    // Wait for the persisted source to finish its debounced parse and produce
    // a new Doc. This crosses both reset points from the regression: the
    // temporary parsing render and the rebuilt AudioTrack object.
    await waitFor(
      () => {
        const player = screen.getByTestId('mock-doc-player');
        expect(player.dataset.docTheme).toBe('bold');
        expect(player.dataset.renderTheme).toBe('bold');
        expect(player.dataset.currentTime).toBe('91');
      },
      { timeout: 1_000 },
    );
  });
});
