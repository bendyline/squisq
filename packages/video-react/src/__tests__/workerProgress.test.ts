/**
 * Regression: the encode worker reported fabricated progress.
 *
 * Both frame paths used `Math.round((n / (n + 1)) * scale)`, which depends only
 * on how many frames have arrived and never on how many are coming. It reached
 * ~45/50 after ten frames and then crept asymptotically toward 50 forever, so a
 * 30-frame export and a 30,000-frame export looked identical: a bar that jumps
 * to ~90% of the phase and then freezes for the entire encode.
 *
 * The worker cannot know the total on its own, so `InitMessage.totalFrames` now
 * carries it; without it, progress is reported `indeterminate` rather than
 * guessed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgressMessage, WorkerToMainMessage } from '../workers/workerTypes.js';

const posted: WorkerToMainMessage[] = [];
let onmessage: ((event: MessageEvent) => void) | null = null;

class FakeVideoEncoder {
  state = 'configured';
  static async isConfigSupported() {
    return { supported: true };
  }
  configure() {}
  encode() {}
  async flush() {}
  close() {
    this.state = 'closed';
  }
}

class FakeVideoFrame {
  close() {}
}

function fakeBitmap(): ImageBitmap {
  return { close: vi.fn(), width: 640, height: 480 } as unknown as ImageBitmap;
}

/** Push a message into the worker and let its internal queue drain. */
async function send(message: unknown): Promise<void> {
  onmessage?.({ data: message } as MessageEvent);
  // The worker serializes handling through a promise chain.
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function progressMessages(): ProgressMessage[] {
  return posted.filter((m): m is ProgressMessage => m.type === 'progress');
}

function frameProgress(): ProgressMessage[] {
  return progressMessages().filter((m) => /frame \d/.test(m.phase));
}

describe('encode worker frame progress', () => {
  beforeEach(async () => {
    posted.length = 0;
    onmessage = null;
    vi.resetModules();

    vi.stubGlobal('VideoEncoder', FakeVideoEncoder);
    vi.stubGlobal('VideoFrame', FakeVideoFrame);
    vi.stubGlobal('self', {
      postMessage: (msg: WorkerToMainMessage) => posted.push(msg),
      set onmessage(handler: (event: MessageEvent) => void) {
        onmessage = handler;
      },
      get onmessage() {
        return onmessage!;
      },
    });

    await import('../workers/encode.worker.js');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function init(totalFrames?: number): Promise<void> {
    await send({
      type: 'init',
      width: 640,
      height: 480,
      fps: 30,
      quality: 'normal',
      ...(totalFrames !== undefined ? { totalFrames } : {}),
    });
    posted.length = 0; // drop 'capabilities' + 'Encoder ready'
  }

  async function pushFrames(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await send({ type: 'frame', bitmap: fakeBitmap(), frameIndex: i, timestamp: i * 33_333 });
    }
  }

  it('reports progress as a real fraction of the known total', async () => {
    await init(100);
    await pushFrames(10);

    const last = frameProgress().at(-1)!;
    // 10 of 100 frames over a 0..50 phase == 5%. The old formula said ~45%.
    expect(last.percent).toBe(5);
    expect(last.indeterminate).toBeUndefined();
  });

  it('does not jump to ~45% after ten frames regardless of total', async () => {
    await init(1000);
    await pushFrames(10);

    // The old `n/(n+1)*50` formula produced 45 here for ANY total.
    expect(frameProgress().at(-1)!.percent).toBe(1);
  });

  it('scales with the total: the same frame count means less progress in a longer export', async () => {
    await init(200);
    await pushFrames(10);
    const short = frameProgress().at(-1)!.percent;

    posted.length = 0;
    await init(2000);
    await pushFrames(10);
    const long = frameProgress().at(-1)!.percent;

    // The bug: these were identical (~45) because the total was never used.
    expect(short).toBeGreaterThan(long);
  });

  it('advances monotonically and reaches the full phase share at the last frame', async () => {
    await init(20);
    await pushFrames(20);

    const percents = frameProgress().map((m) => m.percent);
    expect(percents.at(-1)).toBe(50);
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
    }
  });

  it('labels frames against the real total', async () => {
    await init(120);
    await pushFrames(3);
    expect(frameProgress().at(-1)!.phase).toBe('Encoding frame 3/120');
  });

  it('reports indeterminate progress rather than guessing when no total is given', async () => {
    await init();
    await pushFrames(10);

    const last = frameProgress().at(-1)!;
    expect(last.indeterminate).toBe(true);
    expect(last.percent).toBe(0);
    expect(last.phase).toBe('Encoding frame 10');
  });

  it('never exceeds its phase share even if extra frames arrive', async () => {
    await init(5);
    await pushFrames(8);
    for (const message of frameProgress()) {
      expect(message.percent).toBeLessThanOrEqual(50);
    }
  });
});
