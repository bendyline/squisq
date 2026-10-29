import { useEffect, useRef, type RefObject } from 'react';

/** Which list the navigation sheet shows. */
export type NavigationSheetPanel = 'outline' | 'previews';

/** Editor-body width at or below which the side panes give way to the sheet. */
export const NAVIGATION_SHEET_MAX_BODY_WIDTH = 720;
/** Distance from the right edge that begins an open gesture. */
const EDGE_ZONE_PX = 24;
/** Movement before the gesture commits to an axis. */
const AXIS_LOCK_PX = 10;
/** Downward travel, once the sheet is following the finger, that asks for previews. */
const PREVIEWS_PULL_PX = 48;
/** Fraction of the sheet width past which a release opens rather than closes. */
const COMMIT_FRACTION = 0.4;
/** px per ms — a fast flick commits regardless of distance. */
const COMMIT_VELOCITY = 0.5;

export interface NavigationSheetSwipeOptions {
  /** The sheet root; its parent, the editor body, is where touches are read. */
  readonly sheetRef: RefObject<HTMLElement | null>;
  /** The sliding panel, whose width sets how far the finger must travel. */
  readonly panelRef: RefObject<HTMLElement | null>;
  readonly open: boolean;
  /** The finger has pulled the sheet in; mount its content. */
  readonly onDragStart: (panel: NavigationSheetPanel) => void;
  readonly onOpen: (panel: NavigationSheetPanel) => void;
  /** Release without opening, or swipe an open sheet away. */
  readonly onClose: () => void;
}

/**
 * Swipe in from the right edge for the outline, then drag downward for block
 * previews; swipe the open sheet back to the right to close it.
 *
 * Pointer Events drive it, like the host drawers this sits beside; the one
 * touch listener only cancels the moves of a drag the sheet has taken. And
 * `--squisq-navigation-sheet-progress` is written straight onto the sheet
 * during the drag so following the finger costs no React renders. Listeners
 * run in the capture phase so the sheet's scrim can stop a touch from also
 * reaching a host's own edge gesture.
 *
 * The editor body has to let horizontal moves through as pointer events: a
 * scroller left at `touch-action: auto` hands them to the browser, which
 * cancels the pointer after the first move. navigation-sheet.css gives the WYSIWYG
 * scroller `pan-y` on narrow touch layouts for exactly that reason.
 */
export function useNavigationSheetSwipe({
  sheetRef,
  panelRef,
  open,
  onDragStart,
  onOpen,
  onClose,
}: NavigationSheetSwipeOptions): void {
  // A drag outlives the renders it causes; re-subscribing mid-gesture would
  // drop the pointer, so the listeners read the latest callbacks from here.
  const callbacksRef = useRef({ onDragStart, onOpen, onClose });
  callbacksRef.current = { onDragStart, onOpen, onClose };

  useEffect(() => {
    const sheet = sheetRef.current;
    const surface = sheet?.parentElement;
    if (!sheet || !surface) return;

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let axis: 'undecided' | 'horizontal' | 'abandoned' = 'undecided';
    let width = 1;
    let pulledPreviews = false;

    const setProgress = (value: number): void => {
      sheet.style.setProperty('--squisq-navigation-sheet-progress', String(value));
    };
    const clearDrag = (): void => {
      sheet.style.removeProperty('--squisq-navigation-sheet-progress');
      sheet.style.removeProperty('--squisq-navigation-sheet-duration');
    };
    const progressFor = (dx: number): number =>
      Math.min(1, Math.max(0, open ? 1 - dx / width : -dx / width));

    const onPointerDown = (event: PointerEvent): void => {
      if (pointerId !== null || event.pointerType !== 'touch' || !event.isPrimary) return;
      const bounds = surface.getBoundingClientRect();
      if (open) {
        // Only a drag on the panel closes it; the scrim closes on tap.
        if (!panelRef.current?.contains(event.target as Node)) return;
      } else if (
        bounds.width > NAVIGATION_SHEET_MAX_BODY_WIDTH ||
        bounds.right - event.clientX > EDGE_ZONE_PX
      ) {
        return;
      }

      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startTime = event.timeStamp;
      axis = 'undecided';
      pulledPreviews = false;
      width = panelRef.current?.getBoundingClientRect().width || bounds.width || 1;
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      if (axis === 'undecided') {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        // Vertical first is a scroll; the wrong horizontal direction is nothing.
        const inward = open ? dx > 0 : dx < 0;
        axis = Math.abs(dx) > Math.abs(dy) && inward ? 'horizontal' : 'abandoned';
        if (axis !== 'horizontal') return;
        surface.setPointerCapture(event.pointerId);
        // Suppress the transition so the sheet tracks the finger exactly.
        sheet.style.setProperty('--squisq-navigation-sheet-duration', '0ms');
        if (!open) callbacksRef.current.onDragStart('outline');
      }
      if (axis !== 'horizontal' || pulledPreviews) return;

      if (!open && dy >= PREVIEWS_PULL_PX) {
        // The downward turn is the request for previews: let the sheet finish
        // opening on its own and stop following the finger.
        pulledPreviews = true;
        callbacksRef.current.onDragStart('previews');
        sheet.style.removeProperty('--squisq-navigation-sheet-duration');
        setProgress(1);
        return;
      }
      setProgress(progressFor(dx));
    };

    const finish = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      const wasHorizontal = axis === 'horizontal';
      pointerId = null;
      axis = 'undecided';
      if (surface.hasPointerCapture(event.pointerId)) {
        surface.releasePointerCapture(event.pointerId);
      }
      if (!wasHorizontal) return;

      clearDrag();
      const callbacks = callbacksRef.current;
      if (pulledPreviews) {
        callbacks.onOpen('previews');
        return;
      }
      // A cancelled pointer reports no usable position: leave things as they were.
      if (event.type === 'pointercancel') {
        if (!open) callbacks.onClose();
        return;
      }
      const dx = event.clientX - startX;
      // Positive velocity always means "toward open".
      const velocity = -dx / Math.max(1, event.timeStamp - startTime);
      const progress = progressFor(dx);
      const shouldOpen =
        velocity > COMMIT_VELOCITY
          ? true
          : velocity < -COMMIT_VELOCITY
            ? false
            : open
              ? progress > 1 - COMMIT_FRACTION
              : progress > COMMIT_FRACTION;
      if (shouldOpen && !open) callbacks.onOpen('outline');
      else if (!shouldOpen) callbacks.onClose();
    };

    // pan-y keeps the browser from scrolling sideways, but its fling controller
    // sees the gesture first: a quick swipe still leaves a fling running with
    // nothing to scroll, and Chromium on Android, ChromeOS and Linux treats the
    // next tap as stopping that fling — never a click. Cancelling the moves the
    // sheet follows drops the fling before it starts. Pointer moves arrive
    // ahead of their touch moves, so `axis` is already decided here.
    const onTouchMove = (event: TouchEvent): void => {
      if (pointerId !== null && axis === 'horizontal' && event.cancelable) {
        event.preventDefault();
      }
    };

    surface.addEventListener('pointerdown', onPointerDown, true);
    surface.addEventListener('pointermove', onPointerMove, true);
    surface.addEventListener('pointerup', finish, true);
    surface.addEventListener('pointercancel', finish, true);
    surface.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    return () => {
      surface.removeEventListener('pointerdown', onPointerDown, true);
      surface.removeEventListener('pointermove', onPointerMove, true);
      surface.removeEventListener('pointerup', finish, true);
      surface.removeEventListener('pointercancel', finish, true);
      surface.removeEventListener('touchmove', onTouchMove, true);
      clearDrag();
    };
  }, [sheetRef, panelRef, open]);
}
