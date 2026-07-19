import { useEffect, useRef, type RefObject } from 'react';

const escapeDismissalStack: symbol[] = [];

/**
 * Give toolbar popovers one predictable Escape contract even when a pointer
 * opened the popover and focus never moved inside it.
 */
export function useEscapeDismissal(
  open: boolean,
  onDismiss: () => void,
  triggerRef?: RefObject<HTMLElement>,
): void {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const token = Symbol('escape-dismissal');
    escapeDismissalStack.push(token);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        escapeDismissalStack[escapeDismissalStack.length - 1] !== token
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dismissRef.current();
      triggerRef?.current?.focus({ preventScroll: true });
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const index = escapeDismissalStack.lastIndexOf(token);
      if (index >= 0) escapeDismissalStack.splice(index, 1);
    };
  }, [open, triggerRef]);
}
