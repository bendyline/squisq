import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useNarrationRecorder } from '../teleprompter/recording/useNarrationRecorder';
import type { MicAnalysisHandle } from '../teleprompter/useMicAnalysis';
import { FakeStream, FakeTrack } from './fakeMediaRecorder';

class Recorder {
  static instances: Recorder[] = [];
  static isTypeSupported() {
    return true;
  }
  state = 'inactive';
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstart: (() => void) | null = null;
  listeners = new Map<string, () => void>();
  constructor(
    readonly stream: FakeStream,
    options?: MediaRecorderOptions,
  ) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
    Recorder.instances.push(this);
  }
  start() {
    this.state = 'recording';
    this.onstart?.();
  }
  stop = vi.fn(() => {
    this.state = 'inactive';
  });
  finish() {
    this.ondataavailable?.({ data: new Blob(['tail']) });
    this.listeners.get('stop')?.();
  }
  addEventListener(type: string, callback: () => void) {
    this.listeners.set(type, callback);
  }
  removeEventListener(type: string) {
    this.listeners.delete(type);
  }
}

describe('narration recording byte limits', () => {
  beforeEach(() => {
    Recorder.instances = [];
    vi.stubGlobal('MediaRecorder', Recorder);
    vi.stubGlobal('MediaStream', FakeStream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => new FakeStream([new FakeTrack('video')])),
      },
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stops both lanes before either drains, retaining delayed chunks and a failed save', async () => {
    const audio = new FakeStream();
    const mic = { stream: audio, start: async () => audio } as unknown as MicAnalysisHandle;
    const { result } = renderHook(() =>
      useNarrationRecorder({
        mic,
        maxRecordingBytes: 8,
        getScript: () => null,
        getWordPos: () => 0,
        getMicDeviceId: () => null,
      }),
    );
    act(() => result.current.setWithCamera(true));
    await act(async () => result.current.start());
    const [primary, camera] = Recorder.instances;
    act(() => primary.ondataavailable?.({ data: new Blob(['1234']) }));
    expect(result.current.state).toBe('recording');
    // A delayed browser event may take us over the threshold. Preserve it.
    act(() => camera.ondataavailable?.({ data: new Blob(['567890']) }));
    expect(result.current.state).toBe('processing');
    expect(primary.stop).toHaveBeenCalledTimes(1);
    expect(camera.stop).toHaveBeenCalledTimes(1);
    expect(result.current.limitReached).toBe(true);
    expect(result.current.take).toBeNull();
    await act(async () => {
      primary.finish();
      camera.finish();
    });
    expect(result.current.state).toBe('review');
    expect(result.current.recordedBytes).toBe(18);
    expect(result.current.take?.audioBlob.size).toBe(8);
    expect(result.current.take?.cameraBlob?.size).toBe(10);
    expect(camera.stream.getTracks().every((t) => t.readyState === 'ended')).toBe(true);
    const take = result.current.take;
    act(() => {
      result.current.beginSave();
      result.current.finishSave(false, new Error('Disk full'));
    });
    expect(result.current.state).toBe('review');
    expect(result.current.take).toBe(take);
    act(() => result.current.discard());
    expect(result.current.recordedBytes).toBe(0);
    expect(result.current.limitReached).toBe(false);
  });
});
