/**
 * @vitest-environment jsdom
 *
 * "Show narration mode" in the Record media dialog.
 *
 * Structural coverage: without the `narration` prop the dialog is byte-for-
 * byte the classic recorder (no checkbox); with it, checking the box expands
 * the dialog, mounts the teleprompter stage on the right, remaps the source
 * toggles to the narration recorder, and removes every simple-pipeline save
 * affordance (so `onSave` — and the host's markdown insertion behind it —
 * can never fire for a narration take).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { DEFAULT_THEME, type MediaProvider } from '@bendyline/squisq/schemas';
import { RecorderModal, type RecorderNarrationOptions } from '../recorder/RecorderModal';

const mediaProvider: MediaProvider = {
  resolveUrl: vi.fn(async (path: string) => path),
  listMedia: vi.fn(async () => []),
  addMedia: vi.fn(async (name: string) => name),
  removeMedia: vi.fn(async () => undefined),
  dispose: vi.fn(),
};

const doc = markdownToDoc(parseMarkdown('# Section\n\nOne two three four five.\n'));

function narrationOptions(): RecorderNarrationOptions {
  return {
    doc,
    theme: DEFAULT_THEME,
    recording: {
      mediaProvider,
      container: null,
      markdownSource: '# Section\n\nOne two three four five.\n',
      setMarkdownSource: vi.fn(),
      bumpMediaRevision: vi.fn(),
    },
  };
}

const narrationCheckbox = () =>
  screen.queryByRole('checkbox', { name: 'Show narration mode' }) as HTMLInputElement | null;

const dialog = () => screen.getByRole('dialog');

describe('RecorderModal — Show narration mode', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:take'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.localStorage.removeItem('squisq:teleprompter-prefs');
  });

  it('hides the checkbox and renders the classic dialog without the narration prop', () => {
    render(<RecorderModal mediaProvider={mediaProvider} onClose={vi.fn()} />);

    expect(narrationCheckbox()).toBeNull();
    expect(dialog().getAttribute('data-narration')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start preview' })).toBeTruthy();
    expect(screen.getByLabelText(/Script/)).toBeTruthy();
  });

  it('hides the checkbox when narration.recording is null (prompter would have no save path)', () => {
    render(
      <RecorderModal
        mediaProvider={mediaProvider}
        onClose={vi.fn()}
        narration={{ doc, theme: DEFAULT_THEME, recording: null }}
      />,
    );
    expect(narrationCheckbox()).toBeNull();
  });

  it('checking the box expands the dialog and mounts the narration stage', async () => {
    const onSave = vi.fn();
    render(
      <RecorderModal
        mediaProvider={mediaProvider}
        onClose={vi.fn()}
        onSave={onSave}
        narration={narrationOptions()}
      />,
    );

    await act(async () => {
      fireEvent.click(narrationCheckbox()!);
    });

    // Expanded layout marker + the teleprompter stage with its control rail.
    expect(dialog().getAttribute('data-narration')).toBe('true');
    expect(screen.getByTestId('teleprompter-controls')).toBeTruthy();
    expect(screen.getByText('⇱ Pop out')).toBeTruthy();
    expect(screen.getByLabelText('Countdown')).toBeTruthy();

    // The dialog's left column is the source of truth for starting: the
    // rail's record slot and Start/Pause transport button are suppressed
    // (Restart and Countdown stay), and the classic Start preview button
    // remains — it now arms the mic (and camera) for narration.
    expect(screen.queryByTestId('teleprompter-record')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start prompter' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Restart prompter' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start preview' })).toBeTruthy();
    // Record appears only after the preview armed the mic.
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull();

    // Simple-pipeline affordances are gone: no Save to document, no
    // free-text script (the prompter reads the document).
    expect(screen.queryByRole('button', { name: 'Save to document' })).toBeNull();
    expect(screen.queryByLabelText(/Script/)).toBeNull();
    expect(onSave).not.toHaveBeenCalled();

    // Source toggles remap: mic pinned on, screen unavailable.
    const mic = screen.getByRole('button', { name: 'Microphone' });
    expect(mic.getAttribute('aria-pressed')).toBe('true');
    expect(mic.hasAttribute('disabled')).toBe(true);
    const screenToggle = screen.getByRole('button', { name: 'Screen' });
    expect(screenToggle.hasAttribute('disabled')).toBe(true);
    expect(screenToggle.getAttribute('title')).toMatch(/narration mode/);
  });

  it('the Camera toggle drives the narration recorder withCamera flag', async () => {
    render(
      <RecorderModal
        mediaProvider={mediaProvider}
        onClose={vi.fn()}
        narration={narrationOptions()}
      />,
    );
    await act(async () => {
      fireEvent.click(narrationCheckbox()!);
    });

    const camera = screen.getByRole('button', { name: 'Camera' });
    expect(camera.getAttribute('aria-pressed')).toBe('false');
    // No camera armed: the mic meter shows instead of a preview box.
    expect(screen.queryByText('Click Start preview to turn on your camera.')).toBeNull();
    expect(screen.getByText('Click Start preview to check your mic.')).toBeTruthy();

    await act(async () => {
      fireEvent.click(camera);
    });
    expect(camera.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Click Start preview to turn on your camera.')).toBeTruthy();
  });

  it('unchecking restores the classic dialog with prior source selection', async () => {
    render(
      <RecorderModal
        mediaProvider={mediaProvider}
        initialMode="screen"
        onClose={vi.fn()}
        narration={narrationOptions()}
      />,
    );

    await act(async () => {
      fireEvent.click(narrationCheckbox()!);
    });
    expect(dialog().getAttribute('data-narration')).toBe('true');

    await act(async () => {
      fireEvent.click(narrationCheckbox()!);
    });
    expect(dialog().getAttribute('data-narration')).toBeNull();
    expect(screen.queryByTestId('teleprompter-controls')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start preview' })).toBeTruthy();
    // The screen source picked before entering narration mode is intact.
    expect(screen.getByRole('button', { name: 'Screen' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});
