/**
 * ViewMenu — the toolbar's one view control.
 *
 * The toolbar shows only the active view: a button with its icon and name
 * (Write, Source, Blocks, Slideshow, …) and a ▾. The button opens the View
 * menu, which has three columns:
 *
 * - **Navigation** (left) — the host's own navigation panes, such as a file
 *   sidebar, from `navigation` (`EditorShell`'s `viewMenuNavigation`), then
 *   the Outline pane. Top to bottom follows the screen left to right: the
 *   host's panes sit outside the editor, beside its Outline.
 * - **Views** (middle) — every view, under **Edit** (Write, Source, Blocks,
 *   Timeline, Summaries) and **Use** (Slideshow, Flashcards, …). Each group
 *   checks its own mode, the one Ctrl/Cmd+Shift+1/2/3 returns to; the view on
 *   screen is highlighted. Choosing one enters it and closes the menu.
 * - **Panes** (right) — Block previews and the status bar, when block tags
 *   show, and the spelling & grammar check.
 *
 * Each column's first heading carries a small page-in-three-columns glyph with
 * the part of the screen that column governs outlined.
 *
 * Toggles leave the menu open, so several can be changed in one visit. Up and
 * Down move within a column, Left and Right between columns.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useEditorContext, type BlockTagVisibility } from './EditorContext';
import { DISPLAY_MODE_OPTIONS, usePreviewSettingsOptional } from './PreviewControls';
import { Icon } from './Icon';
import { useEscapeDismissal } from './useEscapeDismissal';
import { useProofingState } from './proofing/ProofingContext';
import { WRITE_MENU_OPTIONS, type ViewModeOption, type WriteMenuKey } from './writeModes';

/** One host navigation pane the View menu can show or hide. */
export interface ViewMenuToggleItem {
  /** Stable key for the row. */
  id: string;
  /** The row's label, such as `"Files"`. */
  label: string;
  /** Whether the pane is showing. */
  checked: boolean;
  /** Called when the row is chosen; the host flips the pane. */
  onToggle: () => void;
  disabled?: boolean;
}

export interface ViewMenuProps {
  /** List the Edit views (Write, Source, Blocks, Timeline, Summaries). */
  showEditViews?: boolean;
  /** List the Use views (Slideshow, Flashcards, …). Needs a preview-settings provider. */
  showUseViews?: boolean;
  /** The host's navigation panes, listed in the left column before the Outline. */
  navigation?: readonly ViewMenuToggleItem[];
  /**
   * `'view'` is the button named after the active view; `'button'` is an icon
   * button, for a toolbar that offers no views to switch to (the menu then
   * lists only the panes).
   */
  variant?: 'view' | 'button';
  /** Incremented by the parent to open the menu from another control. */
  openRequest?: number;
  /** Lines the menu's left edge up with this element instead of the button. */
  alignWith?: RefObject<HTMLElement | null>;
}

const MENU_GAP = 4;
const MENU_MARGIN = 8;
const HIDDEN_STYLE: CSSProperties = { position: 'fixed', top: 0, left: 0, visibility: 'hidden' };

/**
 * Use, when there is no preview-settings provider to list its modes: one entry
 * that enters it, as the Use tab did.
 */
const USE_OPTION: ViewModeOption<'use'> = {
  key: 'use',
  label: 'Use',
  icon: 'fa-solid fa-images',
  summary: 'See the finished document.',
  view: 'preview',
};

type UseMenuKey = (typeof DISPLAY_MODE_OPTIONS)[number]['key'] | 'use';

const BLOCK_TAG_OPTIONS: readonly { value: BlockTagVisibility; label: string }[] = [
  { value: 'none', label: 'No inline block tags' },
  { value: 'active', label: 'Selected/hovered block' },
  { value: 'always', label: 'Always show' },
];

export function ViewMenu({
  showEditViews = false,
  showUseViews = false,
  navigation,
  variant = 'view',
  openRequest = 0,
  alignWith,
}: ViewMenuProps) {
  const {
    colorScheme,
    activeView,
    editingView,
    setActiveView,
    layoutMode,
    setLayoutMode,
    allowNarrate,
    outlineVisible,
    setOutlineVisible,
    inlinePreviewVisible,
    setInlinePreviewVisible,
    statusBarVisible,
    setStatusBarVisible,
    blockTagVisibility,
    setBlockTagVisibility,
  } = useEditorContext();
  const previewSettings = usePreviewSettingsOptional();
  const proofingState = useProofingState();
  const idPrefix = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  // A view chosen in a keyboard flow — the menu opened from the keyboard, or
  // the view picked with it — returns focus to the view button, as a menu
  // button does. Opened and picked with the pointer, it leaves the button
  // alone: focus left there drew the keyboard focus ring at the first key
  // press (the arrows that drive Narrate, say), and Space reopened this menu
  // instead of reaching the view. A keyboard-activated click has detail 0.
  const openedByKeyboardRef = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>(HIDDEN_STYLE);

  const editOptions = showEditViews ? WRITE_MENU_OPTIONS : [];
  const useOptions: ViewModeOption<UseMenuKey>[] = !showUseViews
    ? []
    : previewSettings
      ? DISPLAY_MODE_OPTIONS.filter((option) => option.key !== 'narrate' || allowNarrate)
      : [USE_OPTION];
  const editSelected: WriteMenuKey = editingView === 'raw' ? 'source' : layoutMode;
  const useSelected: UseMenuKey = previewSettings?.activeDisplayMode ?? 'use';
  const activeGroup = activeView === 'preview' ? 'use' : 'edit';
  const navigationItems = navigation ?? [];

  // What the view button shows: the view on screen.
  const editShown =
    WRITE_MENU_OPTIONS.find((option) => option.key === editSelected) ?? WRITE_MENU_OPTIONS[0]!;
  const useShown = DISPLAY_MODE_OPTIONS.find((option) => option.key === useSelected);
  const shown =
    activeGroup === 'use'
      ? {
          label: useShown?.label ?? 'Use',
          shortLabel: useShown?.shortLabel,
          icon: useShown?.icon ?? 'fa-solid fa-images',
        }
      : { label: editShown.label, shortLabel: undefined, icon: editShown.icon };

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setMenuStyle(HIDDEN_STYLE);
    if (restoreFocus) {
      triggerRef.current?.focus({ preventScroll: true });
    } else if (menuRef.current?.contains(document.activeElement)) {
      // Nothing inside a closed menu should keep focus.
      (document.activeElement as HTMLElement).blur();
    }
  }, []);

  const dismiss = useCallback(() => close(), [close]);
  useEscapeDismissal(open, dismiss, triggerRef);

  useEffect(() => {
    if (openRequest > 0) {
      openedByKeyboardRef.current = false;
      setOpen(true);
    }
  }, [openRequest]);

  // Hang the menu below the button — above it when the toolbar sits at the
  // bottom and there is more room there — its left edge on the view button,
  // or its right edge on an icon button, kept inside the window.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const rect = trigger.getBoundingClientRect();
      const width = menu.offsetWidth;
      const below = Math.max(0, window.innerHeight - rect.bottom - MENU_GAP - MENU_MARGIN);
      const above = Math.max(0, rect.top - MENU_GAP - MENU_MARGIN);
      const flip = menu.scrollHeight > below && above > below;
      const height = Math.min(menu.scrollHeight + 2, flip ? above : below);
      const alignRect = alignWith?.current?.getBoundingClientRect();
      const preferredLeft = alignRect
        ? alignRect.left
        : variant === 'button'
          ? rect.right - width
          : rect.left;
      const maxLeft = Math.max(MENU_MARGIN, window.innerWidth - width - MENU_MARGIN);
      setMenuStyle({
        position: 'fixed',
        visibility: 'visible',
        left: Math.min(Math.max(MENU_MARGIN, preferredLeft), maxLeft),
        top: flip ? rect.top - MENU_GAP - height : rect.bottom + MENU_GAP,
        maxHeight: height,
      });
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      place();
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    // A host pane docking or undocking — a file sidebar toggled from this very
    // menu, which stays open — moves the button without resizing the window.
    // The toolbar around it resizes, so follow that.
    const trigger = triggerRef.current;
    const toolbar = trigger?.closest<HTMLElement>('.squisq-toolbar') ?? trigger?.parentElement;
    const observer =
      toolbar && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    if (toolbar) observer?.observe(toolbar);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
      observer?.disconnect();
    };
  }, [open, alignWith, variant]);

  // Focus the view on screen once the menu is placed; the first row otherwise.
  const placed = open && menuStyle.visibility === 'visible';
  useLayoutEffect(() => {
    if (!placed) return;
    const menu = menuRef.current;
    const current = menu?.querySelector<HTMLButtonElement>('[data-view-menu-current="true"]');
    const first = menu?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)');
    (current ?? first)?.focus({ preventScroll: true });
  }, [placed]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const path = event.composedPath();
      if (
        (triggerRef.current && path.includes(triggerRef.current)) ||
        (menuRef.current && path.includes(menuRef.current))
      ) {
        return;
      }
      close();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [close, open]);

  // A view chosen in a keyboard flow (see openedByKeyboardRef) returns focus
  // to the view button; one chosen with the pointer leaves it alone.
  const chooseEditView = (key: WriteMenuKey, pickedByKeyboard: boolean) => {
    if (key === 'source') {
      setActiveView('raw');
    } else {
      setLayoutMode(key);
      setActiveView('wysiwyg');
    }
    close(pickedByKeyboard || openedByKeyboardRef.current);
  };

  const chooseUseView = (key: UseMenuKey, pickedByKeyboard: boolean) => {
    if (key !== 'use') previewSettings?.setSelectedDisplayMode(key);
    setActiveView('preview');
    close(pickedByKeyboard || openedByKeyboardRef.current);
  };

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const columns = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[data-view-menu-column]'),
    )
      .map((column) =>
        Array.from(column.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')),
      )
      .filter((items) => items.length > 0);
    if (columns.length === 0) return;
    const focused = document.activeElement as HTMLButtonElement | null;
    const columnIndex = columns.findIndex((items) => focused && items.includes(focused));
    if (columnIndex < 0) {
      columns[0]![0]!.focus();
      return;
    }
    const items = columns[columnIndex]!;
    const row = items.indexOf(focused!);
    let next: HTMLButtonElement | undefined;
    switch (event.key) {
      case 'ArrowDown':
        next = items[(row + 1) % items.length];
        break;
      case 'ArrowUp':
        next = items[(row - 1 + items.length) % items.length];
        break;
      case 'Home':
        next = items[0];
        break;
      case 'End':
        next = items[items.length - 1];
        break;
      default: {
        const step = event.key === 'ArrowRight' ? 1 : -1;
        const target = columns[(columnIndex + step + columns.length) % columns.length]!;
        next = target[Math.min(row, target.length - 1)];
      }
    }
    next?.focus();
  };

  const toggleOpen = (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (open) return close();
    openedByKeyboardRef.current = event.detail === 0;
    setOpen(true);
  };
  const openFromKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    openedByKeyboardRef.current = true;
    setOpen(true);
  };

  const trigger =
    variant === 'button' ? (
      <button
        ref={triggerRef}
        type="button"
        className={`squisq-toolbar-button squisq-view-menu-trigger${open ? ' squisq-toolbar-button--active' : ''}`}
        aria-label="View"
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip="View"
        onClick={toggleOpen}
        onKeyDown={openFromKeyboard}
      >
        <Icon icon="fa-solid fa-eye" />
      </button>
    ) : (
      <button
        ref={triggerRef}
        type="button"
        className={`squisq-toolbar-view-button${open ? ' squisq-toolbar-view-button--open' : ''}`}
        data-active-view={activeView}
        // Names the control and keeps the visible view name in it.
        aria-label={`View: ${shown.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip="Choose a view"
        onClick={toggleOpen}
        onKeyDown={openFromKeyboard}
      >
        <span className="squisq-toolbar-view-button-icon" aria-hidden="true">
          <Icon icon={shown.icon} />
        </span>
        <span
          className="squisq-toolbar-view-button-label squisq-toolbar-view-button-label--long"
          aria-hidden="true"
        >
          {shown.label}
        </span>
        {shown.shortLabel && shown.shortLabel !== shown.label && (
          <span
            className="squisq-toolbar-view-button-label squisq-toolbar-view-button-label--short"
            aria-hidden="true"
          >
            {shown.shortLabel}
          </span>
        )}
        <svg
          className="squisq-toolbar-view-button-chevron"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden="true"
        >
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
    );

  const hasViews = editOptions.length > 0 || useOptions.length > 0;

  return (
    <>
      {trigger}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="squisq-view-mode-menu squisq-view-menu-columns"
            data-theme={colorScheme}
            role="menu"
            aria-label="View"
            style={menuStyle}
            onKeyDown={onMenuKeyDown}
          >
            <MenuColumn kind="navigation">
              <MenuSection id={`${idPrefix}-navigation`} heading="Navigation" region="navigation">
                {navigationItems.map((item) => (
                  <MenuToggle
                    key={item.id}
                    label={item.label}
                    checked={item.checked}
                    disabled={item.disabled}
                    onChange={item.onToggle}
                  />
                ))}
                <MenuToggle
                  label="Outline"
                  checked={outlineVisible}
                  onChange={() => setOutlineVisible(!outlineVisible)}
                />
              </MenuSection>
            </MenuColumn>
            {hasViews && (
              <MenuColumn kind="views">
                {editOptions.length > 0 && (
                  <MenuSection id={`${idPrefix}-edit`} heading="Edit" region="views">
                    {editOptions.map((option) => (
                      <ViewItem
                        key={option.key}
                        idPrefix={`${idPrefix}-edit`}
                        option={option}
                        checked={option.key === editSelected}
                        current={activeGroup === 'edit' && option.key === editSelected}
                        onSelect={(event) => chooseEditView(option.key, event.detail === 0)}
                      />
                    ))}
                  </MenuSection>
                )}
                {useOptions.length > 0 && (
                  <MenuSection
                    id={`${idPrefix}-use`}
                    heading="Use"
                    region={editOptions.length > 0 ? undefined : 'views'}
                  >
                    {useOptions.map((option) => (
                      <ViewItem
                        key={option.key}
                        idPrefix={`${idPrefix}-use`}
                        option={{ ...option, view: 'preview' }}
                        checked={option.key === useSelected}
                        current={activeGroup === 'use' && option.key === useSelected}
                        onSelect={(event) => chooseUseView(option.key, event.detail === 0)}
                      />
                    ))}
                  </MenuSection>
                )}
              </MenuColumn>
            )}
            <MenuColumn kind="panes">
              <MenuSection id={`${idPrefix}-panes`} heading="Panes" region="panes">
                <MenuToggle
                  label="Block previews"
                  checked={inlinePreviewVisible}
                  onChange={() => setInlinePreviewVisible(!inlinePreviewVisible)}
                />
                <MenuToggle
                  label="Status bar"
                  checked={statusBarVisible}
                  onChange={() => setStatusBarVisible(!statusBarVisible)}
                />
              </MenuSection>
              <MenuSection id={`${idPrefix}-block-tags`} heading="Show block tags">
                {BLOCK_TAG_OPTIONS.map((option) => (
                  <MenuRadio
                    key={option.value}
                    label={option.label}
                    checked={blockTagVisibility === option.value}
                    onChange={() => setBlockTagVisibility(option.value)}
                  />
                ))}
              </MenuSection>
              {proofingState && (
                <MenuSection id={`${idPrefix}-proofing`} heading="Proofing">
                  <MenuToggle
                    label="Check spelling & grammar"
                    checked={proofingState.enabled}
                    onChange={() => proofingState.setEnabled(!proofingState.enabled)}
                  />
                </MenuSection>
              )}
            </MenuColumn>
          </div>,
          triggerRef.current?.closest('[role="dialog"][aria-modal="true"]') ?? document.body,
        )}
    </>
  );
}

function MenuColumn({ kind, children }: { kind: MenuColumnKind; children: ReactNode }) {
  return (
    <div
      className={`squisq-view-menu-column squisq-view-menu-column--${kind}`}
      data-view-menu-column={kind}
      role="none"
    >
      {children}
    </div>
  );
}

function MenuSection({
  id,
  heading,
  region,
  children,
}: {
  id: string;
  heading: string;
  /** Marks the column's first section with the part of the screen it governs. */
  region?: MenuColumnKind;
  children: ReactNode;
}) {
  return (
    <div className="squisq-view-menu-section" role="group" aria-labelledby={id}>
      <div id={id} className="squisq-view-menu-heading" role="presentation">
        {region && <ColumnGlyph region={region} />}
        {heading}
      </div>
      {children}
    </div>
  );
}

type MenuColumnKind = 'navigation' | 'views' | 'panes';

/**
 * The editor as a page in three columns — narrow, wide, narrow — with the part
 * a menu column governs outlined: Navigation the left pane, the views the
 * middle, Panes the right. Drawn on a 1px grid so its strokes stay crisp.
 */
const COLUMN_GLYPH_REGIONS: Record<MenuColumnKind, string> = {
  navigation: 'M5.5 0.5H2.5A2 2 0 0 0 0.5 2.5V11.5A2 2 0 0 0 2.5 13.5H5.5Z',
  views: 'M5.5 0.5H14.5V13.5H5.5Z',
  panes: 'M14.5 0.5H17.5A2 2 0 0 1 19.5 2.5V11.5A2 2 0 0 1 17.5 13.5H14.5Z',
};

function ColumnGlyph({ region }: { region: MenuColumnKind }) {
  return (
    <svg
      className="squisq-view-menu-glyph"
      data-region={region}
      width="20"
      height="14"
      viewBox="0 0 20 14"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="squisq-view-menu-glyph-page" x="0.5" y="0.5" width="19" height="13" rx="2" />
      <path className="squisq-view-menu-glyph-page" d="M5.5 0.5V13.5M14.5 0.5V13.5" />
      <path className="squisq-view-menu-glyph-region" d={COLUMN_GLYPH_REGIONS[region]} />
    </svg>
  );
}

function ViewItem<K extends string>({
  idPrefix,
  option,
  checked,
  current,
  onSelect,
}: {
  idPrefix: string;
  option: ViewModeOption<K>;
  checked: boolean;
  /** The view on screen, as opposed to the mode the other tab returns to. */
  current: boolean;
  onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  const labelId = `${idPrefix}-${option.key}-label`;
  const summaryId = `${idPrefix}-${option.key}-summary`;
  return (
    <button
      type="button"
      className={`squisq-view-mode-menu-item squisq-view-menu-view${current ? ' squisq-view-mode-menu-item--selected' : ''}`}
      role="menuitemradio"
      data-view={option.view}
      data-view-menu-current={current ? 'true' : undefined}
      tabIndex={-1}
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={summaryId}
      title={option.summary}
      onClick={onSelect}
    >
      <span className="squisq-view-mode-menu-icon" aria-hidden="true">
        <Icon icon={option.icon} />
      </span>
      <span className="squisq-view-mode-menu-copy">
        <span id={labelId} className="squisq-view-mode-menu-label">
          {option.label}
        </span>
        <span id={summaryId} className="squisq-view-menu-view-summary">
          {option.summary}
        </span>
      </span>
      <span className="squisq-view-mode-menu-check" aria-hidden="true">
        {checked && <Icon icon="fa-solid fa-check" />}
      </span>
    </button>
  );
}

function MenuToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className="squisq-view-menu-row"
      role="menuitemcheckbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
    >
      <span className="squisq-view-menu-checkbox" aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
      <span className="squisq-view-menu-label">{label}</span>
    </button>
  );
}

function MenuRadio({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      className="squisq-view-menu-row squisq-view-menu-radio-row"
      role="menuitemradio"
      aria-checked={checked}
      onClick={onChange}
    >
      {/* The selected dot is drawn by CSS (keyed off aria-checked), not a
          "●" glyph — a glyph sits on the font's baseline, so it renders
          off-center and at whatever size the fallback font gives it. */}
      <span className="squisq-view-menu-radio" aria-hidden="true" />
      <span className="squisq-view-menu-radio-label">{label}</span>
    </button>
  );
}
