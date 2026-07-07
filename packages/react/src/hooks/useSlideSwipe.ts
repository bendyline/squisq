/**
 * useSlideSwipe Hook
 *
 * Drag-to-swipe navigation for slideshow mode. Press on the current slide to
 * "pick it up", drag left/right, and on release either snap back (small drag)
 * or advance to the next/previous slide (large drag or a quick flick).
 *
 * The gesture only translates the *current* slide (a "pick up & toss" feel) —
 * the incoming slide arrives via its normal enter transition once navigation
 * commits. The current slide is already mounted and settled, so translating it
 * is a pure `transform` with no animation conflict.
 *
 * Mirrors the repo's canonical pointer-drag pattern (imageEditor/CanvasSurface):
 * ref-held drag start + `setPointerCapture` + window pointermove/up/cancel +
 * a threshold decision on release. Navigation itself is delegated to the
 * caller's `onNext`/`onPrev` (DocPlayer's `slideNavActions`).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

/** Fraction of the container width a drag must cross to commit a slide change. */
const DISTANCE_RATIO = 0.3;
/** A fast flick commits even below the distance threshold (px per millisecond). */
const FLICK_VELOCITY = 0.5;
/** Ignore flicks shorter than this so a click's micro-jitter never navigates (px). */
const MIN_FLICK_DISTANCE = 12;
/** Resistance factor applied when dragging past the first/last slide. */
const RUBBER_BAND = 0.35;
/** Default settle animation duration (ms). Must match the CSS in doc-animations.css. */
const DEFAULT_SETTLE_MS = 260;

/** The lifecycle of a swipe gesture. */
export type SwipePhase = 'idle' | 'dragging' | 'settling';

/** Outcome of a completed drag. */
export type SwipeDecision = 'next' | 'prev' | 'snap';

export interface SwipeDecisionInput {
  /** Horizontal delta from drag start (px). Negative = leftward = next. */
  dx: number;
  /** Width of the slide container (px). */
  width: number;
  /** How long the drag lasted (ms). */
  elapsedMs: number;
  /** Whether a next slide exists. */
  canNext: boolean;
  /** Whether a previous slide exists. */
  canPrev: boolean;
}

/**
 * Pure decision: given a completed drag, should we advance, go back, or snap
 * back? Committing requires either crossing the distance threshold or a fast
 * flick, *and* a slide existing in that direction. Extracted from the hook so
 * the threshold logic is testable without a DOM.
 */
export function decideSwipe({
  dx,
  width,
  elapsedMs,
  canNext,
  canPrev,
}: SwipeDecisionInput): SwipeDecision {
  const distanceThreshold = width > 0 ? width * DISTANCE_RATIO : Infinity;
  const velocity = elapsedMs > 0 ? Math.abs(dx) / elapsedMs : 0;
  const passesDistance = Math.abs(dx) >= distanceThreshold;
  const passesFlick = velocity >= FLICK_VELOCITY && Math.abs(dx) >= MIN_FLICK_DISTANCE;

  if (!passesDistance && !passesFlick) return 'snap';
  if (dx < 0) return canNext ? 'next' : 'snap'; // dragged left → next slide
  if (dx > 0) return canPrev ? 'prev' : 'snap'; // dragged right → previous slide
  return 'snap';
}

export interface UseSlideSwipeOptions {
  /** Master gate — the gesture is inert unless enabled (slideshow mode, not headless). */
  enabled: boolean;
  /** Ref to the player container, used to measure width for the threshold. */
  containerRef: RefObject<HTMLElement>;
  /** Whether a next slide exists (`currentBlockIndex < total - 1`). */
  canGoNext: boolean;
  /** Whether a previous slide exists (`currentBlockIndex > 0`). */
  canGoPrev: boolean;
  /** Commit to the next slide. */
  onNext: () => void;
  /** Commit to the previous slide. */
  onPrev: () => void;
  /** Settle animation duration (ms); must match the CSS. Defaults to 260. */
  settleMs?: number;
}

export interface UseSlideSwipeResult {
  /** Live horizontal offset to apply to the active slide (px). */
  offsetPx: number;
  /** Current gesture phase — drives the transform transition class. */
  phase: SwipePhase;
  /** Attach to the container's `onPointerDown`. */
  onPointerDown: (e: React.PointerEvent) => void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startTime: number;
  target: Element;
}

/**
 * Manage the swipe gesture state machine for a slideshow player.
 */
export function useSlideSwipe(opts: UseSlideSwipeOptions): UseSlideSwipeResult {
  const settleMs = opts.settleMs ?? DEFAULT_SETTLE_MS;

  const [offsetPx, setOffsetPx] = useState(0);
  const [phase, setPhase] = useState<SwipePhase>('idle');

  // Keep the latest options in a ref so the window listeners (bound once) never
  // read stale callbacks/flags.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const dragRef = useRef<DragState | null>(null);
  const phaseRef = useRef<SwipePhase>('idle');
  phaseRef.current = phase;
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleRaf = useRef<number | null>(null);

  const clearPending = useCallback(() => {
    if (settleTimer.current != null) {
      clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    if (settleRaf.current != null) {
      cancelAnimationFrame(settleRaf.current);
      settleRaf.current = null;
    }
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const o = optsRef.current;
    if (!o.enabled) return;
    // Don't interrupt an in-flight fling/snap.
    if (phaseRef.current === 'settling') return;
    // Only the primary mouse button initiates a drag; touch/pen always do.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Let interactive chrome (prev/next buttons, links) handle their own events.
    const target = e.target as Element;
    if (target.closest?.('button, a, input, textarea, select, [data-no-swipe]')) return;

    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startTime: performance.now(),
      target,
    };
    try {
      target.setPointerCapture?.(e.pointerId);
    } catch {
      // Pointer capture is best-effort; window listeners still receive events.
    }
    setPhase('dragging');
    setOffsetPx(0);
  }, []);

  // Bind move/up/cancel on window once. Handlers read live state from refs, so
  // they never need re-binding and never go stale.
  useEffect(() => {
    function currentWidth(): number {
      return optsRef.current.containerRef.current?.getBoundingClientRect().width ?? 0;
    }

    function endDrag(drag: DragState) {
      dragRef.current = null;
      try {
        drag.target.releasePointerCapture?.(drag.pointerId);
      } catch {
        // ignore — capture may already be released
      }
    }

    function settleTo(target: number, onArrive?: () => void) {
      // Switch on the transition class first (offset unchanged), then move to the
      // target on the next frame so the browser reliably animates the change.
      setPhase('settling');
      settleRaf.current = requestAnimationFrame(() => {
        settleRaf.current = null;
        setOffsetPx(target);
        settleTimer.current = setTimeout(() => {
          settleTimer.current = null;
          onArrive?.();
          setOffsetPx(0);
          setPhase('idle');
        }, settleMs);
      });
    }

    function onMove(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const o = optsRef.current;
      const raw = e.clientX - drag.startX;
      const blocked = (raw > 0 && !o.canGoPrev) || (raw < 0 && !o.canGoNext);
      setOffsetPx(blocked ? raw * RUBBER_BAND : raw);
    }

    function onUp(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      endDrag(drag);
      const o = optsRef.current;
      const rawDx = e.clientX - drag.startX;
      const width = currentWidth();
      const elapsedMs = performance.now() - drag.startTime;
      const decision = decideSwipe({
        dx: rawDx,
        width,
        elapsedMs,
        canNext: o.canGoNext,
        canPrev: o.canGoPrev,
      });

      if (decision === 'snap') {
        settleTo(0);
        return;
      }
      // Fling fully off-screen in the drag direction, then commit navigation.
      // Never move the slide back toward center first (guard against over-drag).
      const distance = Math.max(width, Math.abs(rawDx));
      const target = decision === 'next' ? -distance : distance;
      settleTo(target, decision === 'next' ? o.onNext : o.onPrev);
    }

    function onCancel(e: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      endDrag(drag);
      settleTo(0);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [settleMs]);

  // Reset all in-flight state if the gesture is disabled mid-drag (e.g. mode switch).
  useEffect(() => {
    if (!opts.enabled) {
      dragRef.current = null;
      clearPending();
      setPhase('idle');
      setOffsetPx(0);
    }
  }, [opts.enabled, clearPending]);

  // Cancel any pending settle on unmount.
  useEffect(() => clearPending, [clearPending]);

  return { offsetPx, phase, onPointerDown };
}
