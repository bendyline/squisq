/**
 * @vitest-environment jsdom
 *
 * Regression coverage for unsaved-take destruction in the recorder review
 * state.
 *
 * The bug: `togglesLocked` only covered `'recording' | 'requesting'`, so the
 * capture-source toggles stayed enabled in `'stopped'` (review) — while an
 * unsaved blob was sitting in the recorder. Flipping any toggle rewrote
 * `captureKey`, whose effect calls `recorder.cancel()` → `setBlob(null)`,
 * destroying the just-recorded take with no confirmation and no undo.
 *
 * The fix locks the toggles for as long as an unsaved take exists; the
 * already-present "Discard & re-record" button is the explicit way out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { RecorderModal } from '../recorder/RecorderModal';

const mediaProvider: MediaProvider = {
  resolveUrl: vi.fn(async (path: string) => path),
  listMedia: vi.fn(async () => []),
  addMedia: vi.fn(async (name: string) => name),
  removeMedia: vi.fn(async () => undefined),
  dispose: vi.fn(),
};

class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  constructor(public kind: 'audio' | 'video') {}
  stop(): void {
    this.readyState = 'ended';
  }
}

class FakeStream {
  constructor(private tracks: FakeTrack[] = [new FakeTrack('audio')]) {}
  get active() {
    return this.tracks.some((t) => t.readyState === 'live');
  }
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
}

/** Minimal MediaRecorder that emits one chunk and reports `inactive` on stop. */
class FakeMediaRecorder {
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(
    public stream: FakeStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
  }
  mimeType: string;
  static isTypeSupported() {
    return true;
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['take'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

/** Drive the modal from idle to the review state with a take in hand. */
async function recordATake() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Start preview' }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
  });
}

const toggle = (name: string) => screen.getByRole('button', { name });

describe('RecorderModal — unsaved take is not silently destroyed', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaStream', FakeStream);
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => new FakeStream()),
        getDisplayMedia: vi.fn(async () => new FakeStream([new FakeTrack('video')])),
      },
    });
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
  });

  it('locks the capture-source toggles while an unsaved take is in review', async () => {
    render(<RecorderModal mediaProvider={mediaProvider} onClose={vi.fn()} />);

    // Configuring is unrestricted before anything is captured.
    expect(toggle('Camera').hasAttribute('disabled')).toBe(false);

    await recordATake();

    // Review reached: the take is savable...
    expect(screen.getByRole('button', { name: 'Save to document' })).toBeTruthy();
    // ...so every source toggle is locked, with the reason surfaced.
    for (const name of ['Microphone', 'Camera', 'Screen']) {
      expect(toggle(name).hasAttribute('disabled')).toBe(true);
      expect(toggle(name).getAttribute('title')).toBe(
        'Save or discard this recording before changing sources',
      );
    }
  });

  it('keeps the recorded take when a source toggle is clicked in review', async () => {
    render(<RecorderModal mediaProvider={mediaProvider} onClose={vi.fn()} />);
    await recordATake();

    // The click the old build honoured — cancel() → blob dropped.
    await act(async () => {
      fireEvent.click(toggle('Camera'));
    });

    // Still in review with the take intact: Save is the only way it leaves.
    expect(screen.queryByRole('button', { name: 'Save to document' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard & re-record' })).not.toBeNull();
    // A destroyed take falls back to the pre-capture prompt.
    expect(screen.queryByText('Click Start Preview to start a recording.')).toBeNull();
  });

  it('unlocks the toggles once the take is explicitly discarded', async () => {
    render(<RecorderModal mediaProvider={mediaProvider} onClose={vi.fn()} />);
    await recordATake();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Discard & re-record' }));
    });

    // Discarding is consent: reconfiguring is available again.
    for (const name of ['Microphone', 'Camera', 'Screen']) {
      expect(toggle(name).hasAttribute('disabled')).toBe(false);
    }
    expect(screen.queryByRole('button', { name: 'Save to document' })).toBeNull();
  });
});
