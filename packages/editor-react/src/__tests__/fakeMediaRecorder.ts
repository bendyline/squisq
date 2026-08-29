/**
 * Shared jsdom doubles for the recorder tests.
 *
 * `MediaRecorder` and `MediaStream` do not exist in jsdom, so every recorder
 * test has to stand them up. These were duplicated inline across the suite;
 * keeping one copy means a change to the fake's contract (a new callback, a
 * new track kind) is made once rather than drifting between files.
 */
import { vi } from 'vitest';
import type { MediaProvider } from '@bendyline/squisq/schemas';

export class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  constructor(public kind: 'audio' | 'video') {}
  stop(): void {
    this.readyState = 'ended';
  }
}

export class FakeStream {
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
export class FakeMediaRecorder {
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  mimeType: string;
  constructor(
    public stream: FakeStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
  }
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

/** A `MediaProvider` whose `addMedia` echoes back the requested path. */
export function fakeMediaProvider(): MediaProvider {
  return {
    resolveUrl: vi.fn(async (path: string) => path),
    listMedia: vi.fn(async () => []),
    addMedia: vi.fn(async (name: string) => name),
    removeMedia: vi.fn(async () => undefined),
    dispose: vi.fn(),
  };
}

/** Install the jsdom globals every recorder test needs. Call from `beforeEach`. */
export function stubRecorderGlobals(): void {
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
}
