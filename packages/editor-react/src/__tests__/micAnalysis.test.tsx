/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMicAnalysis } from '../teleprompter/useMicAnalysis';
import { FakeStream, FakeTrack, stubRecorderGlobals } from './fakeMediaRecorder';

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state = 'running';
  sampleRate = 48000;
  destination = {};
  close = vi.fn(async () => undefined);
  source = { connect: vi.fn(), disconnect: vi.fn() };
  processor = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onaudioprocess: null as
      | ((event: {
          inputBuffer: { getChannelData: () => Float32Array };
          playbackTime: number;
        }) => void)
      | null,
  };
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createMediaStreamSource = vi.fn(() => this.source);
  createScriptProcessor = vi.fn(() => this.processor);
  createGain = vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }));
}

describe('useMicAnalysis capture stream ownership', () => {
  beforeEach(() => {
    stubRecorderGlobals();
    FakeAudioContext.instances = [];
    vi.stubGlobal('AudioContext', FakeAudioContext);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('waits for capture, analyzes its PCM, and never stops borrowed tracks', async () => {
    const capture = new FakeStream([new FakeTrack('audio'), new FakeTrack('video')]);
    const stream = capture as unknown as MediaStream;
    const { result, rerender, unmount } = renderHook(
      ({ stream }: { stream: MediaStream | null }) => useMicAnalysis(undefined, stream),
      { initialProps: { stream: null as MediaStream | null } },
    );
    await act(async () => {
      expect(await result.current.start(null)).toBeNull();
    });
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    await act(async () => rerender({ stream }));
    expect(result.current.status).toBe('live');
    expect(result.current.stream).toBe(stream);
    const receive = vi.fn();
    result.current.subscribeHop(receive);
    const graph = FakeAudioContext.instances[0];
    graph.processor.onaudioprocess!({
      inputBuffer: { getChannelData: () => new Float32Array([0.5]) },
      playbackTime: 1,
    });
    expect(receive).toHaveBeenCalledWith(new Float32Array([0.5]), 1);
    act(() => result.current.stop());
    expect(graph.close).toHaveBeenCalledOnce();
    expect(capture.getTracks().every((track) => track.readyState === 'live')).toBe(true);
    await act(async () => {
      await result.current.start(null);
    });
    unmount();
    expect(capture.getTracks().every((track) => track.readyState === 'live')).toBe(true);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it('switches capture streams and tears down analysis when capture ends', async () => {
    const first = new FakeStream() as unknown as MediaStream;
    const second = new FakeStream() as unknown as MediaStream;
    const { result, rerender } = renderHook(
      ({ stream }: { stream: MediaStream | null }) => useMicAnalysis(undefined, stream),
      { initialProps: { stream: first as MediaStream | null } },
    );
    await act(async () => rerender({ stream: second }));
    expect(result.current.stream).toBe(second);
    expect(FakeAudioContext.instances[0].close).toHaveBeenCalled();
    await act(async () => rerender({ stream: null }));
    expect(result.current.status).toBe('idle');
    expect(result.current.stream).toBeNull();
    expect(first.getTracks()[0].readyState).toBe('live');
    expect(second.getTracks()[0].readyState).toBe('live');
  });

  it('releases the microphone when analysis acquired it itself', async () => {
    const { result, unmount } = renderHook(() => useMicAnalysis());
    await act(async () => {
      await result.current.start(null);
    });
    const stream = result.current.stream!;
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
    unmount();
    expect(stream.getTracks()[0].readyState).toBe('ended');
  });

  it('keeps borrowed capture alive if audio analysis fails', async () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('Audio unavailable');
        }
      },
    );
    const stream = new FakeStream() as unknown as MediaStream;
    const { result } = renderHook(() => useMicAnalysis(undefined, stream));
    await act(async () => {});
    expect(result.current.error?.message).toBe('Audio unavailable');
    expect(stream.getTracks()[0].readyState).toBe('live');
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });
});
