import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkerEncoder } from '../workerEncoder.js';
import type { MainToWorkerMessage, WorkerToMainMessage } from '../workers/workerTypes.js';

class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent<WorkerToMainMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: MainToWorkerMessage[] = [];
  readonly terminate = vi.fn();

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: MainToWorkerMessage): void {
    this.posted.push(message);
  }

  emit(message: WorkerToMainMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerToMainMessage>);
  }
}

function createEncoder() {
  return createWorkerEncoder({ width: 640, height: 360, fps: 30, quality: 'normal' });
}

function bitmap(): ImageBitmap {
  return { close: vi.fn() } as unknown as ImageBitmap;
}

describe('createWorkerEncoder', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects invalid configs before allocating a worker', () => {
    expect(() =>
      createWorkerEncoder({ width: 640, height: 360, fps: 0, quality: 'normal' }),
    ).toThrow('Video FPS');
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('keeps frame backpressure until the worker acknowledges the frame', async () => {
    const encoder = createEncoder();
    const worker = FakeWorker.instances[0];
    worker.emit({ type: 'capabilities', backend: 'webcodecs' });
    await expect(encoder.ready).resolves.toBe('webcodecs');

    let completed = false;
    const pending = encoder.encodeFrame(bitmap(), 7).then(() => {
      completed = true;
    });

    await Promise.resolve();
    expect(completed).toBe(false);
    expect(worker.posted[worker.posted.length - 1]).toMatchObject({ type: 'frame', frameIndex: 7 });

    worker.emit({ type: 'frame-complete', frameIndex: 7 });
    await pending;
    expect(completed).toBe(true);
  });

  it('threads self-hosted ffmpeg core URLs through worker initialization', () => {
    createWorkerEncoder({
      width: 640,
      height: 360,
      fps: 30,
      quality: 'normal',
      ffmpegWasm: {
        coreURL: '/vendor/ffmpeg-core.js',
        wasmURL: '/vendor/ffmpeg-core.wasm',
      },
    });

    expect(FakeWorker.instances[0].posted[0]).toMatchObject({
      type: 'init',
      ffmpegWasm: {
        coreURL: '/vendor/ffmpeg-core.js',
        wasmURL: '/vendor/ffmpeg-core.wasm',
      },
    });
  });

  it('does not finalize until every submitted frame has completed', async () => {
    const encoder = createEncoder();
    const worker = FakeWorker.instances[0];
    worker.emit({ type: 'capabilities', backend: 'ffmpeg-wasm' });
    await encoder.ready;

    const frame = encoder.encodeFrame(bitmap(), 3);
    const finalized = encoder.finalize();
    await Promise.resolve();
    expect(worker.posted.some((message) => message.type === 'finalize')).toBe(false);

    worker.emit({ type: 'frame-complete', frameIndex: 3 });
    await frame;
    await Promise.resolve();
    expect(worker.posted[worker.posted.length - 1]).toEqual({ type: 'finalize' });

    const result = new ArrayBuffer(4);
    worker.emit({ type: 'complete', data: result, size: result.byteLength });
    await expect(finalized).resolves.toBe(result);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('rejects readiness when closed during initialization', async () => {
    const encoder = createEncoder();
    const worker = FakeWorker.instances[0];
    const readiness = expect(encoder.ready).rejects.toThrow('Encoder closed');

    encoder.close();

    await readiness;
    expect(worker.posted[worker.posted.length - 1]).toEqual({ type: 'cancel' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('rejects an in-flight finalization when closed', async () => {
    const encoder = createEncoder();
    const worker = FakeWorker.instances[0];
    worker.emit({ type: 'capabilities', backend: 'webcodecs' });
    await encoder.ready;

    const finalized = encoder.finalize();
    await Promise.resolve();
    expect(worker.posted[worker.posted.length - 1]).toEqual({ type: 'finalize' });

    encoder.close();

    await expect(finalized).rejects.toThrow('Encoder closed');
    expect(worker.posted[worker.posted.length - 1]).toEqual({ type: 'cancel' });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
