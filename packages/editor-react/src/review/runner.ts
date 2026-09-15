/**
 * Multi-provider review orchestration, without React.
 *
 * Framework-free on purpose: the interesting behaviour here is scheduling —
 * when a pass starts, what cancels it, and which results are still worth
 * showing — and all of it is far easier to pin down against a fake clock than
 * through a rendered component.
 *
 * The scheduling contract mirrors proofing's, with one difference that is the
 * whole point of review: **each provider is scheduled independently**. A
 * spellchecker re-running 450 ms after a keystroke and a model that takes
 * seconds cannot share a cadence, and a single shared timer would have to be
 * wrong for one of them.
 *
 * Per provider: one debounced single-flight pass at a time, a dirty flag
 * coalescing anything arriving mid-pass into exactly one trailing pass, and
 * results discarded when the document moved under them.
 */

import type { ReviewFinding, ReviewRequest } from '@bendyline/squisq/review';
import { DEFAULT_REVIEW_DEBOUNCE_MS, type ReviewProvider } from './types.js';

export type ReviewProviderPhase = 'idle' | 'preparing' | 'running' | 'ready' | 'error';

export interface ReviewProviderStatus {
  id: string;
  label: string;
  phase: ReviewProviderPhase;
  /** Findings from this provider's most recent completed pass. */
  findings: readonly ReviewFinding[];
  /** Set when the provider's last pass failed. */
  error: string | null;
}

export interface ReviewSnapshot {
  /** Every provider's findings, in provider order then document order. */
  findings: readonly ReviewFinding[];
  providers: readonly ReviewProviderStatus[];
  /** True while any provider has a pass in flight. */
  running: boolean;
}

/** What the runner needs to build a request. Called fresh for every pass. */
export type ReviewRequestSource = () => ReviewRequest | null;

export interface ReviewRunnerOptions {
  providers: readonly ReviewProvider[];
  /** Builds the request for a pass, and reports the document revision. */
  buildRequest: ReviewRequestSource;
  /**
   * Monotonic document revision. A pass whose revision no longer matches at
   * completion is discarded: its findings are about text that has since
   * changed, and drawing them would put a mark on an unrelated word.
   */
  revision: () => number;
  onChange: (snapshot: ReviewSnapshot) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface ProviderRuntime {
  provider: ReviewProvider;
  status: ReviewProviderStatus;
  timer: unknown;
  controller: AbortController | null;
  /** A change arrived while a pass was in flight; run exactly one more. */
  dirty: boolean;
  setupDone: boolean;
}

export class ReviewRunner {
  private readonly runtimes: ProviderRuntime[];
  private readonly options: ReviewRunnerOptions;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private disposed = false;

  constructor(options: ReviewRunnerOptions) {
    this.options = options;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as never));
    this.runtimes = options.providers.map((provider) => ({
      provider,
      status: {
        id: provider.id,
        label: provider.label,
        phase: 'idle',
        findings: [],
        error: null,
      },
      timer: null,
      controller: null,
      dirty: false,
      setupDone: false,
    }));
  }

  /** The document changed. Reschedule every provider. */
  schedule(): void {
    if (this.disposed) return;
    for (const runtime of this.runtimes) this.scheduleOne(runtime);
  }

  /** Run now, skipping the debounce — the user asked for a review. */
  runNow(): void {
    if (this.disposed) return;
    for (const runtime of this.runtimes) {
      if (runtime.timer !== null) {
        this.clearTimer(runtime.timer);
        runtime.timer = null;
      }
      void this.runPass(runtime);
    }
  }

  snapshot(): ReviewSnapshot {
    const providers = this.runtimes.map((runtime) => runtime.status);
    return {
      findings: providers.flatMap((status) => status.findings),
      providers,
      running: providers.some(
        (status) => status.phase === 'running' || status.phase === 'preparing',
      ),
    };
  }

  /** Drop a finding from the visible set without re-running anything. */
  removeFinding(findingId: string): void {
    for (const runtime of this.runtimes) {
      const next = runtime.status.findings.filter((finding) => finding.id !== findingId);
      if (next.length !== runtime.status.findings.length) {
        runtime.status = { ...runtime.status, findings: next };
        this.emit();
        return;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const runtime of this.runtimes) {
      if (runtime.timer !== null) this.clearTimer(runtime.timer);
      runtime.timer = null;
      runtime.controller?.abort();
      runtime.controller = null;
      runtime.provider.dispose?.();
    }
  }

  private scheduleOne(runtime: ProviderRuntime): void {
    // A pass is already running: mark it and let the trailing pass pick the
    // change up, rather than queueing one timer per keystroke.
    if (runtime.controller) {
      runtime.dirty = true;
      return;
    }
    if (runtime.timer !== null) this.clearTimer(runtime.timer);
    const delay = runtime.provider.debounceMs ?? DEFAULT_REVIEW_DEBOUNCE_MS;
    runtime.timer = this.setTimer(() => {
      runtime.timer = null;
      void this.runPass(runtime);
    }, delay);
  }

  private async runPass(runtime: ProviderRuntime): Promise<void> {
    if (this.disposed || runtime.controller) return;
    const request = this.options.buildRequest();
    if (!request) return;

    const startedAt = this.options.revision();
    const controller = new AbortController();
    runtime.controller = controller;
    runtime.dirty = false;

    if (!runtime.setupDone && runtime.provider.setup) {
      this.setPhase(runtime, 'preparing');
      try {
        await runtime.provider.setup();
        runtime.setupDone = true;
      } catch (error) {
        // One provider failing to load is not a broken editor. Report it and
        // leave the others running.
        runtime.controller = null;
        this.fail(runtime, error);
        return;
      }
      if (this.disposed) {
        runtime.controller = null;
        return;
      }
    }

    this.setPhase(runtime, 'running');
    const collected: ReviewFinding[] = [];
    let failure: string | null = null;

    try {
      for await (const event of runtime.provider.review(request, controller.signal)) {
        if (controller.signal.aborted || this.disposed) break;
        if (event.type === 'findings') collected.push(...event.findings);
        else if (event.type === 'error') failure = event.message;
      }
    } catch (error) {
      if (!controller.signal.aborted) failure = messageOf(error);
    }

    runtime.controller = null;
    if (this.disposed) return;

    // The document moved while the provider worked. These findings describe
    // text that no longer exists, so they are dropped rather than drawn.
    const stale = this.options.revision() !== startedAt;
    if (!controller.signal.aborted && !stale) {
      runtime.status = failure
        ? { ...runtime.status, phase: 'error', error: failure }
        : { ...runtime.status, phase: 'ready', error: null, findings: collected };
      this.emit();
    }

    if (runtime.dirty || stale) {
      runtime.dirty = false;
      this.scheduleOne(runtime);
    }
  }

  private setPhase(runtime: ProviderRuntime, phase: ReviewProviderPhase): void {
    runtime.status = { ...runtime.status, phase };
    this.emit();
  }

  private fail(runtime: ProviderRuntime, error: unknown): void {
    runtime.status = { ...runtime.status, phase: 'error', error: messageOf(error) };
    this.emit();
  }

  private emit(): void {
    if (!this.disposed) this.options.onChange(this.snapshot());
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
