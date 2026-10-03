/**
 * TableStoreClient — the in-house columnar store behind the
 * `TableQueryProvider` contract. Compute (filter/sort/window/edit) runs in
 * the kernel; the kernel runs in a Blob-URL Web Worker when available and
 * falls back to an in-process host otherwise (SSR, tests — the fallback is
 * also the protocol-parity proof, since both paths execute the SAME
 * `tableKernel` source).
 *
 * Transfer note: typed-array halves of the columns are TRANSFERRED to the
 * worker (zero-copy); dictionaries are structured-cloned. After `init` the
 * client's own column buffers are detached — the client keeps only the
 * schema; the ingest source stays with the adapter (it owns save).
 */

import type {
  TableCellEdit,
  TableDistinctResult,
  TableEditResult,
  TableQueryProvider,
  TableRowsPage,
  TableSchema,
  TableViewResult,
  TableViewState,
} from '@bendyline/squisq/table';
import { parseTableViewState, serializeTableViewState } from '@bendyline/squisq/table';
import { buildColumnarTable, type IngestTable, type StoreColumn } from './columns.js';
import {
  buildKernelSource,
  tableKernel,
  type KernelColumnPayload,
  type KernelRequest,
  type KernelResponse,
  type KernelScope,
} from './kernel.js';

interface KernelHost {
  post(message: KernelRequest, transfer?: Transferable[]): void;
  onResponse: (message: KernelResponse) => void;
  onFailure: (error: Error) => void;
  terminate(): void;
}

/** In-process host: drives `tableKernel` directly (SSR/tests/parity). */
export class LocalKernelHost implements KernelHost {
  onFailure: (error: Error) => void = () => {};
  onResponse: (message: KernelResponse) => void = () => {};
  private readonly scope: KernelScope;

  constructor() {
    const scope: KernelScope = {
      onmessage: null,
      postMessage: (message) => this.onResponse(message),
    };
    tableKernel(scope);
    this.scope = scope;
  }

  post(message: KernelRequest): void {
    this.scope.onmessage?.({ data: message });
  }

  terminate(): void {
    this.scope.onmessage = null;
  }
}

class BlobWorkerHost implements KernelHost {
  onFailure: (error: Error) => void = () => {};
  onResponse: (message: KernelResponse) => void = () => {};
  private readonly worker: Worker;

  constructor() {
    const url = URL.createObjectURL(new Blob([buildKernelSource()], { type: 'text/javascript' }));
    try {
      this.worker = new Worker(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    this.worker.onmessage = (event: MessageEvent<KernelResponse>) => {
      this.onResponse(event.data);
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.onFailure(new Error(event.message || 'Table worker failed'));
    };
    this.worker.onmessageerror = () =>
      this.onFailure(new Error('Table worker response could not be decoded'));
  }

  post(message: KernelRequest, transfer?: Transferable[]): void {
    this.worker.postMessage(message, transfer ?? []);
  }

  terminate(): void {
    this.worker.terminate();
  }
}

function toPayload(column: StoreColumn): {
  payload: KernelColumnPayload;
  transfer: Transferable[];
} {
  if (column.kind === 'number' || column.kind === 'boolean') {
    return {
      payload: { name: column.name, kind: column.kind, data: column.data, valid: column.valid },
      transfer: [column.data.buffer, column.valid.buffer],
    };
  }
  return {
    payload: { name: column.name, kind: column.kind, data: column.codes, dict: column.dict },
    transfer: [column.codes.buffer],
  };
}

export interface TableStoreClientOptions {
  /** Force the in-process host (tests, SSR probes). */
  forceLocal?: boolean;
  /** Maximum wait for a worker response; default 30 seconds. */
  requestTimeoutMs?: number;
}

export class TableStoreClient implements TableQueryProvider {
  private readonly host: KernelHost;
  private readonly schema: TableSchema;
  private seq = 0;
  private viewRowCount: number;
  private readonly pending = new Map<
    number,
    {
      respond: (message: KernelResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private failure: Error | null = null;
  private readonly requestTimeoutMs: number;
  private ready: Promise<void>;

  constructor(table: IngestTable, options: TableStoreClientOptions = {}) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    const columnar = buildColumnarTable(table);
    this.schema = {
      columns: columnar.columns.map((column) => ({ name: column.name, kind: column.kind })),
      rowCount: columnar.rowCount,
    };
    this.viewRowCount = columnar.rowCount;

    this.host =
      options.forceLocal || typeof Worker === 'undefined'
        ? new LocalKernelHost()
        : new BlobWorkerHost();
    this.host.onResponse = (message) => {
      const waiter = this.pending.get(message.seq);
      if (waiter) {
        this.pending.delete(message.seq);
        clearTimeout(waiter.timer);
        waiter.respond(message);
      }
    };
    this.host.onFailure = (error) => this.fail(error);

    const payloads = columnar.columns.map(toPayload);
    this.ready = this.request(
      (seq) => ({
        type: 'init',
        seq,
        columns: payloads.map((entry) => entry.payload),
        rowCount: columnar.rowCount,
      }),
      payloads.flatMap((entry) => entry.transfer),
    ).then(() => undefined);
    // Construction may fail before a consumer starts awaiting describe().
    void this.ready.catch(() => undefined);
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
    this.host.terminate();
  }

  private request(
    build: (seq: number) => KernelRequest,
    transfer?: Transferable[],
  ): Promise<KernelResponse> {
    if (this.failure) return Promise.reject(this.failure);
    const seq = ++this.seq;
    return new Promise<KernelResponse>((resolve, reject) => {
      this.pending.set(seq, {
        respond: (message) => {
          if (message.type === 'error') reject(new Error(message.message));
          else resolve(message);
        },
        reject,
        timer: setTimeout(
          () => this.fail(new Error('Table worker request timed out')),
          this.requestTimeoutMs,
        ),
      });
      try {
        this.host.post(build(seq), transfer);
      } catch (error: unknown) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async describe(): Promise<TableSchema> {
    await this.ready;
    if (this.failure) throw this.failure;
    return this.schema;
  }

  async setView(view: TableViewState): Promise<TableViewResult> {
    await this.ready;
    // Column names resolve against the schema; parseTableViewState owns the
    // issue reporting, so re-serialize + re-parse keeps ONE code path for
    // name resolution and unknown-column handling.
    const raw = serializeTableViewState(view);
    const headers = this.schema.columns.map((column) => column.name);
    const { view: resolved, issues } = parseTableViewState(raw.sort, raw.filter, headers);
    const columnIndex = new Map(headers.map((name, index) => [name, index] as const));

    const response = await this.request((seq) => ({
      type: 'setView',
      seq,
      sort: resolved.sort.map((term) => ({
        col: columnIndex.get(term.column)!,
        dir: term.dir,
      })),
      filter: resolved.filter.map((clause) => ({
        col: columnIndex.get(clause.column)!,
        op: clause.op,
        value: clause.value,
        ...(clause.caseSensitive ? { caseSensitive: true } : {}),
      })),
    }));
    if (response.type !== 'viewResult') throw new Error('unexpected kernel response');
    this.viewRowCount = response.viewRowCount;
    return { viewRowCount: response.viewRowCount, issues };
  }

  async rows(start: number, count: number): Promise<TableRowsPage> {
    await this.ready;
    const response = await this.request((seq) => ({ type: 'rows', seq, start, count }));
    if (response.type !== 'rowsResult') throw new Error('unexpected kernel response');
    return { start: response.start, rowIds: response.rowIds, cells: response.cells };
  }

  async applyEdits(edits: TableCellEdit[]): Promise<TableEditResult> {
    await this.ready;
    const response = await this.request((seq) => ({
      type: 'applyEdits',
      seq,
      edits: edits.map((edit) => ({ rowId: edit.rowId, col: edit.col, value: edit.value })),
    }));
    if (response.type !== 'editResult') throw new Error('unexpected kernel response');
    return { staleView: response.staleView };
  }

  async distinct(col: number, limit: number): Promise<TableDistinctResult> {
    await this.ready;
    const response = await this.request((seq) => ({ type: 'distinct', seq, col, limit }));
    if (response.type !== 'distinctResult') throw new Error('unexpected kernel response');
    return {
      values: response.values,
      totalDistinct: response.totalDistinct,
      hasBlank: response.hasBlank,
    };
  }

  /** Row count under the current view (post-filter). */
  get currentViewRowCount(): number {
    return this.viewRowCount;
  }

  dispose(): void {
    if (this.failure) return;
    try {
      this.host.post({ type: 'dispose' });
    } finally {
      this.fail(new Error('Table store disposed'));
    }
  }
}
