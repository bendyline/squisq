import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

/**
 * Viewport placement for portaled toolbar popovers, including short screens.
 *
 * Placement runs when the popover opens and on resize/scroll. Pass
 * `trackContent` for a popover whose content changes while it is open (a
 * drill-down menu, content portaled in by another component): it then also
 * re-places whenever the popover's own size changes.
 */
export function useAnchoredPopover(
  open: boolean,
  triggerRef: RefObject<HTMLElement>,
  popoverRef: RefObject<HTMLElement>,
  trackContent = false,
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
    // Content changes resize the popover; placing it again settles at once,
    // since the placement reads the content's height, not the box's.
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
