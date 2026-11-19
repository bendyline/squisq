import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { holdScreenWakeLock, useScreenWakeLock } from '../hooks/useScreenWakeLock';

type FakeSentinel = EventTarget & { release: ReturnType<typeof vi.fn> };

let visibility: DocumentVisibilityState = 'visible';

function setVisibility(state: DocumentVisibilityState): void {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

function installWakeLock(): { request: ReturnType<typeof vi.fn>; sentinels: FakeSentinel[] } {
  const sentinels: FakeSentinel[] = [];
  const request = vi.fn(async () => {
    const sentinel = new EventTarget() as FakeSentinel;
    sentinel.release = vi.fn(async () => {
      sentinel.dispatchEvent(new Event('release'));
    });
    sentinels.push(sentinel);
    return sentinel;
  });
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
  return { request, sentinels };
}

describe('useScreenWakeLock', () => {
  beforeEach(() => {
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
  });
  afterEach(() => {
    delete (document as { visibilityState?: unknown }).visibilityState;
    delete (navigator as { wakeLock?: unknown }).wakeLock;
  });

  it('holds the screen on only while active', async () => {
    const { request, sentinels } = installWakeLock();
    const { rerender, unmount } = renderHook(({ active }) => useScreenWakeLock(active), {
      initialProps: { active: false },
    });
    expect(request).not.toHaveBeenCalled();

    rerender({ active: true });
    await waitFor(() => expect(sentinels).toHaveLength(1));
    expect(request).toHaveBeenCalledWith('screen');

    rerender({ active: false });
    expect(sentinels[0].release).toHaveBeenCalledOnce();

    rerender({ active: true });
    await waitFor(() => expect(sentinels).toHaveLength(2));
    unmount();
    expect(sentinels[1].release).toHaveBeenCalledOnce();
  });

  it('takes the lock again when the page returns', async () => {
    const { sentinels } = installWakeLock();
    const release = holdScreenWakeLock(document);
    await waitFor(() => expect(sentinels).toHaveLength(1));

    // The platform drops the lock whenever the page is hidden.
    setVisibility('hidden');
    sentinels[0].dispatchEvent(new Event('release'));
    setVisibility('visible');
    await waitFor(() => expect(sentinels).toHaveLength(2));
    release();
  });

  it('does nothing where the Screen Wake Lock API is missing', () => {
    const { unmount } = renderHook(() => useScreenWakeLock(true));
    expect(() => unmount()).not.toThrow();
  });
});
