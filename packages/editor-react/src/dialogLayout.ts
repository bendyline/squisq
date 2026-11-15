/**
 * Where modal dialogs sit on screen: clear of the device's safe areas, and
 * filling the whole window on a phone-sized one.
 *
 * styles/dialogs.css carries the stylesheet half of this; the query below must
 * match the one it uses.
 */

/**
 * A window this narrow or this short is a phone (either way up) or a sliver of
 * a desktop. There, the dialogs that browse or edit at length fill the window
 * rather than floating inside a margin they cannot spare, and their header runs
 * up under the status bar. 720px is the editor body's own narrow breakpoint.
 */
export const FULL_WINDOW_DIALOG_QUERY = '(max-width: 720px), (max-height: 520px)';

/** Whether a full-window dialog should fill the window right now. */
export function dialogFillsWindow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(FULL_WINDOW_DIALOG_QUERY).matches;
}

/**
 * The insets a dialog keeps clear of. A host that lays its page under the
 * system bars publishes its own as `--squisq-safe-area-*` (DocBlocks corrects
 * for the zoom its iPhone app renders at); otherwise the browser's apply.
 */
export const SAFE_AREA = {
  top: 'var(--squisq-safe-area-top, env(safe-area-inset-top, 0px))',
  right: 'var(--squisq-safe-area-right, env(safe-area-inset-right, 0px))',
  bottom: 'var(--squisq-safe-area-bottom, env(safe-area-inset-bottom, 0px))',
  left: 'var(--squisq-safe-area-left, env(safe-area-inset-left, 0px))',
} as const;

/**
 * Padding for an inline-styled modal overlay: `margin` pixels on every side,
 * beyond the safe areas, so a panel sized to 100% of the overlay stays clear of
 * a notch, the status bar and the home indicator.
 */
export function safeAreaPadding(margin: number): string {
  return [SAFE_AREA.top, SAFE_AREA.right, SAFE_AREA.bottom, SAFE_AREA.left]
    .map((inset) => `calc(${inset} + ${margin}px)`)
    .join(' ');
}
