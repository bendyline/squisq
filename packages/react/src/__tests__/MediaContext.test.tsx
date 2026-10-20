import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { MediaContext, useMediaUrl } from '../hooks/MediaContext';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Probe({ path }: { path: string }) {
  return <span data-testid="url">{useMediaUrl(path, '.')}</span>;
}

describe('useMediaUrl', () => {
  it('clears a stale URL and consumes provider rejection', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const resolveUrl = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const provider = { resolveUrl } as unknown as MediaProvider;
    const { rerender } = render(
      <MediaContext.Provider value={provider}>
        <Probe path="first.png" />
      </MediaContext.Provider>,
    );
    expect(screen.getByTestId('url').textContent).toBe('');

    rerender(
      <MediaContext.Provider value={provider}>
        <Probe path="second.png" />
      </MediaContext.Provider>,
    );
    expect(screen.getByTestId('url').textContent).toBe('');

    await act(async () => {
      first.resolve('blob:first');
      await first.promise;
      second.reject(new Error('missing'));
      await second.promise.catch(() => undefined);
    });
    expect(screen.getByTestId('url').textContent).toBe('');
  });

  it.each(['missing', 'rejected'])(
    'keeps a %s workspace lookup unresolved instead of using the page origin',
    async (kind) => {
      const lookup = deferred<string>();
      const provider = { resolveUrl: vi.fn(() => lookup.promise) } as unknown as MediaProvider;
      render(
        <MediaContext.Provider value={provider}>
          <Probe path="missing.png" />
        </MediaContext.Provider>,
      );
      expect(screen.getByTestId('url').textContent).toBe('');

      await act(async () => {
        if (kind === 'rejected') lookup.reject(new Error('unreadable'));
        else lookup.resolve('missing.png');
        await lookup.promise.catch(() => undefined);
      });
      expect(screen.getByTestId('url').textContent).toBe('');
    },
  );

  it('uses the base path when there is no workspace provider', () => {
    render(<Probe path="public.png" />);
    expect(screen.getByTestId('url').textContent).toBe('./public.png');
  });

  it('uses the workspace URL once resolution succeeds', async () => {
    const lookup = deferred<string>();
    const provider = { resolveUrl: vi.fn(() => lookup.promise) } as unknown as MediaProvider;
    render(
      <MediaContext.Provider value={provider}>
        <Probe path="photo.png" />
      </MediaContext.Provider>,
    );
    expect(screen.getByTestId('url').textContent).toBe('');

    await act(async () => {
      lookup.resolve('blob:workspace-photo');
      await lookup.promise;
    });
    expect(screen.getByTestId('url').textContent).toBe('blob:workspace-photo');
  });
});
