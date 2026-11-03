/**
 * The ▾ button beside a view tab and the menu of modes it opens. The Write tab
 * (Write / Blocks / Timeline) and the Use tab (Slideshow, Page, …) share it, so
 * the two menus look and behave the same.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useEditorContext } from '../EditorContext';
import { Icon } from '../Icon';

const VIEW_MODE_MENU_WIDTH = 340;
const VIEW_MODE_MENU_GAP = 4;
const VIEW_MODE_MENU_MARGIN = 8;

export interface ViewModeOption<K extends string> {
  key: K;
  label: string;
  /** Font Awesome class string or chrome glyph name (see {@link Icon}). */
  icon: string;
  /** One line under the label saying what the mode is for. */
  summary: string;
}

export interface ViewModeMenuProps<K extends string> {
  /** Names the menu (`"Use mode"`); the trigger is labelled `"Choose <label>"`. */
  label: string;
  options: readonly ViewModeOption<K>[];
  selected: K;
  onSelect: (key: K) => void;
  /** Incremented by the parent to open the menu from another control. */
  openRequest?: number;
  /**
   * Lines the menu's left edge up with this element — the tab the menu
   * belongs to. Without it the menu's right edge lines up with the trigger's.
   */
  alignWith?: RefObject<HTMLElement | null>;
}

export function ViewModeMenu<K extends string>({
  label,
  options,
  selected,
  onSelect,
  openRequest = 0,
  alignWith,
}: ViewModeMenuProps<K>) {
  const { colorScheme } = useEditorContext();
  const activeLabel = options.find((option) => option.key === selected)?.label ?? '';
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemIdPrefix = useId();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const alignRect = alignWith?.current?.getBoundingClientRect();
    const menuWidth = Math.min(VIEW_MODE_MENU_WIDTH, window.innerWidth - VIEW_MODE_MENU_MARGIN * 2);
    const maxLeft = Math.max(
      VIEW_MODE_MENU_MARGIN,
      window.innerWidth - menuWidth - VIEW_MODE_MENU_MARGIN,
    );
    const left = alignRect ? alignRect.left : rect.right - menuWidth;
    setAnchor({
      top: rect.bottom + VIEW_MODE_MENU_GAP,
      left: Math.min(Math.max(VIEW_MODE_MENU_MARGIN, left), maxLeft),
    });
  }, [alignWith]);

  const closeMenu = useCallback((restoreFocus = false) => {
    setOpen(false);
    setAnchor(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(() => {
    updatePosition();
    setOpen(true);
  }, [updatePosition]);

  useEffect(() => {
    if (openRequest > 0) openMenu();
  }, [openMenu, openRequest]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const eventPath = event.composedPath();
      if (
        (triggerRef.current && eventPath.includes(triggerRef.current)) ||
        (menuRef.current && eventPath.includes(menuRef.current))
      ) {
        return;
      }
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMenu(true);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [closeMenu, open, updatePosition]);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const checked = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]');
    (checked ?? first)?.focus();
  }, [anchor, open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`squisq-view-mode-trigger${open ? ' squisq-view-mode-trigger--open' : ''}`}
        aria-label={`Choose ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${label}: ${activeLabel}`}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          openMenu();
        }}
      >
        {/* The face is the visible button; the trigger around it is the
            (larger) click and touch target. */}
        <span className="squisq-view-mode-trigger-face">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </span>
      </button>
      {open &&
        anchor &&
        createPortal(
          <div
            ref={menuRef}
            className="squisq-view-mode-menu"
            data-theme={colorScheme}
            role="menu"
            aria-label={label}
            style={{ top: anchor.top, left: anchor.left }}
            onKeyDown={(event) => {
              if (event.key === 'Tab') {
                closeMenu(true);
                return;
              }
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const items = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="menuitemradio"]:not(:disabled), [role="menuitem"]:not(:disabled)',
                ),
              );
              if (items.length === 0) return;
              const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
              const nextIndex =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : event.key === 'ArrowUp'
                      ? (currentIndex - 1 + items.length) % items.length
                      : (currentIndex + 1) % items.length;
              items[nextIndex]?.focus();
            }}
          >
            {options.map((option) => {
              const isSelected = option.key === selected;
              const labelId = `${itemIdPrefix}-${option.key}-label`;
              const summaryId = `${itemIdPrefix}-${option.key}-summary`;
              return (
                <button
                  key={option.key}
                  type="button"
                  className={`squisq-view-mode-menu-item${isSelected ? ' squisq-view-mode-menu-item--selected' : ''}`}
                  role="menuitemradio"
                  tabIndex={-1}
                  aria-checked={isSelected}
                  aria-labelledby={labelId}
                  aria-describedby={summaryId}
                  onClick={() => {
                    onSelect(option.key);
                    closeMenu(true);
                  }}
                >
                  <span className="squisq-view-mode-menu-icon" aria-hidden="true">
                    <Icon icon={option.icon} />
                  </span>
                  <span className="squisq-view-mode-menu-copy">
                    <span id={labelId} className="squisq-view-mode-menu-label">
                      {option.label}
                    </span>
                    <span id={summaryId} className="squisq-view-mode-menu-summary">
                      {option.summary}
                    </span>
                  </span>
                  <span className="squisq-view-mode-menu-check" aria-hidden="true">
                    {isSelected && <Icon icon="fa-solid fa-check" />}
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
