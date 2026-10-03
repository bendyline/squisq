import { afterEach, expect, it, vi } from 'vitest';
import { TableStoreClient } from '../store/client';
import type { KernelRequest, KernelResponse } from '../store/kernel';

class WorkerStub {
  static latest: WorkerStub;
  onmessage: ((event: { data: KernelResponse }) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  constructor() {
    WorkerStub.latest = this;
  }
  postMessage(message: KernelRequest) {
    if (message.type === 'init')
      queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', seq: message.seq } }));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(['error', 'decode', 'dispose', 'timeout'] as const)(
  'rejects outstanding grid requests on %s',
  async (failure) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('Worker', WorkerStub);
    const store = new TableStoreClient(
      { headers: ['Value'], cells: [[1]] },
      { requestTimeoutMs: 100 },
    );
    await store.describe();
    const pending = store.rows(0, 1);
    const rejected = expect(pending).rejects.toThrow();
    await Promise.resolve();
    if (failure === 'error')
      WorkerStub.latest.onerror?.(new ErrorEvent('error', { message: 'worker crashed' }));
    if (failure === 'decode') WorkerStub.latest.onmessageerror?.();
    if (failure === 'dispose') store.dispose();
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(101);
    await rejected;
    await expect(store.rows(0, 1)).rejects.toThrow();
    expect(WorkerStub.latest.terminate).toHaveBeenCalledOnce();
    store.dispose();
  },
);
