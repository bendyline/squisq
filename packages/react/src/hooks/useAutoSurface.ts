import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { DARK_SURFACE, LIGHT_SURFACE, type SurfaceScheme } from '@bendyline/squisq/schemas';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const getServerSnapshot = () => LIGHT_SURFACE;

/**
 * Live-track `prefers-color-scheme` and return a stable SurfaceScheme.
 * `enabled: false` short-circuits to LIGHT_SURFACE (callers pass `false`
 * when a static surface was provided so the hook never observes the
 * media query). The `MediaQueryList` and the `subscribe`/`getSnapshot`
 * callbacks are memoized so `useSyncExternalStore` doesn't resubscribe on
 * every parent render.
 */
export function useAutoSurface(enabled: boolean): SurfaceScheme {
  const mql = useMemo(
    () => (enabled && typeof window !== 'undefined' ? window.matchMedia(DARK_QUERY) : null),
    [enabled],
  );

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!mql) return () => {};
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    [mql],
  );

  const getSnapshot = useCallback(() => (mql?.matches ? DARK_SURFACE : LIGHT_SURFACE), [mql]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
