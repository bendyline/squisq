/**
 * Finger and pen taps on a squiggle.
 *
 * A mouse reaches the hover card by resting on a squiggle. A finger cannot
 * hover, so its tap raises the card instead. Two places have to agree on what
 * counts as such a tap: `useProofing`, which raises the card, and the shell's
 * link delegation, which stands down so that a squiggled link shows the card
 * (and its "Open link") instead of navigating out from under it. Both ask here.
 */

/** Pointer type of the latest `pointerdown`, for clicks that carry none. */
let lastPointerDownType = '';
let trackers = 0;

function notePointerDown(event: PointerEvent): void {
  lastPointerDownType = event.pointerType ?? '';
}

/**
 * Record each press's pointer type for as long as a caller needs tap
 * detection. Returns the release.
 *
 * Safari dispatches `click` as a plain `MouseEvent` with no `pointerType`, so
 * there the press that preceded a click is the only record of what made it.
 */
export function trackTapPointers(): () => void {
  if (trackers === 0) window.addEventListener('pointerdown', notePointerDown, true);
  trackers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    trackers -= 1;
    if (trackers === 0) window.removeEventListener('pointerdown', notePointerDown, true);
  };
}

/** Whether a finger or pen, rather than a mouse or the keyboard, made this click. */
export function isTapClick(event: MouseEvent): boolean {
  const own = (event as Partial<PointerEvent>).pointerType;
  // `detail` is 0 for a click made by the keyboard or by script, which the
  // last press says nothing about.
  const type = typeof own === 'string' ? own : event.detail > 0 ? lastPointerDownType : '';
  return type === 'touch' || type === 'pen';
}

/** The squiggle a finger or pen tapped, or null for any other click. */
export function proofingTapTarget(event: MouseEvent): HTMLElement | null {
  if (!isTapClick(event)) return null;
  const target = event.target as Element | null;
  return target?.closest?.<HTMLElement>('[data-proof-id]') ?? null;
}
