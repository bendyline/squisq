import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

const modalStack: symbol[] = [];
const inertOwners = new Map<HTMLElement, InertSnapshot & { count: number }>();

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

function isolateModal(root: HTMLElement): HTMLElement[] {
  const elements: HTMLElement[] = [];
  let branch: HTMLElement | null = root;
  while (branch?.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
      const owner = inertOwners.get(sibling);
      if (owner) owner.count++;
      else
        inertOwners.set(sibling, {
          element: sibling,
          inert: sibling.inert === true,
          ariaHidden: sibling.getAttribute('aria-hidden'),
          count: 1,
        });
      elements.push(sibling);
      sibling.inert = true;
      sibling.setAttribute('aria-hidden', 'true');
    }
    branch = branch.parentElement;
    if (branch === document.body) break;
  }
  return elements;
}

function canTabTo(element: HTMLElement): boolean {
  if (element.tabIndex < 0 || element.matches(':disabled, input[type="hidden"]')) return false;
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.hidden || ancestor.inert || ancestor.getAttribute('aria-hidden') === 'true')
      return false;
    const style = getComputedStyle(ancestor);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    )
      return false;
  }
  return true;
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
  const closeOnEscapeRef = useRef(closeOnEscape);
  closeOnEscapeRef.current = closeOnEscape;

  useEffect(() => {
    const root = rootRef.current;
    const dialog = dialogRef.current;
    if (!root || !dialog) return;
    const token = Symbol('modal');
    modalStack.push(token);

    const previousFocus =
      returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const activeWithinDialog =
      document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement)
        ? document.activeElement
        : null;
    const focusTarget =
      initialFocusRef?.current ??
      activeWithinDialog ??
      [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].find(canTabTo) ??
      dialog;
    focusTarget.focus();
    if (focusTarget instanceof HTMLInputElement || focusTarget instanceof HTMLTextAreaElement) {
      focusTarget.select();
    }
    const inertSnapshots = isolateModal(root);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || modalStack[modalStack.length - 1] !== token) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (closeOnEscapeRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        canTabTo,
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
        (document.activeElement === first ||
          document.activeElement === dialog ||
          !dialog.contains(document.activeElement))
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

    // Let controls and portaled popovers consume Escape before the enclosing
    // dialog. Capture-phase dismissal discards the entire dialog's draft.
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      const wasTopmost = modalStack[modalStack.length - 1] === token;
      modalStack.splice(modalStack.indexOf(token), 1);
      for (const element of inertSnapshots) {
        const snapshot = inertOwners.get(element);
        if (!snapshot || --snapshot.count > 0) continue;
        element.inert = snapshot.inert;
        if (snapshot.ariaHidden === null) element.removeAttribute('aria-hidden');
        else element.setAttribute('aria-hidden', snapshot.ariaHidden);
        inertOwners.delete(element);
      }
      if (wasTopmost && previousFocus?.isConnected && !previousFocus.closest('[inert]'))
        previousFocus.focus();
    };
  }, [dialogRef, initialFocusRef, returnFocusRef, rootRef]);
}
