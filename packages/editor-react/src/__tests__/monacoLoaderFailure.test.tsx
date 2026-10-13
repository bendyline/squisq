/**
 * Guards the lazy Monaco loader's failure path.
 *
 * `useMonacoLoader` starts its import from an effect and nothing awaits the
 * result, so a rejection there escapes as an unhandled rejection in the host
 * page — and in CI it fails an otherwise-green vitest run when a jsdom
 * environment is torn down while the import is still in flight. The failure is
 * invisible in a passing run, which is exactly why it needs a test.
 */

import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadState = vi.hoisted(() => ({
  attempts: 0,
  deferSuggestions: false,
  finishSuggestions: null as (() => void) | null,
}));

vi.mock('@monaco-editor/react', () => ({
  loader: { config: () => undefined },
}));

beforeEach(() => {
  // The loader caches its promise in module scope; each test needs its own.
  vi.resetModules();
  loadState.attempts = 0;
  loadState.deferSuggestions = false;
  loadState.finishSuggestions = null;
  vi.doMock('../monaco.js', () => {
    loadState.attempts += 1;
    // Fail only the first attempt, so the same mock covers both the rejection
    // and the retry that a reset cache is supposed to make possible.
    if (loadState.attempts === 1) throw new Error('simulated chunk load failure');
    return {
      loadMonacoLanguages: () => Promise.resolve(),
      loadMonacoSuggestions: () =>
        loadState.deferSuggestions
          ? new Promise<void>((resolve) => {
              loadState.finishSuggestions = resolve;
            })
          : Promise.resolve(),
    };
  });
});

async function withUnhandledRejectionSpy(run: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const onUnhandled = (reason: unknown): void => {
    seen.push(reason instanceof Error ? reason.message : String(reason));
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    await run();
    // Give Node a turn to decide a pending rejection is unhandled.
    await new Promise((resolve) => setTimeout(resolve, 50));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  return seen;
}

describe('Monaco loader failure handling', () => {
  it('leaves a mounted consumer un-ready without an unhandled rejection', async () => {
    const { useMonacoLoader } = await import('../useMonacoLoader');

    function Probe(): JSX.Element {
      const { ready } = useMonacoLoader('typescript');
      return <span data-testid="ready">{String(ready)}</span>;
    }

    const unhandled = await withUnhandledRejectionSpy(async () => {
      const { getByTestId } = render(<Probe />);
      await waitFor(() => expect(loadState.attempts).toBe(1));
      expect(getByTestId('ready').textContent).toBe('false');
    });

    expect(unhandled).toEqual([]);
  });

  it('does not expose a ready profile until completion controllers are registered', async () => {
    loadState.attempts = 1;
    loadState.deferSuggestions = true;
    const { preloadMonaco } = await import('../useMonacoLoader');
    let ready = false;
    const loading = preloadMonaco('markdown').then(() => {
      ready = true;
    });
    await waitFor(() => expect(loadState.finishSuggestions).not.toBeNull());
    expect(ready).toBe(false);
    loadState.finishSuggestions!();
    await loading;
    expect(ready).toBe(true);
  });

  it('clears the cached promise so a later subscriber retries', async () => {
    const { preloadMonaco } = await import('../useMonacoLoader');

    // Vitest re-wraps a throwing mock factory, so assert that it rejects
    // rather than matching the simulated message.
    await expect(preloadMonaco('typescript')).rejects.toThrow();
    // A cached rejected promise would resolve this second call from the first
    // attempt and never re-import.
    await expect(preloadMonaco('typescript')).resolves.toBeDefined();
    expect(loadState.attempts).toBe(2);
  });
});
