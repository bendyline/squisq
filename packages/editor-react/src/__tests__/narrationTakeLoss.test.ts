/**
 * @vitest-environment jsdom
 *
 * Losing a take the user just performed is the worst outcome this flow
 * has, so the discard paths get their own coverage.
 *
 * `stop()` nulls `captureRef` BEFORE it decodes the blob and runs
 * `alignNarration` — seconds of work on a long take. From that moment the
 * unmount teardown sees nothing to tear down, so unmounting during
 * "Aligning take…" (a deliberate mode/tab switch — PreviewPanel only
 * exempts Narrate from REPARSE unmounts) dropped the audio on the floor:
 * `setTake` fired on an unmounted hook and the blob went with it. No save
 * opportunity, no warning, no trace.
 *
 * The take lives in hook state, so it cannot be rescued from inside the
 * hook — there is no surface left to render it into and no I/O deps here.
 * What IS fixed is the silence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { NarrationScript } from '@bendyline/squisq/narration';
import { useNarrationRecorder } from '../teleprompter/recording/useNarrationRecorder';
import type { MicAnalysisHandle } from '../teleprompter/useMicAnalysis';

class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  constructor(public kind: 'audio' | 'video') {}
  stop(): void {
    this.readyState = 'ended';
  }
}

class FakeStream {
  constructor(public tracks: FakeTrack[]) {}
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

/** Unlike the startup suite's fake, this one actually fires 'stop'. */
class StoppableRecorder {
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstart: (() => void) | null = null;
  mimeType = 'audio/webm';
  private listeners: Record<string, (() => void)[]> = {};
  start() {
    this.state = 'recording';
    this.onstart?.();
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['audio-bytes'], { type: 'audio/webm' }) });
    for (const l of this.listeners['stop'] ?? []) l();
  }
  addEventListener(type: string, cb: () => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener() {}
  static isTypeSupported() {
    return true;
  }
}

const script: NarrationScript = {
  sourceText: 'hello there',
  tokens: [],
  blocks: [],
  totalSyllables: 0,
  cumulativeSyllables: [0],
};

/**
 * Gate the decode so a test can unmount while the hook is in 'processing'.
 * jsdom's Blob has no `arrayBuffer()`, which `stop()` reaches BEFORE
 * `decodeAudioData` — so that is where the gate has to live, or the decode
 * throws instantly and 'processing' never lasts long enough to observe.
 */
let releaseDecode: () => void;
let decodeGate: Promise<void>;

function micHandle(): MicAnalysisHandle {
  const stream = new FakeStream([new FakeTrack('audio')]);
  return {
    status: 'live',
    stream: stream as unknown as MediaStream,
    error: null,
    start: vi.fn(async () => stream as unknown as MediaStream),
    stop: vi.fn(),
  } as unknown as MicAnalysisHandle;
}

function renderRecorder() {
  return renderHook(() =>
    useNarrationRecorder({
      mic: micHandle(),
      getScript: () => script,
      getWordPos: () => 0,
      getMicDeviceId: () => null,
    }),
  );
}

/** Typed so `warn.mock.calls` stays inferable rather than `any[]`. */
function spyOnWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

describe('useNarrationRecorder — take loss is never silent', () => {
  let warn: ReturnType<typeof spyOnWarn>;

  beforeEach(() => {
    decodeGate = new Promise<void>((resolve) => {
      releaseDecode = resolve;
    });
    vi.stubGlobal('MediaStream', FakeStream);
    vi.stubGlobal('MediaRecorder', StoppableRecorder);
    vi.stubGlobal(
      'AudioContext',
      class {
        async decodeAudioData(): Promise<AudioBuffer> {
          throw new Error('decode unsupported in this environment');
        }
        async close(): Promise<void> {}
      },
    );
    Object.defineProperty(Blob.prototype, 'arrayBuffer', {
      configurable: true,
      writable: true,
      value: async function arrayBuffer(): Promise<ArrayBuffer> {
        await decodeGate;
        return new ArrayBuffer(16);
      },
    });
    warn = spyOnWarn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    warn.mockRestore();
    Reflect.deleteProperty(Blob.prototype, 'arrayBuffer');
  });

  /** Drive the hook to 'processing' and park it there. */
  async function toProcessing() {
    const rendered = renderRecorder();
    await act(async () => {
      await rendered.result.current.start();
    });
    expect(rendered.result.current.state).toBe('recording');

    let stopPromise!: Promise<void>;
    act(() => {
      stopPromise = rendered.result.current.stop();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(rendered.result.current.state).toBe('processing');
    return { ...rendered, stopPromise };
  }

  it('warns when the view is torn down while a take is still aligning', async () => {
    const { unmount, stopPromise, result } = await toProcessing();

    // The user switches display mode / tab while "Aligning take…" is showing.
    unmount();
    releaseDecode();
    await act(async () => {
      await stopPromise;
    });

    // The take is gone — that part is inherent to it living in hook state.
    expect(result.current.take).toBeNull();
    // But it is no longer gone SILENTLY.
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('Narration take discarded'))).toBe(true);
    expect(messages.some((m) => m.includes('still being aligned'))).toBe(true);
  });

  it('warns when an unsaved take in review is torn down', async () => {
    const { unmount, stopPromise, result } = await toProcessing();
    releaseDecode();
    await act(async () => {
      await stopPromise;
    });
    expect(result.current.state).toBe('review');
    expect(result.current.take).not.toBeNull();

    warn.mockClear();
    unmount();

    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('Unsaved narration take discarded'))).toBe(true);
  });

  /**
   * The warning must be discriminating: a take the user SAVED, discarded,
   * or retook is not a loss, and warning about it would train people to
   * ignore the message that matters.
   */
  it('stays quiet when the take was saved before unmount', async () => {
    const { unmount, stopPromise, result } = await toProcessing();
    releaseDecode();
    await act(async () => {
      await stopPromise;
    });

    act(() => {
      result.current.beginSave();
    });
    act(() => {
      result.current.finishSave(true);
    });
    expect(result.current.take).toBeNull();

    warn.mockClear();
    unmount();
    expect(warn).not.toHaveBeenCalled();
  });

  it('stays quiet when the take was explicitly discarded before unmount', async () => {
    const { unmount, stopPromise, result } = await toProcessing();
    releaseDecode();
    await act(async () => {
      await stopPromise;
    });

    act(() => {
      result.current.discard();
    });
    warn.mockClear();
    unmount();
    expect(warn).not.toHaveBeenCalled();
  });

  it('stays quiet on an unmount with no take at all', async () => {
    const { unmount } = renderRecorder();
    warn.mockClear();
    unmount();
    expect(warn).not.toHaveBeenCalled();
  });

  it('a take that finishes aligning while still mounted is delivered as normal', async () => {
    const { stopPromise, result } = await toProcessing();
    releaseDecode();
    await act(async () => {
      await stopPromise;
    });

    // Decode failed (the stub throws), so alignment degrades to null — but
    // the take itself, which is the recording, must survive.
    expect(result.current.state).toBe('review');
    expect(result.current.take?.audioBlob.size).toBeGreaterThan(0);
    expect(result.current.take?.alignment).toBeNull();
  });
});
