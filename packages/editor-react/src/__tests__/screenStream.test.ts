/**
 * @vitest-environment jsdom
 *
 * Regression coverage for the screen-capture audio mix.
 *
 * The bug: `requestScreenStream` stopped the system-audio tracks
 * immediately after wiring them into the mix `AudioContext`, on the
 * false premise that "the mixed output keeps its own copies via the
 * AudioContext graph". `new MediaStream([track])` does NOT clone a
 * track, and a `MediaStreamAudioSourceNode` whose track has ended
 * outputs silence — so screen+mic takes recorded with "system audio"
 * enabled came back mic-only, unrecoverably.
 *
 * The fix keeps the source tracks live for the lifetime of the mixed
 * output and moves their teardown into `dispose()`. Both halves are
 * asserted here: losing the second half would trade a data-loss bug for
 * a stuck screen-share indicator.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestScreenStream } from '../recorder/sources/screenStream';

class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  constructor(
    public kind: 'audio' | 'video',
    public label: string,
  ) {}
  stop(): void {
    this.readyState = 'ended';
  }
}

class FakeStream {
  private tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = [...tracks];
  }
  getTracks(): FakeTrack[] {
    return [...this.tracks];
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((t) => t.kind === 'video');
  }
  addTrack(t: FakeTrack): void {
    this.tracks.push(t);
  }
}

/** Records which tracks were wired into the graph, so we can assert on them. */
const connectedSources: FakeTrack[] = [];
let contextClosed = false;

class FakeAudioContext {
  createMediaStreamSource(stream: FakeStream) {
    // The real constructor pulls the single track out of the stream; the
    // node holds a live reference to THAT track (no clone).
    const [track] = stream.getAudioTracks();
    if (track) connectedSources.push(track);
    return { connect: () => {} };
  }
  createMediaStreamDestination() {
    return { stream: new FakeStream([new FakeTrack('audio', 'mixed-output')]) };
  }
  close(): Promise<void> {
    contextClosed = true;
    return Promise.resolve();
  }
}

function installMediaMocks(displayTracks: FakeTrack[], micTracks: FakeTrack[]) {
  const getDisplayMedia = vi.fn(async () => new FakeStream(displayTracks));
  const getUserMedia = vi.fn(async () => new FakeStream(micTracks));
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getDisplayMedia, getUserMedia },
  });
  return { getDisplayMedia, getUserMedia };
}

describe('requestScreenStream — mixed system audio lifecycle', () => {
  beforeEach(() => {
    connectedSources.length = 0;
    contextClosed = false;
    vi.stubGlobal('MediaStream', FakeStream);
    vi.stubGlobal('AudioContext', FakeAudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps system-audio + mic source tracks LIVE after building the mixed stream', async () => {
    const sysAudio = new FakeTrack('audio', 'system');
    const video = new FakeTrack('video', 'screen');
    const mic = new FakeTrack('audio', 'mic');
    installMediaMocks([video, sysAudio], [mic]);

    const handle = await requestScreenStream({ systemAudio: true, includeMicrophone: true });

    // Both raw sources were wired into the graph...
    expect(connectedSources).toContain(sysAudio);
    expect(connectedSources).toContain(mic);
    // ...and BOTH must still be live, or the mix produces silence.
    expect(sysAudio.readyState).toBe('live');
    expect(mic.readyState).toBe('live');

    // The output carries the screen video + exactly one mixed audio track.
    const out = handle.stream as unknown as FakeStream;
    expect(out.getVideoTracks()).toEqual([video]);
    expect(out.getAudioTracks().map((t) => t.label)).toEqual(['mixed-output']);
    // The raw system-audio track is deliberately NOT a member of the
    // output — which is exactly why dispose() has to own stopping it.
    expect(out.getTracks()).not.toContain(sysAudio);
  });

  it('stops the system-audio + mic source tracks on dispose()', async () => {
    const sysAudio = new FakeTrack('audio', 'system');
    const video = new FakeTrack('video', 'screen');
    const mic = new FakeTrack('audio', 'mic');
    installMediaMocks([video, sysAudio], [mic]);

    const handle = await requestScreenStream({ systemAudio: true, includeMicrophone: true });
    expect(sysAudio.readyState).toBe('live');

    handle.dispose();

    // No leaked capture: the share indicator must not stay lit.
    expect(sysAudio.readyState).toBe('ended');
    expect(mic.readyState).toBe('ended');
    expect(contextClosed).toBe(true);
  });

  it('dispose() is idempotent', async () => {
    const sysAudio = new FakeTrack('audio', 'system');
    const mic = new FakeTrack('audio', 'mic');
    installMediaMocks([new FakeTrack('video', 'screen'), sysAudio], [mic]);

    const handle = await requestScreenStream({ systemAudio: true, includeMicrophone: true });
    handle.dispose();
    expect(() => handle.dispose()).not.toThrow();
    expect(sysAudio.readyState).toBe('ended');
  });

  it('leaves the system-audio track in the stream when no mic is mixed', async () => {
    const sysAudio = new FakeTrack('audio', 'system');
    const video = new FakeTrack('video', 'screen');
    installMediaMocks([video, sysAudio], []);

    const handle = await requestScreenStream({ systemAudio: true, includeMicrophone: false });

    // Without a mix there's no AudioContext: the display stream is handed
    // back as-is, so the caller's own `stream.getTracks()` teardown
    // reaches the system audio and dispose() has nothing to own.
    expect(handle.stream as unknown as FakeStream).toBeInstanceOf(FakeStream);
    expect((handle.stream as unknown as FakeStream).getAudioTracks()).toContain(sysAudio);
    expect(sysAudio.readyState).toBe('live');
  });
});
