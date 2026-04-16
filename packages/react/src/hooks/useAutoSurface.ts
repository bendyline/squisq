import { useSyncExternalStore } from 'react';
import {
  DARK_SURFACE,
  LIGHT_SURFACE,
  type SurfaceScheme,
} from '@bendyline/squisq/schemas';

/**
 * Live-track `prefers-color-scheme` and return a stable SurfaceScheme.
 * `enabled: false` short-circuits to LIGHT_SURFACE (callers pass `false`
 * when a static surface was provided so the hook never observes the
 * media query).
 */
export function useAutoSurface(enabled: boolean): SurfaceScheme {
  const subscribe = (cb: () => void) => {
    if (!enabled || typeof window === 'undefined') return () => {};
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    mql.addEventListener('change', cb);
    return () => mql.removeEventListener('change', cb);
  };
  const getSnapshot = () => {
    if (!enabled || typeof window === 'undefined') return LIGHT_SURFACE;
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? DARK_SURFACE
      : LIGHT_SURFACE;
  };
  return useSyncExternalStore(subscribe, getSnapshot, () => LIGHT_SURFACE);
}
