/**
 * Keep an absolutely positioned popover inside whatever clips it (the editor
 * shell, or failing that the viewport).
 *
 * Toolbar popovers hang from one edge of their trigger. On a phone the trigger
 * can sit anywhere along the row, so a popover hung from its right edge ran
 * off the left of the screen. Narrow it if it can't fit at all, then shift it
 * whichever way it overhangs. Measures from the stylesheet's own placement
 * every time, so calling it again after the content changes is safe.
 */

/** Clearance kept between the popover and the clipping edge. */
const EDGE_MARGIN = 8;

function clippingBounds(element: HTMLElement): { left: number; right: number } {
  const viewport = { left: 0, right: document.documentElement.clientWidth };
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (getComputedStyle(ancestor).overflowX !== 'visible') {
      const rect = ancestor.getBoundingClientRect();
      return {
        left: Math.max(rect.left, viewport.left),
        right: Math.min(rect.right, viewport.right),
      };
    }
  }
  return viewport;
}

export function fitPopoverWithinClip(popover: HTMLElement): void {
  popover.style.left = '';
  popover.style.right = '';
  popover.style.width = '';
  popover.style.minWidth = '';
  const bounds = clippingBounds(popover);
  const min = bounds.left + EDGE_MARGIN;
  const max = bounds.right - EDGE_MARGIN;
  if (popover.getBoundingClientRect().width > max - min) {
    popover.style.minWidth = '0';
    popover.style.width = `${Math.max(0, max - min)}px`;
  }
  const rect = popover.getBoundingClientRect();
  let shift = rect.right > max ? max - rect.right : 0;
  if (rect.left + shift < min) shift = min - rect.left;
  if (shift !== 0) {
    popover.style.left = `${popover.offsetLeft + shift}px`;
    popover.style.right = 'auto';
  }
}
