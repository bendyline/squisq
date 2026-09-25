/**
 * React bindings for a {@link MediaEditRenderManager}.
 *
 * - {@link useProcessedAudio} re-renders only when the set of available
 *   renders changes, so a `DocPlayer` or schedule memoized on it switches an
 *   edited clip over the moment its render lands — and never churns on
 *   progress ticks.
 * - {@link useMediaEditStatus} tracks every change, for progress displays.
 * - {@link useMediaEditRenders} combines both and, given the document, keeps
 *   the manager synced — the one-call binding for hosts.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Doc, MediaClip } from '@bendyline/squisq/schemas';
import type { MediaEditRenderManager, MediaEditRenderStatus } from './mediaEditRenderManager.js';

export interface MediaEditRendersView {
  processedAudio: (clip: MediaClip) => string | undefined;
  status: (clip: MediaClip) => MediaEditRenderStatus | null;
}

const noSubscribe = () => () => {};
const zero = () => 0;

/** The processed-audio lookup; a new identity only when renders appear or vanish. */
export function useProcessedAudio(
  manager: MediaEditRenderManager | null | undefined,
): (clip: MediaClip) => string | undefined {
  const indexVersion = useSyncExternalStore(
    manager ? manager.subscribe : noSubscribe,
    manager ? manager.getIndexVersion : zero,
    zero,
  );
  // The version is the change signal: a new identity means "renders changed".
  return useCallback((clip: MediaClip) => manager?.processedAudio(clip), [manager, indexVersion]);
}

/** Render status per clip; updates with progress. */
export function useMediaEditStatus(
  manager: MediaEditRenderManager | null | undefined,
): (clip: MediaClip) => MediaEditRenderStatus | null {
  const version = useSyncExternalStore(
    manager ? manager.subscribe : noSubscribe,
    manager ? manager.getVersion : zero,
    zero,
  );
  return useCallback((clip: MediaClip) => manager?.status(clip) ?? null, [manager, version]);
}

/** Both views; with `doc`, also keeps the manager synced to it. */
export function useMediaEditRenders(
  manager: MediaEditRenderManager | null | undefined,
  doc?: Doc | null,
): MediaEditRendersView {
  useEffect(() => {
    if (manager && doc) manager.sync(doc);
  }, [manager, doc]);
  return { processedAudio: useProcessedAudio(manager), status: useMediaEditStatus(manager) };
}
