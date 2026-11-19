/**
 * Link delegation for the editor shell. When a host wires `onLinkClick`, a
 * plain click on any link inside the shell goes to the host instead of the
 * browser, and hovering such a link shows its href as a native tooltip
 * (`linkHoverTitle.ts`). The handlers attach in the capture phase on the
 * shell root, so they see links in every view before the editing surface does.
 */

import { useCallback, type MouseEvent as ReactMouseEvent } from 'react';
import { proofingTapTarget } from './proofing/proofingTap';
import type { LinkDelegate } from './linkSafety/useLinkSafety';
import {
  clearLinkHoverTitle,
  clearStaleLinkHoverTitle,
  showLinkHoverTitle,
} from './linkHoverTitle';

type ShellMouseHandler = (event: ReactMouseEvent<HTMLDivElement>) => void;

/** Capture-phase handlers to spread onto the shell root. */
export interface ShellLinkDelegationHandlers {
  onClickCapture: ShellMouseHandler;
  onMouseOverCapture: ShellMouseHandler;
  onMouseOutCapture: ShellMouseHandler;
}

export function useShellLinkDelegation(
  onLinkClick: LinkDelegate | undefined,
): ShellLinkDelegationHandlers {
  const onClickCapture = useCallback<ShellMouseHandler>(
    (event) => {
      if (!onLinkClick || event.button !== 0) return;
      const anchor = (event.target as HTMLElement).closest?.('a[href]');
      if (!anchor || !event.currentTarget.contains(anchor)) return;
      // A finger on a squiggled link is asking about the squiggle first. The
      // proofing card it raises carries "Open link"; following the link here
      // would take the reader away before the card could be seen.
      if (proofingTapTarget(event.nativeEvent)) return;
      const href = anchor.getAttribute('href');
      if (!href || onLinkClick(href, anchor.textContent ?? undefined) === false) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [onLinkClick],
  );

  const onMouseOverCapture = useCallback<ShellMouseHandler>(
    (event) => {
      if (!onLinkClick) return;
      const target = event.target as HTMLElement;
      const anchor = target.closest?.('a[href]');
      if (!anchor || !event.currentTarget.contains(anchor)) {
        clearStaleLinkHoverTitle(target);
        return;
      }
      showLinkHoverTitle(anchor);
    },
    [onLinkClick],
  );

  const onMouseOutCapture = useCallback<ShellMouseHandler>((event) => {
    const anchor = (event.target as HTMLElement).closest?.('a[href]');
    if (!anchor || !event.currentTarget.contains(anchor)) return;
    if (event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget)) return;
    clearLinkHoverTitle(anchor);
  }, []);

  return { onClickCapture, onMouseOverCapture, onMouseOutCapture };
}
