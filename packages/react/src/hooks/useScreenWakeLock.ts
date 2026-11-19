/**
 * Keep the screen on while a document plays.
 *
 * Nobody touches the screen while watching, so auto-lock would darken it
 * partway through. On a phone the app then leaves the foreground and playback
 * stops. Video players hold a screen wake lock while they play, and so does
 * DocPlayer.
 *
 * Uses the standard Screen Wake Lock API. Best effort: where it is missing or
 * denied, playback runs as before. The platform drops the lock whenever the
 * page is hidden, so it is requested again each time the page is visible.
 * (Video export holds its own lock the same way, in squisq-video-react.)
 */

import { useEffect } from 'react';

/** Hold a screen wake lock until the returned function is called. */
export function holdScreenWakeLock(doc: Document | undefined = globalThis.document): () => void {
  const wakeLock =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as Partial<Pick<Navigator, 'wakeLock'>>).wakeLock;
  if (!doc || !wakeLock) return () => {};
  let released = false;
  let requesting = false;
  let sentinel: WakeLockSentinel | null = null;

  const request = (): void => {
    if (released || requesting || sentinel || doc.visibilityState !== 'visible') return;
    requesting = true;
    wakeLock.request('screen').then(
      (lock) => {
        requesting = false;
        if (released) {
          void lock.release().catch(() => {});
          return;
        }
        sentinel = lock;
        lock.addEventListener('release', () => {
          if (sentinel === lock) sentinel = null;
        });
      },
      () => {
        // Denied or unsupported here; playback does not depend on it.
        requesting = false;
      },
    );
  };
  doc.addEventListener('visibilitychange', request);
  request();

  return () => {
    if (released) return;
    released = true;
    doc.removeEventListener('visibilitychange', request);
    const lock = sentinel;
    sentinel = null;
    if (lock) void lock.release().catch(() => {});
  };
}

/** Keep the screen on while `active` is true. */
export function useScreenWakeLock(active: boolean): void {
  useEffect(() => (active ? holdScreenWakeLock() : undefined), [active]);
}
