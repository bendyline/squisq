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
    vi.clearAllMocks();
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // `userAgentData` is set directly on the jsdom navigator by the system-audio
    // test (not via vi.stubGlobal), so unstubAllGlobals can't reach it.
    Reflect.deleteProperty(navigator, 'userAgentData');
  });

  it('shows a themed red dot on the ready-state Record button', async () => {
    render(<RecorderModal mediaProvider={mediaProvider} onClose={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start preview' }));
    });

    const recordButton = screen.getByRole('button', { name: 'Record' });
    const dot = recordButton.querySelector('.squisq-recorder-record-dot');
    const center = dot?.querySelector('.squisq-recorder-record-dot-center');

    expect(dot).not.toBeNull();
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect((dot as HTMLElement).style.padding).toBe('2px');
    expect((dot as HTMLElement).style.background).toBe('rgb(0, 0, 0)');
    expect((dot as HTMLElement).style.border).toBe('1px solid rgb(156, 163, 175)');
    expect((center as HTMLElement).style.background).toBe('var(--squisq-recorder-danger)');
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

  it('shows elapsed and total time while reviewing a recorded video', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-21T12:00:00Z'));
    render(<RecorderModal initialMode="screen" mediaProvider={mediaProvider} onClose={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start preview' }));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    await act(async () => {
      vi.advanceTimersByTime(56_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    });

    const timer = screen.getByRole('timer');
    expect(timer.textContent).toBe('0:00 / 0:56');
    expect(timer.getAttribute('aria-label')).toBe('Playback time: 0:00 of 0:56');

    const playback = document.querySelector('video[src="blob:take"]') as HTMLVideoElement;
    Object.defineProperty(playback, 'currentTime', { configurable: true, value: 12 });
    fireEvent.timeUpdate(playback);

    expect(timer.textContent).toBe('0:12 / 0:56');
  });

  it.each([
    { mode: 'mic' as const, tracks: ['audio'] as const, prefix: 'audio' },
    {
      mode: 'camera' as const,
      tracks: ['video', 'audio'] as const,
      prefix: 'camera+audio',
    },
    {
      mode: 'screen' as const,
      tracks: ['video', 'audio'] as const,
      prefix: 'screen+audio',
    },
  ])('names $mode saves from the tracks they contain', async ({ mode, tracks, prefix }) => {
    const captured = new FakeStream(tracks.map((kind) => new FakeTrack(kind)));
    if (mode === 'screen') {
      vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValue(
        captured as unknown as MediaStream,
      );
    } else {
      vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(
        captured as unknown as MediaStream,
      );
    }

    render(<RecorderModal initialMode={mode} mediaProvider={mediaProvider} onClose={vi.fn()} />);
    await recordATake();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save to document' }));
    });

    const firstSavedPath = vi.mocked(mediaProvider.addMedia).mock.calls[0]?.[0];
    expect(firstSavedPath).toMatch(
      new RegExp(`^(?:audio|video)/${prefix.replace('+', '\\+')}-\\d{8}-\\d{6}\\.webm$`),
    );
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

  it('saves a screen+camera take as two video files with a camera companion', async () => {
    const onSave = vi.fn();
    render(
      <RecorderModal
        initialMode="screen+camera"
        mediaProvider={mediaProvider}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    // Both video sources start armed for the dual mode.
    expect(toggle('Camera').getAttribute('aria-pressed')).toBe('true');
    expect(toggle('Screen').getAttribute('aria-pressed')).toBe('true');

    await recordATake();

    // Review still locks every source pill with an unsaved take in hand.
    for (const name of ['Microphone', 'Camera', 'Screen']) {
      expect(toggle(name).hasAttribute('disabled')).toBe(true);
      expect(toggle(name).getAttribute('title')).toBe(
        'Save or discard this recording before changing sources',
      );
    }

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save to document' }));
    });

    // Two files: screen (video-only display stream → no audio suffix) + camera
    // (mic-bearing getUserMedia stream → +audio), both under video/.
    const calls = vi.mocked(mediaProvider.addMedia).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[0]).toMatch(/^video\/screen-\d{8}-\d{6}\.webm$/);
    expect(calls[1]?.[0]).toMatch(/^video\/camera\+audio-\d{8}-\d{6}\.webm$/);

    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload.source).toBe('screen+camera');
    expect(payload.relativePath).toMatch(/^video\/screen-/);
    expect(payload.camera?.relativePath).toMatch(/^video\/camera\+audio-/);
  });

  it('suffixes a typed basename per file in a dual save', async () => {
    render(
      <RecorderModal
        initialMode="screen+camera"
        mediaProvider={mediaProvider}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Filename (optional)'), {
      target: { value: 'demo' },
    });
    await recordATake();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save to document' }));
    });

    const calls = vi.mocked(mediaProvider.addMedia).mock.calls;
    expect(calls[0]?.[0]).toBe('video/demo-screen.webm');
    expect(calls[1]?.[0]).toBe('video/demo-camera.webm');
  });

  it('offers a System audio pill on Chromium, gated on Screen being on', async () => {
    Object.defineProperty(navigator, 'userAgentData', {
      configurable: true,
      value: { brands: [{ brand: 'Chromium' }], mobile: false },
    });
    render(<RecorderModal initialMode="mic" mediaProvider={mediaProvider} onClose={vi.fn()} />);

    // Present, but inert until a display capture is armed.
    expect(toggle('System audio').hasAttribute('disabled')).toBe(true);
    expect(toggle('System audio').getAttribute('title')).toBe(
      'Turn on Screen to capture system audio',
    );

    await act(async () => {
      fireEvent.click(toggle('Screen'));
    });
    expect(toggle('System audio').hasAttribute('disabled')).toBe(false);
  });

  it('hides the System audio pill when the platform cannot capture it', () => {
    // jsdom's UA carries no Chromium token, so supportsSystemAudioCapture() is false.
    render(<RecorderModal initialMode="mic" mediaProvider={mediaProvider} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'System audio' })).toBeNull();
  });
});
