import { useEffect, useRef, type RefObject } from 'react';

/**
 * Editor-body width at or below which the layers and properties pane turns
 * into a drawer. image-editor.css carries the same number in its container
 * query; the two have to agree.
 */
export const SIDE_PANEL_DRAWER_MAX_BODY_WIDTH = 720;
/** Movement before the gesture commits to an axis. */
const AXIS_LOCK_PX = 10;
/** Fraction of the panel width past which a release opens rather than closes. */
const COMMIT_FRACTION = 0.4;
/** px per ms — a fast flick commits regardless of distance. */
const COMMIT_VELOCITY = 0.5;
/** Long enough to swallow the click a browser may still send after a drag. */
const CLICK_SUPPRESS_MS = 400;
/**
 * Elements that run their own sideways touch drag. A touch that starts on one
 * never closes the drawer. Matches the editor-wide `data-squisq-touch-drag`
 * opt-out the navigation sheet honors.
 */
const OWN_DRAG_SELECTOR = '[data-squisq-touch-drag], input[type="range"]';

export interface SidePanelDrawerSwipeOptions {
  /**
   * The drawer root. Its parent, the editor body, is where touches are read
   * and where the progress custom properties are inherited from.
   */
  readonly drawerRef: RefObject<HTMLElement | null>;
  /** The sliding panel, whose width sets how far the finger must travel. */
  readonly panelRef: RefObject<HTMLElement | null>;
  /** Where a closed drawer can be pulled from: the tab and the edge strip. */
  readonly handleRefs: ReadonlyArray<RefObject<HTMLElement | null>>;
  readonly open: boolean;
  /** The finger has started pulling a closed drawer in. */
  readonly onDragStart: () => void;
  readonly onOpen: () => void;
  /** Release without opening, or swipe an open drawer away. */
  readonly onClose: () => void;
}

/**
 * Pull the image editor's side panel in from the right edge, and swipe it back
 * out. The same gesture as the document's navigation sheet
 * (`useNavigationSheetSwipe`), with one difference that matters on a canvas:
 * a closed drawer is pulled only by its tab or by the edge strip beside it,
 * never by a touch on the canvas itself. A touch on the canvas acts at once
 * (it selects, drags, or drops a shape on pointerdown), so a swipe that began
 * there would also have edited the picture.
 *
 * Pointer Events drive it, and `--squisq-image-editor-drawer-progress` is
 * written straight onto the drawer root during the drag, so following the
 * finger costs no React renders. Listeners sit on the editor body in the
 * capture phase so the drawer sees a touch before the canvas does.
 */
export function useSidePanelDrawerSwipe({
  drawerRef,
  panelRef,
  handleRefs,
  open,
  onDragStart,
  onOpen,
  onClose,
}: SidePanelDrawerSwipeOptions): void {
  // A drag outlives the renders it causes; re-subscribing mid-gesture would
  // drop the pointer, so the listeners read the latest values from here.
  const latestRef = useRef({ onDragStart, onOpen, onClose, handleRefs });
  latestRef.current = { onDragStart, onOpen, onClose, handleRefs };
  // Outlives the re-subscription that opening or closing causes, which can
  // land between a drag's pointerup and the click that follows it.
  const suppressClickUntilRef = useRef(0);

  useEffect(() => {
    const drawer = drawerRef.current;
    const surface = drawer?.parentElement;
    if (!drawer || !surface) return;

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let axis: 'undecided' | 'horizontal' | 'abandoned' = 'undecided';
    let width = 1;

    const setProgress = (value: number): void => {
      drawer.style.setProperty('--squisq-image-editor-drawer-progress', String(value));
    };
    const clearDrag = (): void => {
      drawer.style.removeProperty('--squisq-image-editor-drawer-progress');
      drawer.style.removeProperty('--squisq-image-editor-drawer-duration');
    };
    const progressFor = (dx: number): number =>
      Math.min(1, Math.max(0, open ? 1 - dx / width : -dx / width));
    const startsOnHandle = (target: Node): boolean =>
      latestRef.current.handleRefs.some((ref) => ref.current?.contains(target) ?? false);

    const onPointerDown = (event: PointerEvent): void => {
      if (pointerId !== null || event.pointerType !== 'touch' || !event.isPrimary) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (surface.getBoundingClientRect().width > SIDE_PANEL_DRAWER_MAX_BODY_WIDTH) return;
      if (open) {
        // Only a drag on the panel (its tab included) closes it; the scrim
        // closes on tap.
        if (!panelRef.current?.contains(target) || target.closest(OWN_DRAG_SELECTOR)) return;
      } else if (!startsOnHandle(target)) {
        return;
      }

      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startTime = event.timeStamp;
      axis = 'undecided';
      suppressClickUntilRef.current = 0;
      width = panelRef.current?.getBoundingClientRect().width || 1;
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
        // Suppress the transition so the panel tracks the finger exactly.
        drawer.style.setProperty('--squisq-image-editor-drawer-duration', '0ms');
        if (!open) latestRef.current.onDragStart();
      }
      if (axis !== 'horizontal') return;
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
      // The drag may have started on the tab, whose click would toggle the
      // drawer straight back.
      suppressClickUntilRef.current = event.timeStamp + CLICK_SUPPRESS_MS;
      const callbacks = latestRef.current;
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
      if (shouldOpen && !open) callbacks.onOpen();
      else if (!shouldOpen) callbacks.onClose();
    };

    const onClick = (event: MouseEvent): void => {
      if (event.timeStamp > suppressClickUntilRef.current) return;
      suppressClickUntilRef.current = 0;
      event.preventDefault();
      event.stopPropagation();
    };

    // Cancelling the moves of a drag the drawer follows keeps the browser's
    // fling controller from starting a fling that eats the next tap (see
    // useNavigationSheetSwipe). Pointer moves arrive ahead of their touch
    // moves, so `axis` is already decided here.
    const onTouchMove = (event: TouchEvent): void => {
      if (pointerId !== null && axis === 'horizontal' && event.cancelable) {
        event.preventDefault();
      }
    };

    surface.addEventListener('pointerdown', onPointerDown, true);
    surface.addEventListener('pointermove', onPointerMove, true);
    surface.addEventListener('pointerup', finish, true);
    surface.addEventListener('pointercancel', finish, true);
    surface.addEventListener('click', onClick, true);
    surface.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    return () => {
      surface.removeEventListener('pointerdown', onPointerDown, true);
      surface.removeEventListener('pointermove', onPointerMove, true);
      surface.removeEventListener('pointerup', finish, true);
      surface.removeEventListener('pointercancel', finish, true);
      surface.removeEventListener('click', onClick, true);
      surface.removeEventListener('touchmove', onTouchMove, true);
      clearDrag();
    };
  }, [drawerRef, panelRef, open]);
}
