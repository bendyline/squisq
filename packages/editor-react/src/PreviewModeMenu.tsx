import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditorContext } from './EditorContext';
import { Icon } from './Icon';
import { usePreviewSettings, DISPLAY_MODE_OPTIONS, displayModeLabel } from './PreviewControls';

const USE_MODE_MENU_WIDTH = 340;
const USE_MODE_MENU_GAP = 4;
const USE_MODE_MENU_MARGIN = 8;

/**
 * Dropdown trigger rendered directly beside the Use tab. Selecting a mode
 * also enters the Use view, so the menu works from Write and Source as well
 * as from an already-active preview.
 */
export interface PreviewModeMenuProps {
  /** Incremented by the parent to open the menu from another control. */
  openRequest?: number;
}

export function PreviewModeMenu({ openRequest = 0 }: PreviewModeMenuProps) {
  const s = usePreviewSettings();
  const { allowNarrate, colorScheme, setActiveView } = useEditorContext();
  const options = DISPLAY_MODE_OPTIONS.filter((opt) => opt.key !== 'narrate' || allowNarrate);
  const activeLabel = displayModeLabel(s.activeDisplayMode);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemIdPrefix = useId();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuWidth = Math.min(USE_MODE_MENU_WIDTH, window.innerWidth - USE_MODE_MENU_MARGIN * 2);
    const maxLeft = Math.max(
      USE_MODE_MENU_MARGIN,
      window.innerWidth - menuWidth - USE_MODE_MENU_MARGIN,
    );
    setAnchor({
      top: rect.bottom + USE_MODE_MENU_GAP,
      left: Math.min(Math.max(USE_MODE_MENU_MARGIN, rect.right - menuWidth), maxLeft),
    });
  }, []);

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
    const selected = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]');
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]');
    (selected ?? first)?.focus();
  }, [anchor, open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`squisq-use-mode-trigger${open ? ' squisq-use-mode-trigger--open' : ''}`}
        aria-label="Choose Use mode"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Use mode: ${activeLabel}`}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          openMenu();
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      {open &&
        anchor &&
        createPortal(
          <div
            ref={menuRef}
            className="squisq-use-mode-menu"
            data-theme={colorScheme}
            role="menu"
            aria-label="Use mode"
            style={{ top: anchor.top, left: anchor.left }}
            onKeyDown={(event) => {
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
              const selected = option.key === s.activeDisplayMode;
              const labelId = `${itemIdPrefix}-${option.key}-label`;
              const summaryId = `${itemIdPrefix}-${option.key}-summary`;
              return (
                <button
                  key={option.key}
                  type="button"
                  className={`squisq-use-mode-menu-item${selected ? ' squisq-use-mode-menu-item--selected' : ''}`}
                  role="menuitemradio"
                  aria-checked={selected}
                  aria-labelledby={labelId}
                  aria-describedby={summaryId}
                  onClick={() => {
                    s.setSelectedDisplayMode(option.key);
                    setActiveView('preview');
                    closeMenu(true);
                  }}
                >
                  <span className="squisq-use-mode-menu-icon" aria-hidden="true">
                    <Icon icon={option.icon} />
                  </span>
                  <span className="squisq-use-mode-menu-copy">
                    <span id={labelId} className="squisq-use-mode-menu-label">
                      {option.label}
                    </span>
                    <span id={summaryId} className="squisq-use-mode-menu-summary">
                      {option.summary}
                    </span>
                  </span>
                  <span className="squisq-use-mode-menu-check" aria-hidden="true">
                    {selected && <Icon icon="fa-solid fa-check" />}
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
