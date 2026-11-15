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
/** The squiggle the latest `pointerdown` landed on, if any. */
let lastPressedSquiggle: HTMLElement | null = null;
let trackers = 0;

function notePointerDown(event: PointerEvent): void {
  lastPointerDownType = event.pointerType ?? '';
  const target = event.target as Element | null;
  lastPressedSquiggle = target?.closest?.<HTMLElement>('[data-proof-id]') ?? null;
}

/**
 * Record each press's pointer type for as long as a caller needs tap
 * detection. Returns the release.
 *
 * WebKit cannot be asked what made a click: older Safari dispatches it as a
 * plain `MouseEvent` with no `pointerType`, and current iOS and iPadOS
 * dispatch a finger's tap as a `PointerEvent` that says `"mouse"`. There the
 * press that preceded the click is the only honest record of what made it.
 */
export function trackTapPointers(): () => void {
  if (trackers === 0) window.addEventListener('pointerdown', notePointerDown, true);
  trackers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    trackers -= 1;
    if (trackers === 0) {
      window.removeEventListener('pointerdown', notePointerDown, true);
      lastPressedSquiggle = null;
    }
  };
}

/** Whether a finger or pen, rather than a mouse or the keyboard, made this click. */
export function isTapClick(event: MouseEvent): boolean {
  const own = (event as Partial<PointerEvent>).pointerType;
  if (own === 'touch' || own === 'pen') return true;
  // A click that says "mouse", or nothing, may still be a tap in WebKit. Every
  // real press begins with a `pointerdown`, so a mouse's own press would have
  // overwritten a finger's before its click arrived. `detail` is 0 for a
  // click made by the keyboard or by script, which the last press says
  // nothing about.
  return event.detail > 0 && (lastPointerDownType === 'touch' || lastPointerDownType === 'pen');
}

/** The squiggle a finger or pen tapped, or null for any other click. */
export function proofingTapTarget(event: MouseEvent): HTMLElement | null {
  if (!isTapClick(event)) return null;
  const target = event.target as Element | null;
  const clicked = target?.closest?.<HTMLElement>('[data-proof-id]');
  if (clicked) return clicked;
  // A squiggle can move or be redrawn between press and release. The tap that
  // focuses the editor can reveal chrome above the word and push it down, and
  // a lint pass landing then re-issues every finding's id and redraws it.
  // Either way the browser aims the click at an ancestor of both the press
  // and the release, so the press is the better witness: the squiggle it
  // landed on, if it is still there, else whatever is now under the finger.
  const pressed = lastPressedSquiggle;
  if (pressed?.isConnected && target?.contains(pressed)) return pressed;
  const lifted = document
    .elementFromPoint?.(event.clientX, event.clientY)
    ?.closest?.<HTMLElement>('[data-proof-id]');
  return lifted && target?.contains(lifted) ? lifted : null;
}
