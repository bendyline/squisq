import { afterEach, expect, it, vi } from 'vitest';
import { createWorkerCalcEngine } from '../workerEngine';
import type { CalcWorkerResponse, CalcWorkerTransport } from '../worker/protocol';

afterEach(() => vi.useRealTimers());

it.each(['error', 'dispose', 'timeout'] as const)(
  'rejects outstanding calculation requests on %s',
  async (failure) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let receive: (message: CalcWorkerResponse) => void = () => {};
    let fail: (error: Error) => void = () => {};
    const transport: CalcWorkerTransport = {
      post: (message) => {
        if (message.type === 'create')
          queueMicrotask(() => receive({ type: 'ready', id: message.id }));
      },
      onMessage: (handler) => {
        receive = handler;
      },
      onError: (handler) => {
        fail = handler;
      },
      terminate: vi.fn(),
    };
    const engine = await createWorkerCalcEngine({ transport, requestTimeoutMs: 100 });
    const pending = engine.evaluateAll();
    const rejected = expect(pending).rejects.toThrow();
    if (failure === 'error') fail(new Error('worker crashed'));
    if (failure === 'dispose') engine.dispose();
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(101);
    await rejected;
    await expect(engine.evaluateAll()).rejects.toThrow();
    expect(transport.terminate).toHaveBeenCalledOnce();
    engine.dispose();
  },
);
