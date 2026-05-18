import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaRecorder } from '../recorder/hooks/useMediaRecorder.js';

/**
 * Lifecycle test for the recorder hook with stubbed browser APIs.
 * Drives request → start → stop and verifies the surface contract:
 * state transitions, blob production, and cleanup on cancel.
 */

class FakeMediaStreamTrack {
  readyState: 'live' | 'ended' = 'live';
  kind: 'audio' | 'video';
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
  constructor(kind: 'audio' | 'video') {
    this.kind = kind;
  }
}

class FakeMediaStream {
  tracks: FakeMediaStreamTrack[];
  constructor(tracks: FakeMediaStreamTrack[] = []) {
    this.tracks = tracks;
  }
  get active() {
    return this.tracks.some((t) => t.readyState === 'live');
  }
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
}

interface FakeRecorderHandle {
  state: 'recording' | 'inactive';
  mimeType: string;
  stream: FakeMediaStream;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  start(): void;
  stop(): void;
}

let lastRecorder: FakeRecorderHandle | null = null;

class FakeMediaRecorder implements FakeRecorderHandle {
  state: 'recording' | 'inactive' = 'inactive';
  mimeType: string;
  stream: FakeMediaStream;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(stream: FakeMediaStream, options?: { mimeType?: string }) {
    this.stream = stream;
    this.mimeType = options?.mimeType ?? 'audio/webm';
    // Expose the most recent instance to the test body so assertions can
    // poke at its state/event handlers. Not a `const self = this` alias
    // pattern — `lastRecorder` is a module-level slot, not a workaround
    // for arrow-function-vs-method `this` confusion.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastRecorder = this;
  }
  static isTypeSupported(mime: string): boolean {
    return mime.startsWith('audio/webm') || mime.startsWith('video/webm');
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    // Emit a fake data chunk then resolve.
    this.ondataavailable?.({ data: new Blob(['hello'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const originalMediaRecorder = (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
const originalNavigator = globalThis.navigator;

beforeEach(() => {
  lastRecorder = null;
  (globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeMediaRecorder;
  const fakeStream = new FakeMediaStream([new FakeMediaStreamTrack('audio')]);
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(fakeStream),
      },
    },
    configurable: true,
  });
});

afterEach(() => {
  if (originalMediaRecorder === undefined) {
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
  } else {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = originalMediaRecorder;
  }
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
  });
});

describe('useMediaRecorder lifecycle', () => {
  it('walks idle → ready → recording → stopped and produces a blob', async () => {
    const { result } = renderHook(() => useMediaRecorder({ source: 'mic' }));

    expect(result.current.state).toBe('idle');

    await act(async () => {
      await result.current.request();
    });
    expect(result.current.state).toBe('ready');
    expect(result.current.stream).not.toBeNull();
    expect(result.current.mimeType).toMatch(/^audio\/webm/);
    expect(result.current.extension).toBe('.webm');
    expect(result.current.directory).toBe('audio');

    act(() => {
      result.current.start();
    });
    expect(result.current.state).toBe('recording');
    expect(lastRecorder?.state).toBe('recording');

    let blob: Blob | null = null;
    await act(async () => {
      blob = await result.current.stop();
    });
    expect(result.current.state).toBe('stopped');
    expect(blob).toBeInstanceOf(Blob);
    expect(result.current.blob).toBeInstanceOf(Blob);
  });

  it('reset() returns to ready when the underlying stream is still live (discard & re-record)', async () => {
    const { result } = renderHook(() => useMediaRecorder({ source: 'mic' }));

    await act(async () => {
      await result.current.request();
    });
    act(() => {
      result.current.start();
    });
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.state).toBe('stopped');

    act(() => {
      result.current.reset();
    });

    expect(result.current.state).toBe('ready');
    expect(result.current.blob).toBeNull();
    expect(result.current.stream).not.toBeNull();
  });

  it('cancel() tears down state and stops the stream tracks', async () => {
    const { result } = renderHook(() => useMediaRecorder({ source: 'mic' }));

    await act(async () => {
      await result.current.request();
    });
    const stream = result.current.stream as unknown as FakeMediaStream;
    expect(stream).not.toBeNull();
    const tracks = stream.getTracks();

    act(() => {
      result.current.cancel();
    });

    expect(result.current.state).toBe('idle');
    expect(result.current.stream).toBeNull();
    expect(tracks.every((t) => t.stop.mock.calls.length > 0)).toBe(true);
  });
});
