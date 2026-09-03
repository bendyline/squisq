/**
 * `createWorkerCalcEngine` — the in-house engine behind a Web Worker,
 * speaking the same `CalcEngine` contract. Evaluation of a large workbook
 * never touches the UI thread, so hosts can run generous budgets without
 * jank.
 *
 * Spawning: `new Worker(new URL('./worker/index.js', import.meta.url),
 * { type: 'module' })` — the pattern bundlers (Vite, webpack 5) understand
 * and emit as an asset, and that plain ESM serving resolves naturally. The
 * worker bundle is fully self-contained (this package has no runtime
 * dependencies). Hosts whose bundler pre-bundles this package must exclude
 * it (Vite: `optimizeDeps.exclude`), or the relative URL breaks — the same
 * rule as every wasm/worker-shipping squisq package.
 *
 * Environments without `Worker` (Node, SSR) and spawn failures reject the
 * returned promise; callers fall back to `createInHouseEngine`. Tests
 * drive the identical protocol through an in-process transport
 * (`createLocalCalcTransport`), which doubles as the protocol-parity proof.
 */

import type {
  CalcBudgets,
  CalcCellAddress,
  CalcCellState,
  CalcEngine,
  CalcEngineCapabilities,
  CalcEvaluationResult,
  CalcRangeAddress,
  CalcScalar,
  CalcValue,
  CalcWorkbookSeed,
} from './types.js';
import { createInHouseEngine } from './engine.js';
import { createCalcWorkerHost } from './worker/host.js';
import type {
  CalcWorkerRequest,
  CalcWorkerResponse,
  CalcWorkerTransport,
  SerializableEngineConfig,
} from './worker/protocol.js';

const CREATE_TIMEOUT_MS = 5_000;

/** Distributive Omit — plain Omit collapses a discriminated union. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type RequestWithoutId = DistributiveOmit<Extract<CalcWorkerRequest, { id: number }>, 'id'>;

/** In-process transport: the worker host driven on a microtask — the test
 * path AND the protocol-parity proof. */
export function createLocalCalcTransport(): CalcWorkerTransport {
  let handler: ((message: CalcWorkerResponse) => void) | null = null;
  const host = createCalcWorkerHost((message) => {
    queueMicrotask(() => handler?.(message));
  });
  return {
    post: (message) => {
      queueMicrotask(() => host(message));
    },
    onMessage: (fn) => {
      handler = fn;
    },
    terminate: () => {
      handler = null;
    },
  };
}

function spawnWorkerTransport(workerFactory?: () => Worker): CalcWorkerTransport {
  if (typeof Worker === 'undefined') {
    throw new Error('Web Workers are unavailable in this environment');
  }
  const worker = workerFactory
    ? workerFactory()
    : new Worker(new URL('./worker/index.js', import.meta.url), { type: 'module' });
  return {
    post: (message) => worker.postMessage(message),
    onMessage: (fn) => {
      worker.onmessage = (event: MessageEvent<CalcWorkerResponse>) => fn(event.data);
    },
    terminate: () => worker.terminate(),
  };
}

export interface WorkerCalcEngineOptions extends SerializableEngineConfig {
  /** Transport override — tests/Node use `createLocalCalcTransport()`. */
  transport?: CalcWorkerTransport;
  /**
   * Worker construction override for bundler-managed hosts. Vite:
   * `import CalcWorker from '@bendyline/squisq-calc/worker?worker'` then
   * `workerFactory: () => new CalcWorker()` — the bundler emits and serves
   * the worker asset itself, which is more reliable than the default
   * relative-URL spawn under aggressive bundling.
   */
  workerFactory?: () => Worker;
}

class WorkerCalcEngine implements CalcEngine {
  readonly capabilities: CalcEngineCapabilities;

  private readonly transport: CalcWorkerTransport;
  private readonly pending = new Map<
    number,
    { resolve: (message: CalcWorkerResponse) => void; reject: (err: Error) => void }
  >();
  private seq = 0;
  private disposed = false;

  constructor(transport: CalcWorkerTransport) {
    this.transport = transport;
    // Same tier, same capabilities — declared from a local instance so the
    // list can never drift from the engine the worker actually runs.
    const probe = createInHouseEngine();
    this.capabilities = probe.capabilities;
    probe.dispose();
    transport.onMessage((message) => {
      if (!('id' in message)) return;
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.type === 'error') waiter.reject(new Error(message.message));
      else waiter.resolve(message);
    });
  }

  /** Post a request that answers, and await its response. */
  request(message: RequestWithoutId): Promise<CalcWorkerResponse> {
    this.assertLive();
    const id = ++this.seq;
    return new Promise<CalcWorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.transport.post({ ...message, id } as CalcWorkerRequest);
    });
  }

  async loadWorkbook(seed: CalcWorkbookSeed): Promise<void> {
    await this.request({ type: 'loadWorkbook', seed });
  }

  setCellValue(address: CalcCellAddress, value: CalcScalar | null): void {
    this.assertLive();
    this.transport.post({ type: 'setCellValue', address, value });
  }

  setCellFormula(address: CalcCellAddress, formula: string): void {
    this.assertLive();
    this.transport.post({ type: 'setCellFormula', address, formula });
  }

  clearCell(address: CalcCellAddress): void {
    this.assertLive();
    this.transport.post({ type: 'clearCell', address });
  }

  async getCell(address: CalcCellAddress): Promise<CalcCellState> {
    const [state] = await this.getCells([address]);
    return state!;
  }

  async getCells(addresses: readonly CalcCellAddress[]): Promise<CalcCellState[]> {
    const response = await this.request({ type: 'getCells', addresses: [...addresses] });
    return (response as Extract<CalcWorkerResponse, { type: 'cells' }>).states;
  }

  async evaluateAll(budgets?: CalcBudgets): Promise<CalcEvaluationResult> {
    const response = await this.request({ type: 'evaluateAll', budgets });
    return (response as Extract<CalcWorkerResponse, { type: 'evaluated' }>).result;
  }

  async evaluateFormula(formula: string, context?: CalcCellAddress): Promise<CalcValue> {
    const response = await this.request({ type: 'evaluateFormula', formula, context });
    return (response as Extract<CalcWorkerResponse, { type: 'value' }>).value;
  }

  async precedentsOf(address: CalcCellAddress): Promise<CalcRangeAddress[]> {
    const response = await this.request({ type: 'precedentsOf', address });
    return (response as Extract<CalcWorkerResponse, { type: 'ranges' }>).ranges;
  }

  async dependentsOf(address: CalcCellAddress): Promise<CalcCellAddress[]> {
    const response = await this.request({ type: 'dependentsOf', address });
    return (response as Extract<CalcWorkerResponse, { type: 'addresses' }>).addresses;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.transport.post({ type: 'dispose' });
    for (const waiter of this.pending.values()) {
      waiter.reject(new Error('CalcEngine disposed'));
    }
    this.pending.clear();
    this.transport.terminate();
  }

  private assertLive(): void {
    if (this.disposed) throw new Error('CalcEngine used after dispose()');
  }
}

/**
 * Create the worker-hosted in-house engine. Rejects when a worker cannot
 * spawn (no Worker API, asset missing) — callers fall back to
 * `createInHouseEngine` on the main thread.
 */
export async function createWorkerCalcEngine(
  options: WorkerCalcEngineOptions = {},
): Promise<CalcEngine> {
  const { transport: transportOverride, workerFactory, ...config } = options;
  const transport = transportOverride ?? spawnWorkerTransport(workerFactory);
  const engine = new WorkerCalcEngine(transport);
  try {
    // The create handshake doubles as the liveness probe: a worker whose
    // script failed to load never answers, and the timeout rejects.
    await Promise.race([
      engine.request({ type: 'create', config }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('calc worker did not start')), CREATE_TIMEOUT_MS),
      ),
    ]);
  } catch (err: unknown) {
    engine.dispose();
    throw err;
  }
  return engine;
}
