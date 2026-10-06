/**
 * The progressive take-cutting engine, driven with a fake MediaRecorder (stop
 * events fire asynchronously, as in browsers), a hand-cranked activity gate
 * and a fake clock. Pins: a fresh recorder per take on the SAME stream, the
 * 2.5 s ceiling, the 350 ms pause flush gated by the 650 ms minimum, the
 * serial transcription queue, the word-aligned prompt tail, long-pause
 * auto-stop, and that cancel() goes silent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LONG_PAUSE_MS,
  DEFAULT_SEGMENT_MS,
  MAX_RECOGNITION_PROMPT_CHARS,
  ProgressiveSpeechToText,
  extendRecognitionPrompt,
  normalizeSpeechTranscript,
  type ProgressiveSpeechToTextOptions,
} from '../progressiveSpeechToText';
import type { SpeechActivityMonitor } from '../microphoneSpeechActivity';
import { createSpeechGate, rootMeanSquare } from '../microphoneSpeechActivity';

function last<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  stop(): void {
    this.readyState = 'ended';
  }
}

class FakeStream {
  readonly tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly mimeType: string;
  constructor(
    readonly stream: FakeStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
    FakeRecorder.instances.push(this);
  }
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    // Browsers flip state synchronously and deliver the events later.
    this.state = 'inactive';
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['take'], { type: this.mimeType }) });
      this.onstop?.();
    });
  }
}

class ManualMonitor implements SpeechActivityMonitor {
  onActivity: ((speaking: boolean, level: number) => void) | null = null;
  stopped = 0;
  start(onActivity: (speaking: boolean, level: number) => void): void {
    this.onActivity = onActivity;
  }
  stop(): void {
    this.stopped += 1;
  }
  emit(speaking: boolean, level = speaking ? 0.05 : 0.001): void {
    this.onActivity?.(speaking, level);
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

function make(overrides: Partial<ProgressiveSpeechToTextOptions> = {}) {
  const stream = new FakeStream();
  const monitor = new ManualMonitor();
  const calls: { prompt: string; signal: AbortSignal }[] = [];
  const replies: Deferred<string>[] = [];
  const transcripts: string[] = [];
  const errors: Error[] = [];
  const pending: number[] = [];
  const engine = new ProgressiveSpeechToText({
    stream: stream as unknown as MediaStream,
    activityMonitor: monitor,
    transcribe: (_blob, _mime, signal, prompt) => {
      calls.push({ prompt, signal });
      const reply = deferred<string>();
      replies.push(reply);
      return reply.promise;
    },
    onTranscript: (text) => transcripts.push(text),
    onError: (error) => errors.push(error),
    onPendingChange: (count) => pending.push(count),
    ...overrides,
  });
  return { engine, stream, monitor, calls, replies, transcripts, errors, pending };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecorder.instances = [];
  vi.stubGlobal('MediaRecorder', FakeRecorder);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ProgressiveSpeechToText take cutting', () => {
  it('cuts continuous speech at the 2.5 s ceiling with a fresh recorder on the same stream', async () => {
    const { engine, stream, monitor, calls } = make();
    engine.start();
    monitor.emit(true);
    expect(FakeRecorder.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(DEFAULT_SEGMENT_MS - 1);
    expect(FakeRecorder.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();

    expect(FakeRecorder.instances).toHaveLength(2);
    expect(FakeRecorder.instances[0].state).toBe('inactive');
    expect(FakeRecorder.instances[1].state).toBe('recording');
    expect(FakeRecorder.instances[1].stream).toBe(stream);
    expect(calls).toHaveLength(1);
    engine.cancel();
  });

  it('flushes a phrase on a 350 ms pause once the take is at least 650 ms long', async () => {
    const { engine, monitor, calls } = make();
    engine.start();
    monitor.emit(true);
    await vi.advanceTimersByTimeAsync(700);
    monitor.emit(true);
    await vi.advanceTimersByTimeAsync(200);
    monitor.emit(false); // 200 ms of silence: not yet
    await flush();
    expect(FakeRecorder.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(150);
    monitor.emit(false); // 350 ms of silence: flush
    await flush();
    expect(FakeRecorder.instances).toHaveLength(2);
    expect(calls).toHaveLength(1);
    engine.cancel();
  });

  it('does not flush a take shorter than the 650 ms minimum', async () => {
    const { engine, monitor } = make();
    engine.start();
    monitor.emit(true);
    await vi.advanceTimersByTimeAsync(100);
    monitor.emit(true);
    await vi.advanceTimersByTimeAsync(400);
    monitor.emit(false); // 400 ms silent but the take is only 500 ms old
    await flush();
    expect(FakeRecorder.instances).toHaveLength(1);
    engine.cancel();
  });
});

describe('ProgressiveSpeechToText transcription queue', () => {
  it('transcribes takes serially, in capture order, priming each with the prior text', async () => {
    const { engine, calls, replies, transcripts, pending } = make();
    engine.start();
    await vi.advanceTimersByTimeAsync(DEFAULT_SEGMENT_MS);
    await flush();
    await vi.advanceTimersByTimeAsync(DEFAULT_SEGMENT_MS);
    await flush();

    // Two takes captured, but only the first is in flight.
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toBe('');
    expect(last(pending)).toBe(2);

    replies[0].resolve('Hello there.');
    await flush();
    expect(transcripts).toEqual(['Hello there.']);
    expect(calls).toHaveLength(2);
    expect(calls[1].prompt).toBe('Hello there.');

    replies[1].resolve('  How are you?  ');
    await flush();
    expect(transcripts).toEqual(['Hello there.', 'How are you?']);
    expect(last(pending)).toBe(0);
    engine.cancel();
  });

  it('treats blank and [BLANK_AUDIO] results as silence and auto-stops after the long pause', async () => {
    const onLongPause = vi.fn();
    const { engine, replies, transcripts } = make({ onLongPause });
    engine.start();
    const takes = Math.ceil(DEFAULT_LONG_PAUSE_MS / DEFAULT_SEGMENT_MS);
    for (let index = 0; index < takes; index += 1) {
      await vi.advanceTimersByTimeAsync(DEFAULT_SEGMENT_MS);
      await flush();
      replies[index].resolve(index % 2 === 0 ? '' : '[BLANK_AUDIO]');
      await flush();
    }
    expect(transcripts).toEqual([]);
    expect(onLongPause).toHaveBeenCalledTimes(1);
    expect(onLongPause).toHaveBeenCalledWith(false);
    engine.cancel();
  });

  it('stop() delivers the in-flight takes, then releases the microphone', async () => {
    const { engine, stream, monitor, replies, transcripts } = make();
    engine.start();
    await vi.advanceTimersByTimeAsync(1_000);
    let stopped = false;
    void engine.stop().then(() => {
      stopped = true;
    });
    await flush();
    expect(monitor.stopped).toBeGreaterThan(0);
    expect(stream.tracks[0].readyState).toBe('ended');
    expect(stopped).toBe(false);
    // No new take after stop.
    expect(FakeRecorder.instances).toHaveLength(1);

    replies[0].resolve('last words');
    await flush();
    expect(transcripts).toEqual(['last words']);
    expect(stopped).toBe(true);
  });

  it('cancel() aborts the signal and suppresses every later callback', async () => {
    const { engine, stream, calls, replies, transcripts, errors } = make();
    engine.start();
    await vi.advanceTimersByTimeAsync(DEFAULT_SEGMENT_MS);
    await flush();
    engine.cancel();
    expect(calls[0].signal.aborted).toBe(true);
    expect(stream.tracks[0].readyState).toBe('ended');
    replies[0].resolve('too late');
    await flush();
    expect(transcripts).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('reports a transcription failure once', async () => {
    const { engine, replies, errors } = make();
    engine.start();
    await vi.advanceTimersByTimeAsync(DEFAULT_SEGMENT_MS);
    await flush();
    replies[0].reject(new Error('engine crashed'));
    await flush();
    expect(errors.map((error) => error.message)).toEqual(['engine crashed']);
    engine.cancel();
  });
});

describe('recognition prompt + transcript helpers', () => {
  it('keeps a word-aligned tail of at most 1,000 characters', () => {
    const word = 'alpha ';
    let prompt = '';
    for (let index = 0; index < 400; index += 1) prompt = extendRecognitionPrompt(prompt, word);
    expect(prompt.length).toBeLessThanOrEqual(MAX_RECOGNITION_PROMPT_CHARS);
    expect(prompt.startsWith('alpha')).toBe(true);
    expect(prompt.split(' ').every((part) => part === 'alpha')).toBe(true);
  });

  it('joins with single spaces and trims', () => {
    expect(extendRecognitionPrompt('', '  Hello ')).toBe('Hello');
    expect(extendRecognitionPrompt('Hello', 'world')).toBe('Hello world');
  });

  it('normalizes Whisper silence sentinels to empty', () => {
    expect(normalizeSpeechTranscript(' [BLANK_AUDIO] ')).toBe('');
    expect(normalizeSpeechTranscript('[ blank_audio ]')).toBe('');
    expect(normalizeSpeechTranscript(' words ')).toBe('words');
  });
});

describe('speech activity gate', () => {
  it('opens on speech above the adaptive floor and holds through a short dip', () => {
    const gate = createSpeechGate();
    expect(gate.step(0.002)).toBe(false);
    expect(gate.step(0.05)).toBe(true);
    // Below the open threshold but above the close threshold: still speaking.
    expect(gate.step(0.01)).toBe(true);
    expect(gate.step(0.001)).toBe(false);
  });

  it('computes RMS', () => {
    expect(rootMeanSquare(new Float32Array([]))).toBe(0);
    expect(rootMeanSquare(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
  });
});
