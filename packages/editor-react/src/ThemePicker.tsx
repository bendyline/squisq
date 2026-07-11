/**
 * ThemePicker
 *
 * Custom theme dropdown that replaces a plain `<select>` with a popover
 * showing each theme as a card: the theme name rendered in the theme's
 * own background / foreground / title font, plus three color swatches
 * (primary, secondary, highlight). Used by both the play-mode preview
 * toolbar and the Document Settings dialog so authors see a
 * preview-on-hover style listing rather than a wall of names.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getThemeSummaries,
  resolveTheme,
  resolveFontFamily,
  FONT_FALLBACKS,
} from '@bendyline/squisq/schemas';
import type { Theme } from '@bendyline/squisq/schemas';

// ── Props ─────────────────────────────────────────────────────────

export interface ThemePickerProps {
  /** Currently selected theme id. Empty string represents "default". */
  value: string;
  /** Called with the new theme id. The empty string is emitted when the
   *  user picks the "Default" option (only available with
   *  `includeDefault`). */
  onChange: (id: string) => void;
  /**
   * Show a "Default" entry at the top of the popover that emits an empty
   * string. Used by the Document Settings dialog so the user can choose
   * "no explicit theme" (frontmatter omits the key entirely).
   */
  includeDefault?: boolean;
  /**
   * `'compact'` (default) renders a small toolbar trigger; `'full'`
   * stretches to fill the parent and is sized for dialog layouts.
   */
  variant?: 'compact' | 'full';
  /** Accessible label, e.g. "Theme". */
  ariaLabel?: string;
  /**
   * User-authored themes to list in a "Custom" group (doc + library, from
   * `useCustomThemes().allThemes`). When omitted, only built-ins show — so
   * the base-theme picker and other embeds stay built-ins only.
   */
  customThemes?: Theme[];
  /** When provided, renders a "+ Create custom theme" row that calls this. */
  onCreateCustom?: () => void;
  /** Per-custom-card edit affordance (opens the designer for that theme). */
  onEditCustom?: (id: string) => void;
  /** Per-custom-card delete affordance. */
  onDeleteCustom?: (id: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────

const SUMMARIES = getThemeSummaries();

interface ThemeEntry {
  id: string;
  name: string;
  description?: string;
  theme: Theme;
}

const THEME_ENTRIES: ThemeEntry[] = SUMMARIES.map((s) => ({
  id: s.id,
  name: s.name,
  description: s.description,
  theme: resolveTheme(s.id),
}));

function entryById(id: string): ThemeEntry | undefined {
  return THEME_ENTRIES.find((e) => e.id === id);
}

function previewFont(theme: Theme): string {
  return resolveFontFamily(theme.typography.titleFont, FONT_FALLBACKS.sans);
}

// ── Trigger button ────────────────────────────────────────────────

function ThemeNameChip({
  theme,
  label,
  className,
}: {
  theme: Theme;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={`squisq-theme-picker-name-chip${className ? ` ${className}` : ''}`}
      style={{
        background: theme.colors.background,
        color: theme.colors.text,
        fontFamily: previewFont(theme),
        borderColor: theme.colors.backgroundLight,
      }}
    >
      {label}
    </span>
  );
}

function Swatches({ theme }: { theme: Theme }) {
  return (
    <span className="squisq-theme-picker-swatches" aria-hidden="true">
      <span className="squisq-theme-picker-swatch" style={{ background: theme.colors.primary }} />
      <span className="squisq-theme-picker-swatch" style={{ background: theme.colors.secondary }} />
      <span className="squisq-theme-picker-swatch" style={{ background: theme.colors.highlight }} />
    </span>
  );
}

// ── Component ─────────────────────────────────────────────────────

export function ThemePicker({
  value,
  onChange,
  includeDefault,
  variant = 'compact',
  ariaLabel = 'Theme',
  customThemes,
  onCreateCustom,
  onEditCustom,
  onDeleteCustom,
}: ThemePickerProps) {
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = `squisq-theme-picker-popover-${useId().replace(/:/g, '')}`;

  // Custom entries are computed per-render (built-ins stay static at module
  // load). A custom theme is already a full Theme, so it becomes an entry
  // directly — no `resolveTheme` needed.
  const customEntries = useMemo<ThemeEntry[]>(
    () =>
      (customThemes ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        theme: t,
      })),
    [customThemes],
  );
  const findEntry = useCallback(
    (id: string): ThemeEntry | undefined => entryById(id) ?? customEntries.find((e) => e.id === id),
    [customEntries],
  );

  const selectedEntry = useMemo<ThemeEntry | null>(() => {
    if (!value) return null;
    return findEntry(value) ?? null;
  }, [value, findEntry]);

  // The trigger always wants *something* to preview. When `includeDefault`
  // is on and the value is empty, we treat the selection as the implicit
  // "Default" — the chip uses plain OS styling (white bg, dark text,
  // italic) rather than the standard theme's actual dark-navy palette.
  const isDefault = !selectedEntry && includeDefault === true;
  const previewEntry = selectedEntry ?? entryById('standard') ?? THEME_ENTRIES[0];
  const triggerLabel = selectedEntry
    ? selectedEntry.name
    : includeDefault
      ? 'Default'
      : (previewEntry?.name ?? 'Theme');

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Aim for a multi-column popover, but never wider than the viewport.
    // The CSS grid packs as many theme cards per row as this width allows,
    // so clamping to the available width makes a narrow window collapse to
    // fewer columns (down to one) instead of overrunning the edge.
    const available = vw - margin * 2;
    const popoverWidth = Math.min(available, Math.max(560, rect.width));
    const maxLeft = Math.max(margin, vw - popoverWidth - margin);
    const left = Math.min(Math.max(margin, rect.left), maxLeft);

    // Measure the rendered popover so we know whether it fits below the
    // trigger as-is. On the first open it doesn't exist yet — we'll
    // re-run after mount via the requestAnimationFrame in the open
    // effect, so estimate generously for paint #1.
    const popoverEl = popoverRef.current;
    const measured = popoverEl?.scrollHeight ?? 520;
    const spaceBelow = vh - rect.bottom - margin - gap;
    const spaceAbove = rect.top - margin - gap;

    // Prefer below when it fits; flip above when below is too tight AND
    // above has more room. Either way, clamp maxHeight to the available
    // space so the internal scroll handles oversized lists.
    let top: number;
    let maxHeight: number;
    if (measured <= spaceBelow || spaceBelow >= spaceAbove) {
      top = rect.bottom + gap;
      maxHeight = spaceBelow;
    } else {
      maxHeight = Math.min(measured, spaceAbove);
      top = rect.top - gap - maxHeight;
    }

    setPopoverStyle({
      position: 'fixed',
      top,
      left,
      width: popoverWidth,
      maxHeight,
      overflowY: 'auto',
      zIndex: 9999,
    });
  }, []);

  const handleToggle = () => {
    if (!open) updatePosition();
    setOpen((v) => !v);
  };

  // Close on outside click / Esc; reposition on scroll/resize while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      const popoverEl = popoverRef.current;
      if (popoverEl?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onReposition = () => updatePosition();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    requestAnimationFrame(updatePosition);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [open, updatePosition]);

  const handleSelect = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const popover = open
    ? createPortal(
        <div
          ref={popoverRef}
          id={popoverId}
          className="squisq-theme-picker-popover"
          role="listbox"
          aria-label={ariaLabel}
          style={popoverStyle}
        >
          {includeDefault && (
            <button
              type="button"
              role="option"
              aria-selected={value === ''}
              aria-label="Default"
              className={`squisq-theme-picker-row${value === '' ? ' squisq-theme-picker-row--selected' : ''}`}
              onClick={() => handleSelect('')}
            >
              <ThemeNameChip
                theme={resolveTheme('standard')}
                label="Default"
                className="squisq-theme-picker-name-chip--default"
              />
              <span className="squisq-theme-picker-row-meta">
                <span className="squisq-theme-picker-row-name">No explicit theme</span>
                <span className="squisq-theme-picker-row-desc">
                  Uses the document&apos;s default styling.
                </span>
              </span>
            </button>
          )}
          {THEME_ENTRIES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="option"
              aria-selected={value === entry.id}
              aria-label={entry.name}
              className={`squisq-theme-picker-row${value === entry.id ? ' squisq-theme-picker-row--selected' : ''}`}
              onClick={() => handleSelect(entry.id)}
              title={entry.description ?? entry.name}
            >
              <ThemeNameChip theme={entry.theme} label={entry.name} />
              <span className="squisq-theme-picker-row-meta">
                <Swatches theme={entry.theme} />
                {entry.description && (
                  <span className="squisq-theme-picker-row-desc">{entry.description}</span>
                )}
              </span>
            </button>
          ))}
          {customEntries.length > 0 && (
            <div className="squisq-theme-picker-group-label">Custom</div>
          )}
          {customEntries.map((entry) => (
            <div key={entry.id} className="squisq-theme-picker-custom-wrap">
              <button
                type="button"
                role="option"
                aria-selected={value === entry.id}
                aria-label={entry.name}
                className={`squisq-theme-picker-row${value === entry.id ? ' squisq-theme-picker-row--selected' : ''}`}
                onClick={() => handleSelect(entry.id)}
                title={entry.description ?? entry.name}
              >
                <ThemeNameChip theme={entry.theme} label={entry.name} />
                <span className="squisq-theme-picker-row-meta">
                  <Swatches theme={entry.theme} />
                  {entry.description && (
                    <span className="squisq-theme-picker-row-desc">{entry.description}</span>
                  )}
                </span>
              </button>
              {(onEditCustom || onDeleteCustom) && (
                <span className="squisq-theme-picker-card-actions">
                  {onEditCustom && (
                    <button
                      type="button"
                      className="squisq-theme-picker-card-action"
                      onClick={() => onEditCustom(entry.id)}
                      aria-label={`Edit ${entry.name}`}
                      title="Edit theme"
                    >
                      ✎
                    </button>
                  )}
                  {onDeleteCustom && (
                    <button
                      type="button"
                      className="squisq-theme-picker-card-action"
                      onClick={() => onDeleteCustom(entry.id)}
                      aria-label={`Delete ${entry.name}`}
                      title="Delete theme"
                    >
                      ×
                    </button>
                  )}
                </span>
              )}
            </div>
          ))}
          {onCreateCustom && (
            <button
              type="button"
              className="squisq-theme-picker-row squisq-theme-picker-create"
              onClick={() => {
                setOpen(false);
                onCreateCustom();
              }}
            >
              <span className="squisq-theme-picker-create-plus" aria-hidden="true">
                +
              </span>
              <span className="squisq-theme-picker-row-meta">
                <span className="squisq-theme-picker-row-name">Create custom theme…</span>
                <span className="squisq-theme-picker-row-desc">
                  Design your own colors, accents, and fonts.
                </span>
              </span>
            </button>
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`squisq-theme-picker-trigger squisq-theme-picker-trigger--${variant}${
          open ? ' squisq-theme-picker-trigger--open' : ''
        }`}
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={ariaLabel}
      >
        {previewEntry && (
          <ThemeNameChip
            theme={previewEntry.theme}
            label={triggerLabel}
            className={`squisq-theme-picker-name-chip--trigger${
              isDefault ? ' squisq-theme-picker-name-chip--default' : ''
            }`}
          />
        )}
        {previewEntry && variant === 'full' && !isDefault && (
          <Swatches theme={previewEntry.theme} />
        )}
        <svg
          className="squisq-theme-picker-caret"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          aria-hidden="true"
        >
          <path
            d="M2 3.5l3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </button>
      {popover}
    </>
  );
}
