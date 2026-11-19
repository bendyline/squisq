import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

export interface AnchoredPopoverOptions {
  /**
   * The popover's content changes while it is open (a drill-down menu,
   * content another component portals in). Its box then follows the
   * content: it is pinned by the trigger-side edges and capped by the room
   * available rather than by the content it opened with, and it is placed
   * again whenever its size changes.
   */
  readonly trackContent?: boolean;
}

/**
 * Viewport placement for portaled toolbar popovers, including short screens.
 *
 * The popover hangs below its trigger, right edges aligned, or above it when
 * there is more room there. Placement runs when the popover opens and on
 * resize/scroll.
 */
export function useAnchoredPopover(
  open: boolean,
  triggerRef: RefObject<HTMLElement>,
  popoverRef: RefObject<HTMLElement>,
  { trackContent = false }: AnchoredPopoverOptions = {},
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', visibility: 'hidden' });
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) return;
      const rect = trigger.getBoundingClientRect();
      const below = Math.max(0, window.innerHeight - rect.bottom - 12);
      const above = Math.max(0, rect.top - 12);
      const flip = popover.scrollHeight > below && above > below;
      if (trackContent) {
        // Pinned by the edges beside the trigger, so content that arrives
        // later grows the box away from it (leftwards, and down or up), and
        // capped by the room there, not by the first content's size.
        const right = Math.max(8, window.innerWidth - rect.right);
        setStyle({
          position: 'fixed',
          visibility: 'visible',
          margin: 0,
          left: 'auto',
          right,
          top: flip ? 'auto' : rect.bottom + 4,
          bottom: flip ? window.innerHeight - rect.top + 4 : 'auto',
          maxHeight: flip ? above : below,
          maxWidth: Math.max(0, window.innerWidth - right - 8),
          boxSizing: 'border-box',
          overflowY: 'auto',
        });
        return;
      }
      const height = Math.min(popover.scrollHeight + 2, flip ? above : below);
      setStyle({
        position: 'fixed',
        visibility: 'visible',
        margin: 0,
        right: 'auto',
        bottom: 'auto',
        left: Math.max(
          8,
          Math.min(rect.right - popover.offsetWidth, window.innerWidth - popover.offsetWidth - 8),
        ),
        top: flip ? rect.top - height - 4 : rect.bottom + 4,
        maxHeight: height,
        maxWidth: 'calc(100vw - 16px)',
        boxSizing: 'border-box',
        overflowY: 'auto',
      });
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return;
      position();
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', scroll, true);
    // Content changes resize the popover; place it again, since growing can
    // call for the other side of the trigger.
    const observer =
      trackContent && popoverRef.current && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => position())
        : null;
    if (observer && popoverRef.current) observer.observe(popoverRef.current);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', scroll, true);
      observer?.disconnect();
    };
  }, [open, triggerRef, popoverRef, trackContent]);
  return style;
}
