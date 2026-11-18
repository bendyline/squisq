/**
 * The link delegate an editor shell hands to every place a link can be
 * followed from (the Write view, previews, the proofing card), with a
 * confirmation in front of web links when the host asks for one.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { externalLinkUrl, inspectLink, type LinkInspection } from './inspectLink';
import { LinkSafetyDialog } from './LinkSafetyDialog';

/**
 * Ask before a web link opens. The host owns what happens next: it opens the
 * address its own way, and it keeps the list of sites the reader trusts
 * (squisq stores nothing).
 */
export interface LinkSafety {
  /** Open an address the reader agreed to. */
  open: (href: string) => void;
  /** Whether links to `host` (lowercase) open without asking. */
  isTrusted?: (host: string) => boolean;
  /** Remember "Always open links to <host>". Without it the choice is not offered. */
  trust?: (host: string) => void;
}

/** A host link delegate; `text` is the link's own text, when the caller has it. */
export type LinkDelegate = (href: string, text?: string) => boolean | undefined;

export interface UseLinkSafetyResult {
  /** The delegate to hand on; undefined when there is neither a host delegate nor a confirmation. */
  onLinkClick: LinkDelegate | undefined;
  /** The open confirmation, portaled to the body; render it anywhere. */
  dialog: ReactNode;
}

export function useLinkSafety(
  linkSafety: LinkSafety | undefined,
  onLinkClick: ((href: string) => boolean | undefined) | undefined,
  colorScheme: 'light' | 'dark',
): UseLinkSafetyResult {
  const [pending, setPending] = useState<LinkInspection | null>(null);
  const safetyRef = useRef(linkSafety);
  safetyRef.current = linkSafety;
  const delegateRef = useRef(onLinkClick);
  delegateRef.current = onLinkClick;

  const handle = useCallback<LinkDelegate>((href, text) => {
    const safety = safetyRef.current;
    const url = safety ? externalLinkUrl(href) : null;
    if (!safety || !url) {
      const delegate = delegateRef.current;
      return delegate ? delegate(href) : false;
    }
    const inspection = inspectLink(url, text);
    if (safety.isTrusted?.(inspection.host)) safety.open(url.href);
    else setPending(inspection);
    return true;
  }, []);

  const close = useCallback(() => setPending(null), []);
  const dialog =
    pending && linkSafety && typeof document !== 'undefined'
      ? createPortal(
          <div className="squisq-dialog-portal" data-theme={colorScheme}>
            <LinkSafetyDialog
              inspection={pending}
              canTrust={linkSafety.trust !== undefined}
              onClose={close}
              onOpen={(trust) => {
                setPending(null);
                if (trust) linkSafety.trust?.(pending.host);
                linkSafety.open(pending.url.href);
              }}
            />
          </div>,
          document.body,
        )
      : null;

  return { onLinkClick: linkSafety || onLinkClick ? handle : undefined, dialog };
}
