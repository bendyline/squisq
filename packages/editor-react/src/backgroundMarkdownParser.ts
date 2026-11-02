import { isMarkdownParseResult, type MarkdownParseResult } from './markdownParseProtocol';

interface ParseJob {
  id: number;
  source: string;
  done: (result: MarkdownParseResult | null) => void;
}

/** One active parse and one replaceable pending parse; obsolete results never publish. */
export class BackgroundMarkdownParser {
  private worker: Worker | null = null;
  private active: ParseJob | null = null;
  private pending: ParseJob | null = null;
  private serial = 0;
  private failed = false;
  private disposed = false;
  private timeout: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly createWorker: () => Worker = () =>
      new Worker(new URL('./document-parse-worker/index.js', import.meta.url), {
        type: 'module',
        name: 'squisq-markdown-parser',
      }),
  ) {}

  parse(source: string, done: ParseJob['done']): void {
    if (this.disposed) return;
    this.pending = { id: ++this.serial, source, done };
    this.drain();
  }

  cancel(): void {
    this.serial++;
    this.pending = null;
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.stopWorker();
  }

  private stopWorker(): void {
    clearTimeout(this.timeout);
    this.worker?.terminate();
    this.worker = null;
    this.active = null;
  }

  private fail(): void {
    const latest = this.pending ?? this.active;
    this.failed = true;
    this.pending = null;
    this.stopWorker();
    // null asks the caller to use the existing synchronous parser. A failed
    // worker is not repeatedly restarted, including under CSP restrictions.
    if (!this.disposed && latest?.id === this.serial) latest.done(null);
  }

  private drain(): void {
    if (this.disposed || this.active || !this.pending) return;
    const job = this.pending;
    this.pending = null;
    if (this.failed) {
      job.done(null);
      return;
    }
    this.active = job;
    try {
      if (!this.worker) {
        this.worker = this.createWorker();
        this.worker.onmessage = ({ data }: MessageEvent<unknown>) => {
          if (this.disposed || !this.active) return;
          if (!isMarkdownParseResult(data) || data.id !== this.active.id) {
            this.fail();
            return;
          }
          const completed = this.active;
          clearTimeout(this.timeout);
          this.active = null;
          if (completed.id === this.serial) completed.done(data);
          this.drain();
        };
        this.worker.onerror = () => this.fail();
        this.worker.onmessageerror = () => this.fail();
      }
      this.timeout = setTimeout(() => this.fail(), 30_000);
      this.worker.postMessage({ id: job.id, source: job.source });
    } catch {
      this.fail();
    }
  }
}
