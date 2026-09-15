import { describe, expect, it, vi } from 'vitest';
import type { ReviewEvent, ReviewFinding, ReviewRequest } from '@bendyline/squisq/review';
import { ReviewRunner, type ReviewSnapshot } from '../runner.js';
import type { ReviewProvider } from '../types.js';

function finding(id: string, source: string): ReviewFinding {
  return {
    id,
    source,
    start: 0,
    end: 4,
    severity: 'suggestion',
    category: 'clarity',
    message: id,
    originalText: 'text',
    suggestions: [],
  };
}

const REQUEST: ReviewRequest = {
  source: 'text',
  documentRef: { articleId: 'a' },
  blocks: [{ key: 1, startLine: 1, heading: null, text: 'text', offset: 0 }],
};

/** A provider whose pass resolves only when the test says so. */
function controllableProvider(
  id: string,
  debounceMs: number,
): ReviewProvider & { release: (findings: ReviewFinding[]) => void; passes: number } {
  let resolve: ((findings: ReviewFinding[]) => void) | null = null;
  const provider = {
    id,
    label: id,
    debounceMs,
    passes: 0,
    release(findings: ReviewFinding[]) {
      resolve?.(findings);
      resolve = null;
    },
    async *review(_request: ReviewRequest, signal: AbortSignal): AsyncIterable<ReviewEvent> {
      provider.passes += 1;
      const findings = await new Promise<ReviewFinding[]>((r) => {
        resolve = r;
      });
      if (signal.aborted) return;
      yield { type: 'findings', findings };
      yield { type: 'done' };
    },
  };
  return provider;
}

function harness(providers: ReviewProvider[], revision = { value: 0 }) {
  const snapshots: ReviewSnapshot[] = [];
  const runner = new ReviewRunner({
    providers,
    buildRequest: () => REQUEST,
    revision: () => revision.value,
    onChange: (snapshot) => snapshots.push(snapshot),
  });
  return { runner, snapshots, revision };
}

describe('ReviewRunner scheduling', () => {
  it('gives each provider its own cadence', async () => {
    // The reason review is not one shared timer: a spellchecker and a model
    // cannot agree on how long to wait.
    vi.useFakeTimers();
    const fast = controllableProvider('fast', 450);
    const slow = controllableProvider('slow', 12_000);
    const { runner } = harness([fast, slow]);

    runner.schedule();
    await vi.advanceTimersByTimeAsync(500);
    expect(fast.passes).toBe(1);
    expect(slow.passes).toBe(0);

    await vi.advanceTimersByTimeAsync(12_000);
    expect(slow.passes).toBe(1);

    runner.dispose();
    vi.useRealTimers();
  });

  it('coalesces a storm of keystrokes into one pass', async () => {
    vi.useFakeTimers();
    const provider = controllableProvider('p', 450);
    const { runner } = harness([provider]);

    for (let i = 0; i < 10; i += 1) {
      runner.schedule();
      await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(500);
    expect(provider.passes).toBe(1);

    runner.dispose();
    vi.useRealTimers();
  });

  it('runs exactly one trailing pass for changes that arrive mid-flight', async () => {
    vi.useFakeTimers();
    const provider = controllableProvider('p', 450);
    const { runner } = harness([provider]);

    runner.schedule();
    await vi.advanceTimersByTimeAsync(500);
    expect(provider.passes).toBe(1);

    // Three changes while the pass is in flight should not queue three passes.
    runner.schedule();
    runner.schedule();
    runner.schedule();
    provider.release([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(provider.passes).toBe(2);

    runner.dispose();
    vi.useRealTimers();
  });

  it('discards a pass whose document moved, and reruns', async () => {
    vi.useFakeTimers();
    const provider = controllableProvider('p', 450);
    const { runner, revision } = harness([provider]);

    runner.schedule();
    await vi.advanceTimersByTimeAsync(500);
    revision.value = 1;
    provider.release([finding('f1', 'p')]);
    await vi.advanceTimersByTimeAsync(0);

    // The findings describe text that has since changed.
    expect(runner.snapshot().findings).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(provider.passes).toBe(2);

    runner.dispose();
    vi.useRealTimers();
  });

  it('keeps findings from a pass the document did not disturb', async () => {
    vi.useFakeTimers();
    const provider = controllableProvider('p', 450);
    const { runner } = harness([provider]);

    runner.schedule();
    await vi.advanceTimersByTimeAsync(500);
    provider.release([finding('f1', 'p')]);
    await vi.advanceTimersByTimeAsync(0);

    expect(runner.snapshot().findings.map((f) => f.id)).toEqual(['f1']);
    expect(runner.snapshot().running).toBe(false);

    runner.dispose();
    vi.useRealTimers();
  });

  it('aggregates providers without letting one failure hide the others', async () => {
    vi.useFakeTimers();
    const good = controllableProvider('good', 450);
    const bad: ReviewProvider = {
      id: 'bad',
      label: 'bad',
      debounceMs: 450,
      // eslint-disable-next-line require-yield
      async *review() {
        throw new Error('engine exploded');
      },
    };
    const { runner } = harness([good, bad]);

    runner.schedule();
    await vi.advanceTimersByTimeAsync(500);
    good.release([finding('f1', 'good')]);
    await vi.advanceTimersByTimeAsync(0);

    const snapshot = runner.snapshot();
    expect(snapshot.findings.map((f) => f.id)).toEqual(['f1']);
    expect(snapshot.providers.find((p) => p.id === 'bad')).toMatchObject({
      phase: 'error',
      error: 'engine exploded',
    });

    runner.dispose();
    vi.useRealTimers();
  });

  it('reports a provider that cannot load, and never asks it to review', async () => {
    vi.useFakeTimers();
    const review = vi.fn();
    const provider: ReviewProvider = {
      id: 'p',
      label: 'p',
      debounceMs: 450,
      setup: async () => {
        throw new Error('wasm missing');
      },
      review: review as unknown as ReviewProvider['review'],
    };
    const { runner } = harness([provider]);

    runner.schedule();
    await vi.advanceTimersByTimeAsync(500);

    expect(review).not.toHaveBeenCalled();
    expect(runner.snapshot().providers[0]).toMatchObject({ phase: 'error', error: 'wasm missing' });

    runner.dispose();
    vi.useRealTimers();
  });

  it('skips the debounce when the user asks for a review now', async () => {
    vi.useFakeTimers();
    const provider = controllableProvider('p', 12_000);
    const { runner } = harness([provider]);

    runner.runNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(provider.passes).toBe(1);

    runner.dispose();
    vi.useRealTimers();
  });

  it('aborts an in-flight pass on dispose rather than leaving it running', async () => {
    vi.useFakeTimers();
    const provider = controllableProvider('p', 450);
    const { runner, snapshots } = harness([provider]);

    runner.schedule();
    await vi.advanceTimersByTimeAsync(500);
    const before = snapshots.length;
    runner.dispose();
    provider.release([finding('late', 'p')]);
    await vi.advanceTimersByTimeAsync(0);

    // Nothing emitted after dispose: a disposed runner must not write into a
    // component that has unmounted.
    expect(snapshots.length).toBe(before);

    vi.useRealTimers();
  });

  it('drops a dismissed finding without re-running the provider', async () => {
    vi.useFakeTimers();
    const provider = controllableProvider('p', 450);
    const { runner } = harness([provider]);

    runner.schedule();
    await vi.advanceTimersByTimeAsync(500);
    provider.release([finding('f1', 'p'), finding('f2', 'p')]);
    await vi.advanceTimersByTimeAsync(0);

    runner.removeFinding('f1');
    expect(runner.snapshot().findings.map((f) => f.id)).toEqual(['f2']);
    expect(provider.passes).toBe(1);

    runner.dispose();
    vi.useRealTimers();
  });
});
