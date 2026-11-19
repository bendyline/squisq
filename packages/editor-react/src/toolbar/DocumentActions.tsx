/**
 * The toolbar's document actions: Document settings, Custom layouts, Version
 * history and whatever the host adds through `toolbarSlotDocumentActions`
 * (AI, read aloud, export…), grouped behind one divider at the row's end.
 *
 * When the row runs short the whole group folds into one "Document actions"
 * menu (see toolbarCollapse.ts for when). The menu drills down: a short top
 * level with a row per action, and an action with a menu of its own opens it
 * in place behind a Back row, so a phone never shows one long list.
 *
 * Built-in and host actions take part the same way, through
 * {@link useToolbarDocumentAction}: each registers the row it wants in the
 * folded menu, and learns whether the group is folded (hide the inline
 * button but keep everything else mounted: dialogs, progress, a playback
 * transport) and, while its submenu is open, where to portal that
 * submenu's items.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon';
import { useAnchoredPopover } from '../useAnchoredPopover';
import { useEscapeDismissal } from '../useEscapeDismissal';
import { DOCUMENT_ACTIONS_ITEM } from './toolbarCollapse';

/** A document action's row in the folded Document actions menu. */
export interface ToolbarDocumentAction {
  /** Unique among the toolbar's document actions. */
  id: string;
  /** The row's label, e.g. `"Export"`. */
  label: string;
  /** The row's glyph, drawn 18px wide like the ··· menu's icons. */
  icon?: ReactNode;
  disabled?: boolean;
  /**
   * The action has a menu of its own. Choosing the row drills into a panel
   * that the action fills by portaling its menu items into
   * {@link ToolbarDocumentActionState.submenuContainer}. Without it, choosing
   * the row closes the menu and calls {@link onSelect}.
   */
  submenu?: boolean;
  onSelect?: () => void;
}

/** What a document action needs to know about its group. */
export interface ToolbarDocumentActionState {
  /**
   * The group is folded into the Document actions menu. Hide the inline
   * button, but keep the control mounted: its dialogs and progress still
   * belong to it. Anything that must stay on the row while folded (a
   * playback transport) carries `data-toolbar-transient`, which also keeps
   * it out of the measurement that decides when to fold.
   */
  folded: boolean;
  /**
   * While this action's submenu is open in the folded menu, the element to
   * portal its menu items into (`role="menuitem"` buttons); otherwise null.
   */
  submenuContainer: HTMLElement | null;
  /**
   * Close the folded menu — call it after a submenu item runs. Focus goes
   * back to the menu's trigger when `restoreFocus` is true.
   */
  closeMenu: (restoreFocus?: boolean) => void;
  /**
   * The folded menu's trigger while the group is folded: anchor a popover
   * the action opens to it, or return focus to it, since the action's own
   * button is hidden.
   */
  menuTrigger: HTMLElement | null;
}

interface RegisteredAction {
  readonly action: ToolbarDocumentAction;
  readonly element: HTMLElement | null;
  readonly sequence: number;
}

/** Folded-menu rows, in the order their controls sit on the row. */
class DocumentActionRegistry {
  private readonly entries = new Map<symbol, RegisteredAction>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly RegisteredAction[] = [];
  private sequence = 0;

  set(key: symbol, action: ToolbarDocumentAction, element: HTMLElement | null): void {
    const sequence = this.entries.get(key)?.sequence ?? this.sequence++;
    this.entries.set(key, { action, element, sequence });
    this.emit();
  }

  delete(key: symbol): void {
    if (this.entries.delete(key)) this.emit();
  }

  /** The latest registration for `id`, read at click time. */
  find(id: string): ToolbarDocumentAction | undefined {
    for (const entry of this.entries.values()) {
      if (entry.action.id === id) return entry.action;
    }
    return undefined;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): readonly RegisteredAction[] => this.snapshot;

  private emit(): void {
    this.snapshot = [...this.entries.values()].sort(byLayoutOrder);
    for (const listener of this.listeners) listener();
  }
}

function byLayoutOrder(a: RegisteredAction, b: RegisteredAction): number {
  if (a.element && b.element && a.element !== b.element) {
    const position = a.element.compareDocumentPosition(b.element);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  }
  return a.sequence - b.sequence;
}

interface DocumentActionsContextValue {
  readonly registry: DocumentActionRegistry;
  readonly folded: boolean;
  readonly submenu: string | null;
  readonly submenuContainer: HTMLElement | null;
  readonly closeMenu: (restoreFocus?: boolean) => void;
  readonly trigger: HTMLElement | null;
}

const DocumentActionsContext = createContext<DocumentActionsContextValue | null>(null);

const UNGROUPED: ToolbarDocumentActionState = {
  folded: false,
  submenuContainer: null,
  closeMenu: () => {},
  menuTrigger: null,
};

/**
 * Take part in the toolbar's document actions. Call it from a control
 * rendered in `toolbarSlotDocumentActions` (or a built-in one); pass the
 * control's root element so the folded menu lists rows in the row's order.
 * `null` registers no row. Outside a document-actions group it registers
 * nothing and reports the group as never folded.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useToolbarDocumentAction(
  action: ToolbarDocumentAction | null,
  elementRef?: RefObject<HTMLElement | null>,
): ToolbarDocumentActionState {
  const group = useContext(DocumentActionsContext);
  const [key] = useState(() => Symbol('toolbar-document-action'));

  // Re-register after every render so the menu reads the latest label,
  // disabled state and callbacks.
  useLayoutEffect(() => {
    if (!group) return;
    if (action) group.registry.set(key, action, elementRef?.current ?? null);
    else group.registry.delete(key);
  });
  useLayoutEffect(() => {
    if (!group) return;
    return () => group.registry.delete(key);
  }, [group, key]);

  if (!group) return UNGROUPED;
  return {
    folded: group.folded,
    submenuContainer: action && group.submenu === action.id ? group.submenuContainer : null,
    closeMenu: group.closeMenu,
    menuTrigger: group.folded ? group.trigger : null,
  };
}

type FocusTarget = (menu: HTMLElement) => HTMLElement | null;

const ENABLED_ITEM = '[role="menuitem"]:not(:disabled)';

export interface DocumentActionsGroupProps {
  /** Fold the group into its Document actions menu. */
  folded: boolean;
  /** Theme for the portaled menu, which sits outside the editor shell. */
  colorScheme?: string;
  children: ReactNode;
}

/** The divider, the actions, and — folded — the menu that stands in for them. */
export function DocumentActionsGroup({ folded, colorScheme, children }: DocumentActionsGroupProps) {
  const [registry] = useState(() => new DocumentActionRegistry());
  const actions = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  );
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<string | null>(null);
  const [submenuContainer, setSubmenuContainer] = useState<HTMLDivElement | null>(null);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const menuStyle = useAnchoredPopover(open, triggerRef, menuRef, { trackContent: true });

  const setTriggerElement = useCallback((element: HTMLButtonElement | null) => {
    triggerRef.current = element;
    setTrigger(element);
  }, []);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    setSubmenu(null);
    pendingFocus.current = null;
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  const openMenu = useCallback(() => {
    pendingFocus.current = (menu) => menu.querySelector<HTMLElement>(ENABLED_ITEM);
    setSubmenu(null);
    setOpen(true);
  }, []);

  const back = useCallback(() => {
    const from = submenu;
    pendingFocus.current = (menu) =>
      [...menu.querySelectorAll<HTMLElement>('[data-document-action]')].find(
        (row) => row.dataset.documentAction === from,
      ) ?? menu.querySelector<HTMLElement>(ENABLED_ITEM);
    setSubmenu(null);
  }, [submenu]);

  const choose = useCallback(
    (id: string) => {
      const action = registry.find(id);
      if (!action || action.disabled) return;
      if (action.submenu) {
        // The host portals its items in a render later. Wait for them, and
        // settle on the Back row only if they arrive with none enabled.
        pendingFocus.current = (menu) => {
          const container = menu.querySelector<HTMLElement>('.squisq-toolbar-document-submenu');
          if (!container || container.childElementCount === 0) return null;
          return (
            container.querySelector<HTMLElement>(ENABLED_ITEM) ??
            menu.querySelector<HTMLElement>('.squisq-toolbar-document-menu-back')
          );
        };
        setSubmenu(id);
        return;
      }
      closeMenu();
      action.onSelect?.();
    },
    [registry, closeMenu],
  );

  // An unfolded group has nothing to show a menu for.
  useEffect(() => {
    if (!folded) closeMenu();
  }, [folded, closeMenu]);

  // The open submenu's action went away (its control unmounted).
  const activeAction = submenu
    ? actions.find((entry) => entry.action.id === submenu)?.action
    : undefined;
  useEffect(() => {
    if (submenu && !activeAction) setSubmenu(null);
  }, [submenu, activeAction]);

  // Close on a press outside the group and the menu. Capture-phase
  // `pointerdown`, like the ··· menu: iOS WebKit sends no mouse events for a
  // tap on plain document canvas, and capture outruns blocks that stop their
  // own presses.
  useEffect(() => {
    if (!open) return;
    const handlePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu();
    };
    document.addEventListener('pointerdown', handlePress, true);
    return () => document.removeEventListener('pointerdown', handlePress, true);
  }, [open, closeMenu]);

  useEscapeDismissal(open, () => closeMenu(), triggerRef);

  // Move focus once the panel it belongs to has rendered and is visible. A
  // host's submenu items arrive a render later, through its portal, so keep
  // trying as the menu's content and placement change.
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const attempt = () => {
      const pick = pendingFocus.current;
      if (!pick) return;
      const target = pick(menu);
      if (!target) return;
      target.focus({ preventScroll: true });
      if (document.activeElement === target) pendingFocus.current = null;
    };
    attempt();
    const observer = new MutationObserver(attempt);
    observer.observe(menu, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'disabled'],
    });
    return () => observer.disconnect();
  }, [open, submenu]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current;
    if (!menu) return;
    const items = [...menu.querySelectorAll<HTMLElement>(ENABLED_ITEM)];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (next: number) => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        focusAt(index + 1);
        break;
      case 'ArrowUp':
        focusAt(index < 0 ? -1 : index - 1);
        break;
      case 'Home':
        focusAt(0);
        break;
      case 'End':
        focusAt(-1);
        break;
      case 'ArrowRight': {
        const id = (document.activeElement as HTMLElement | null)?.dataset.documentAction;
        if (!submenu && id && registry.find(id)?.submenu) {
          event.preventDefault();
          choose(id);
        }
        break;
      }
      case 'ArrowLeft':
        if (submenu) {
          event.preventDefault();
          back();
        }
        break;
      case 'Escape':
        // Escape steps back out of a submenu; at the top level the shared
        // Escape handling closes the menu and refocuses the trigger.
        if (submenu) {
          event.preventDefault();
          event.stopPropagation();
          back();
        }
        break;
      case 'Tab':
        closeMenu();
        break;
    }
  };

  const contextValue = useMemo<DocumentActionsContextValue>(
    () => ({ registry, folded, submenu, submenuContainer, closeMenu, trigger }),
    [registry, folded, submenu, submenuContainer, closeMenu, trigger],
  );

  const showTrigger = folded && actions.length > 0;

  return (
    <div
      ref={rootRef}
      className={`squisq-toolbar-document-actions${folded ? ' squisq-toolbar-document-actions--folded' : ''}`}
      data-toolbar-item={DOCUMENT_ACTIONS_ITEM}
      data-toolbar-folded={folded ? 'true' : 'false'}
      role="group"
      aria-label="Document actions"
    >
      <span className="squisq-toolbar-separator" aria-hidden="true" />
      {showTrigger && (
        <button
          ref={setTriggerElement}
          type="button"
          className={`squisq-toolbar-button squisq-toolbar-document-actions-trigger${open ? ' squisq-toolbar-button--active' : ''}`}
          aria-label="Document actions"
          aria-haspopup="menu"
          aria-expanded={open}
          data-tooltip="Document actions"
          onClick={() => (open ? closeMenu() : openMenu())}
          onKeyDown={(event) => {
            if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              event.preventDefault();
              openMenu();
            }
          }}
        >
          <Icon icon="file-lines" />
          <Icon icon="chevron-down" className="squisq-toolbar-document-actions-chevron" />
        </button>
      )}
      <DocumentActionsContext.Provider value={contextValue}>
        {children}
      </DocumentActionsContext.Provider>
      {open &&
        showTrigger &&
        createPortal(
          <div
            ref={menuRef}
            className="squisq-toolbar-document-menu"
            role="menu"
            aria-label={activeAction ? activeAction.label : 'Document actions'}
            data-theme={colorScheme}
            style={menuStyle}
            onKeyDown={handleMenuKeyDown}
          >
            {activeAction ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="squisq-toolbar-overflow-item squisq-toolbar-document-menu-back"
                  aria-label={`${activeAction.label}: back to document actions`}
                  onClick={back}
                >
                  <span className="squisq-toolbar-overflow-icon">
                    <Icon icon="chevron-left" />
                  </span>
                  <span className="squisq-toolbar-document-menu-label">{activeAction.label}</span>
                </button>
                <div className="squisq-toolbar-document-menu-divider" role="separator" />
                <div
                  ref={setSubmenuContainer}
                  className="squisq-toolbar-document-submenu"
                  role="none"
                />
              </>
            ) : (
              actions.map(({ action }) => (
                <button
                  key={action.id}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="squisq-toolbar-overflow-item"
                  data-document-action={action.id}
                  disabled={action.disabled}
                  aria-haspopup={action.submenu ? 'menu' : undefined}
                  onClick={() => choose(action.id)}
                >
                  <span className="squisq-toolbar-overflow-icon">{action.icon}</span>
                  <span className="squisq-toolbar-document-menu-label">{action.label}</span>
                  {action.submenu && (
                    <Icon icon="chevron-right" className="squisq-toolbar-document-menu-chevron" />
                  )}
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

export interface DocumentActionButtonProps {
  id: string;
  /** Tooltip, accessible name and folded-menu label. */
  label: string;
  /** A chrome glyph name for {@link Icon}. */
  icon: string;
  active?: boolean;
  onSelect: () => void;
}

/** A built-in document action that is a single button: settings, layouts. */
export function DocumentActionButton({
  id,
  label,
  icon,
  active,
  onSelect,
}: DocumentActionButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const { folded } = useToolbarDocumentAction(
    { id, label, icon: <Icon icon={icon} />, onSelect },
    ref,
  );
  return (
    <button
      ref={ref}
      type="button"
      className={`squisq-toolbar-button${active ? ' squisq-toolbar-button--active' : ''}${folded ? ' squisq-toolbar-button--overflowed' : ''}`}
      data-document-action-button={id}
      onClick={onSelect}
      data-tooltip={label}
      aria-label={label}
    >
      <Icon icon={icon} />
    </button>
  );
}
