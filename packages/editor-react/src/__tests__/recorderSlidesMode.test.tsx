/**
 * @vitest-environment jsdom
 *
 * Structural contract for the recorder dialog's slides mode — the peer of
 * `recorderNarrationMode.test.tsx`.
 *
 * Two things are being pinned here. First, the mode itself: a sibling of
 * narration mode that expands the dialog, claims the right column, and is
 * mutually exclusive with it. Second, and more load-bearing, the timing
 * capture: advances made while a take rolls must land in a v3 sidecar at the
 * path `applyNarrationTiming` reads, and must NOT be written when the user
 * unchecks the review checkbox (in which case the classic v1 script sidecar
 * takes the path back — the two share it and cannot coexist).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc, resolveThemeForDoc } from '@bendyline/squisq/doc';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import type { NarrationTimingJsonV3 } from '@bendyline/squisq/narration';
import type { Doc } from '@bendyline/squisq/schemas';
import { RecorderModal, type RecorderSaveResult } from '../recorder/RecorderModal';
import { fakeMediaProvider, stubRecorderGlobals } from './fakeMediaRecorder';

const MD = `# Intro

Alpha beta gamma words for the intro.

# Middle

Zeta eta theta words for the middle.

# Ending

Lambda mu nu words for the ending.
`;

const doc: Doc = markdownToDoc(parseMarkdown(MD));
const theme = resolveThemeForDoc(doc);

function slidesOptions(captureTimings: boolean) {
  return { doc, theme, captureTimings };
}

const mediaProvider = fakeMediaProvider();

function dialog(): HTMLElement {
  return screen.getByRole('dialog');
}

function checkbox(label: string): HTMLInputElement {
  return screen.getByLabelText(label, { exact: false }) as HTMLInputElement;
}

/** Advance the wall clock (and the recorder's duration ticker) by `ms`. */
async function advanceClock(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
}

describe('RecorderModal — slides mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubRecorderGlobals();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hides the checkbox and stays unexpanded without a slides prop', () => {
    render(<RecorderModal mediaProvider={mediaProvider} onClose={vi.fn()} />);
    expect(screen.queryByLabelText('Show slides mode', { exact: false })).toBeNull();
    expect(dialog().getAttribute('data-slides')).toBeNull();
    expect(dialog().getAttribute('data-panel-mode')).toBe('none');
  });

  it('expands and mounts the deck when checked, leaving narration untouched', async () => {
    render(
      <RecorderModal
        mediaProvider={mediaProvider}
        onClose={vi.fn()}
        slides={slidesOptions(false)}
      />,
    );

    await act(async () => {
      fireEvent.click(checkbox('Show slides mode'));
    });

    expect(dialog().getAttribute('data-slides')).toBe('true');
    expect(dialog().getAttribute('data-panel-mode')).toBe('slides');
    // The narration test hook must stay absent — slides mode is not narration.
    expect(dialog().getAttribute('data-narration')).toBeNull();
    expect(screen.getByTestId('recorder-slides-panel')).toBeTruthy();
    expect(screen.getByText('Slide 1 of 3')).toBeTruthy();
  });

  it('navigates the deck with buttons and arrow keys, showing the block body', async () => {
    render(
      <RecorderModal
        mediaProvider={mediaProvider}
        onClose={vi.fn()}
        slides={slidesOptions(false)}
      />,
    );
    await act(async () => {
      fireEvent.click(checkbox('Show slides mode'));
    });

    // Scoped to the notes region — the same prose also appears inside the
    // rendered slide card.
    const notes = () => screen.getByTestId('recorder-slide-notes');
    expect(notes().textContent).toContain('Alpha beta gamma words for the intro.');
    expect(screen.getByRole('button', { name: 'Previous slide' })).toHaveProperty('disabled', true);

    await click('Next slide');
    expect(screen.getByText('Slide 2 of 3')).toBeTruthy();
    expect(notes().textContent).toContain('Zeta eta theta words for the middle.');

    const panel = screen.getByTestId('recorder-slides-panel');
    await act(async () => {
      fireEvent.keyDown(panel, { key: 'ArrowRight' });
    });
    expect(screen.getByText('Slide 3 of 3')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next slide' })).toHaveProperty('disabled', true);

    await act(async () => {
      fireEvent.keyDown(panel, { key: 'ArrowLeft' });
    });
    expect(screen.getByText('Slide 2 of 3')).toBeTruthy();
  });

  it('is mutually exclusive with narration mode', async () => {
    render(
      <RecorderModal
        mediaProvider={mediaProvider}
        onClose={vi.fn()}
        slides={slidesOptions(false)}
        narration={{
          doc,
          theme,
          recording: {
            mediaProvider,
            container: null,
            markdownSource: MD,
            setMarkdownSource: vi.fn(),
            bumpMediaRevision: vi.fn(),
          },
        }}
      />,
    );

    await act(async () => {
      fireEvent.click(checkbox('Show slides mode'));
    });
    expect(dialog().getAttribute('data-panel-mode')).toBe('slides');

    await act(async () => {
      fireEvent.click(checkbox('Show narration mode'));
    });
    expect(dialog().getAttribute('data-panel-mode')).toBe('narration');
    expect(dialog().getAttribute('data-slides')).toBeNull();
    expect(checkbox('Show slides mode').checked).toBe(false);

    await act(async () => {
      fireEvent.click(checkbox('Show slides mode'));
    });
    expect(dialog().getAttribute('data-panel-mode')).toBe('slides');
    expect(dialog().getAttribute('data-narration')).toBeNull();
  });
});

describe('RecorderModal — slide timing capture', () => {
  let container: MemoryContentContainer;
  let onSave: ReturnType<typeof vi.fn<(result: RecorderSaveResult) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    stubRecorderGlobals();
    vi.useFakeTimers();
    container = new MemoryContentContainer();
    onSave = vi.fn<(result: RecorderSaveResult) => void>();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderDialog(captureTimings = true) {
    render(
      <RecorderModal
        mediaProvider={mediaProvider}
        container={container}
        onClose={vi.fn()}
        onSave={onSave}
        slides={slidesOptions(captureTimings)}
      />,
    );
  }

  /** Enter slides mode, record a take, advancing at 10s and 22s, stop at 30s. */
  async function recordWithAdvances() {
    await act(async () => {
      fireEvent.click(checkbox('Show slides mode'));
    });
    await click('Start preview');
    await click('Record');
    await advanceClock(10_000);
    await click('Next slide');
    await advanceClock(12_000);
    await click('Next slide');
    await advanceClock(8_000);
    await click('Stop');
  }

  async function readSidecar(path: string): Promise<NarrationTimingJsonV3> {
    const bytes = await container.readFile(path);
    expect(bytes).toBeTruthy();
    return JSON.parse(new TextDecoder().decode(bytes!)) as NarrationTimingJsonV3;
  }

  it('writes a v3 sidecar whose ranges match where the presenter advanced', async () => {
    renderDialog();
    await recordWithAdvances();

    const box = checkbox('Update block timings when I save this narration');
    expect(box.checked).toBe(true);

    await click('Save to document');

    const result = onSave.mock.calls[0][0];
    expect(result.slideTiming).toMatchObject({ blockCount: 3, unshownCount: 0 });
    expect(result.hasTimingSidecar).toBe(true);

    const timing = await readSidecar(result.slideTiming!.sidecarPath);
    expect(timing.version).toBe(3);
    expect(timing.generator?.method).toBe('presenter-advance');
    expect(timing.blocks.map((b) => [b.startSec, b.endSec])).toEqual([
      [0, 10],
      [10, 22],
      [22, 30],
    ]);
  });

  it('writes the classic v1 sidecar instead when the box is unchecked', async () => {
    renderDialog();
    await recordWithAdvances();

    await act(async () => {
      fireEvent.click(checkbox('Update block timings when I save this narration'));
    });
    await click('Save to document');

    const result = onSave.mock.calls[0][0];
    expect(result.slideTiming).toBeUndefined();

    // The v1 and v3 sidecars share one path; unchecking must hand it back to
    // v1, never leave a v3 file behind.
    const sidecar = await readSidecar(`${result.relativePath}.timing.json`);
    expect(sidecar.version).toBeUndefined();
    expect(sidecar.blocks).toBeUndefined();
  });

  it('does not offer the checkbox when the host cannot attach a sidecar', async () => {
    renderDialog(false);
    await recordWithAdvances();
    expect(
      screen.queryByLabelText('Update block timings when I save this narration', { exact: false }),
    ).toBeNull();
  });

  it('warns about slides the presenter never showed', async () => {
    renderDialog();
    await act(async () => {
      fireEvent.click(checkbox('Show slides mode'));
    });
    await click('Start preview');
    await click('Record');
    await advanceClock(10_000);
    await click('Next slide');
    await advanceClock(20_000);
    await click('Stop');

    expect(
      screen.getByText("1 of 3 slide was never shown — they'll be skipped during playback."),
    ).toBeTruthy();

    await click('Save to document');
    const result = onSave.mock.calls[0][0];
    expect(result.slideTiming).toMatchObject({ blockCount: 3, unshownCount: 1 });

    const timing = await readSidecar(result.slideTiming!.sidecarPath);
    // The unshown trailing block collapses to zero length at the take's end.
    expect(timing.blocks.map((b) => [b.startSec, b.endSec])).toEqual([
      [0, 10],
      [10, 30],
      [30, 30],
    ]);
  });

  it('resets the advance log on Discard & re-record', async () => {
    renderDialog();
    await recordWithAdvances();

    // Discarding releases the capture tracks, so the flow restarts from idle.
    await click('Discard & re-record');
    await click('Start preview');
    await click('Record');
    await advanceClock(15_000);
    await click('Stop');
    await click('Save to document');

    const result = onSave.mock.calls[0][0];
    // Only the seeded advance survives — the previous take's two are gone.
    expect(result.slideTiming).toMatchObject({ blockCount: 3, unshownCount: 2 });
    const timing = await readSidecar(result.slideTiming!.sidecarPath);
    expect(timing.blocks[0].startSec).toBe(0);
    expect(timing.blocks[1].startSec).toBe(timing.blocks[1].endSec);
  });
});
