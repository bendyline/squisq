import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface ModalDialogOptions {
  /** The backdrop/portal root. Siblings of this branch are made inert. */
  rootRef: RefObject<HTMLElement | null>;
  /** The element with `role="dialog"`; focus is trapped within it. */
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Explicit opener/owner to restore after unmount (important when a child uses autofocus). */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Whether Escape requests that the dialog close. Defaults to true. */
  closeOnEscape?: boolean;
  onClose: () => void;
}

interface InertSnapshot {
  element: HTMLElement;
  inert: boolean;
  ariaHidden: string | null;
}

function isolateModal(root: HTMLElement): InertSnapshot[] {
  const snapshots: InertSnapshot[] = [];
  let branch: HTMLElement | null = root;
  while (branch?.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
      snapshots.push({
        element: sibling,
        inert: sibling.inert === true,
        ariaHidden: sibling.getAttribute('aria-hidden'),
      });
      sibling.inert = true;
      sibling.setAttribute('aria-hidden', 'true');
    }
    branch = branch.parentElement;
    if (branch === document.body) break;
  }
  return snapshots;
}

/** Shared focus, keyboard, background-isolation, and restoration behavior for modal dialogs. */
export function useModalDialog({
  rootRef,
  dialogRef,
  initialFocusRef,
  returnFocusRef,
  closeOnEscape = true,
  onClose,
}: ModalDialogOptions): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const root = rootRef.current;
    const dialog = dialogRef.current;
    if (!root || !dialog) return;

    const previousFocus =
      returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const inertSnapshots = isolateModal(root);
    const activeWithinDialog =
      document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement)
        ? document.activeElement
        : null;
    const focusTarget =
      initialFocusRef?.current ??
      activeWithinDialog ??
      dialog.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
      dialog;
    focusTarget.focus();
    if (focusTarget instanceof HTMLInputElement || focusTarget instanceof HTMLTextAreaElement) {
      focusTarget.select();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (closeOnEscape) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (element) =>
          !element.hidden &&
          element.getAttribute('aria-hidden') !== 'true' &&
          element.getAttribute('aria-disabled') !== 'true',
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      for (const snapshot of inertSnapshots) {
        snapshot.element.inert = snapshot.inert;
        if (snapshot.ariaHidden === null) snapshot.element.removeAttribute('aria-hidden');
        else snapshot.element.setAttribute('aria-hidden', snapshot.ariaHidden);
      }
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [closeOnEscape, dialogRef, initialFocusRef, returnFocusRef, rootRef]);
}
