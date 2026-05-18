/**
 * EmojiPicker
 *
 * Toolbar-anchored popover for inserting emoji. The user picks a
 * category from a row of tabs along the top, sees a scrollable grid
 * for that category, and can type into a search box to narrow across
 * all categories at once. Click → `onSelect(char)` → caller is
 * responsible for routing the character into the active editor.
 *
 * Keeps the data flat and the rendering simple: there's no fuzzy
 * search, no recently-used persistence, no skin-tone modifiers — just
 * a fast, predictable picker. We can layer those on later without
 * changing the public surface.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { PICKER_CATEGORIES, searchPickerEntries } from './emojiData';
import type { PickerEntry } from './emojiData';

export interface EmojiPickerProps {
  /** Whether the picker is visible. */
  open: boolean;
  /**
   * Fired when the user picks an entry. Carries either an emoji glyph
   * or a FontAwesome icon descriptor — the caller dispatches on
   * `kind` to insert it into the active editor. The caller is also
   * responsible for closing the popover.
   */
  onSelect: (entry: PickerEntry) => void;
  /** Fired on Escape, click-outside, or selection so the caller can close. */
  onClose: () => void;
  /** Optional anchor element — used for click-outside detection. When the
   *  popover is rendered inside the same container as the trigger, pointer
   *  events on the trigger don't fire the outside handler. */
  anchorRef?: React.RefObject<HTMLElement>;
  /** Optional CSS class for the popover root. */
  className?: string;
  /** Optional inline style for the popover root (e.g. positioning). */
  style?: CSSProperties;
  /**
   * Editor theme — `'light'` or `'dark'`. Drives the picker's color
   * palette. Required for the picker to render correctly when portaled
   * outside the editor shell, since CSS custom properties defined on
   * the shell don't cascade to portal targets. Defaults to `'light'`.
   */
  theme?: 'light' | 'dark';
}

interface PickerPalette {
  bg: string;
  border: string;
  inputBg: string;
  text: string;
  textMuted: string;
  accent: string;
  accentSoft: string;
}

const LIGHT_PALETTE: PickerPalette = {
  bg: '#fff',
  border: '#d4cdb5',
  inputBg: '#fff',
  text: '#1f2937',
  textMuted: '#8a7a5a',
  accent: '#8B6914',
  accentSoft: '#f3eedb',
};

const DARK_PALETTE: PickerPalette = {
  bg: '#1f2937',
  border: '#4b5563',
  inputBg: '#374151',
  text: '#e5e7eb',
  textMuted: '#9ca3af',
  accent: '#fbbf24',
  accentSoft: '#374151',
};

/** Default popover dimensions. The Toolbar reads these to position the
 *  popover with viewport-aware clamping so it never gets clipped. */
export const EMOJI_PICKER_WIDTH = 480;
export const EMOJI_PICKER_MAX_HEIGHT = 560;

function buildPopoverStyle(palette: PickerPalette): CSSProperties {
  return {
    position: 'absolute',
    zIndex: 100,
    background: palette.bg,
    border: `1px solid ${palette.border}`,
    borderRadius: 6,
    // Dark mode needs a deeper shadow than the light palette uses,
    // because the popover sits on a dark surface where a soft 15%
    // shadow effectively disappears.
    boxShadow:
      palette === DARK_PALETTE ? '0 8px 32px rgba(0, 0, 0, 0.5)' : '0 6px 24px rgba(0, 0, 0, 0.15)',
    color: palette.text,
    width: EMOJI_PICKER_WIDTH,
    maxWidth: '95vw',
    maxHeight: EMOJI_PICKER_MAX_HEIGHT,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };
}

export function EmojiPicker({
  open,
  onSelect,
  onClose,
  anchorRef,
  className,
  style,
  theme = 'light',
}: EmojiPickerProps) {
  const palette = theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE;
  const [activeCategory, setActiveCategory] = useState<string>(PICKER_CATEGORIES[0].id);
  const [query, setQuery] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Focus the search box when the popover opens; reset query when it
  // closes so the next open starts fresh.
  useEffect(() => {
    if (open) {
      // Defer so the input is mounted.
      const t = setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    setQuery('');
    setActiveCategory(PICKER_CATEGORIES[0].id);
    return undefined;
  }, [open]);

  // Close on outside click and Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef]);

  const visibleEntries = useMemo<PickerEntry[]>(() => {
    if (query.trim()) return searchPickerEntries(query);
    const cat = PICKER_CATEGORIES.find((c) => c.id === activeCategory);
    return cat ? cat.entries : [];
  }, [query, activeCategory]);

  if (!open) return null;

  return (
    <div
      ref={popoverRef}
      className={`squisq-emoji-picker ${className ?? ''}`}
      data-theme={theme}
      style={{ ...buildPopoverStyle(palette), ...style }}
      role="dialog"
      aria-label="Insert emoji"
      data-testid="emoji-picker"
    >
      {/* Search */}
      <div
        style={{
          padding: '8px 10px',
          borderBottom: `1px solid ${palette.border}`,
        }}
      >
        <input
          ref={searchInputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search emoji & icons…"
          aria-label="Search emoji & icons"
          style={{
            width: '100%',
            padding: '6px 8px',
            fontSize: 13,
            fontFamily: 'inherit',
            border: `1px solid ${palette.border}`,
            borderRadius: 4,
            background: palette.inputBg,
            color: palette.text,
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Category tabs — hidden when a search is active because the grid
          collapses across categories.

          Two-row grid layout: with 9 emoji buckets + 3 FA families we'd
          otherwise need a horizontal scrollbar to fit them all in the
          480px-wide picker, and the scrollbar visually obscures the
          tabs themselves. A 6-column grid gives exactly two even rows
          that always fit without scrolling. */}
      {!query.trim() && (
        <div
          role="tablist"
          aria-label="Emoji & icon categories"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: 2,
            padding: '4px 6px',
            borderBottom: `1px solid ${palette.border}`,
          }}
        >
          {PICKER_CATEGORIES.map((cat) => {
            const active = cat.id === activeCategory;
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={cat.label}
                title={cat.label}
                onClick={() => setActiveCategory(cat.id)}
                style={{
                  fontSize: 18,
                  lineHeight: 1,
                  padding: '6px 0',
                  cursor: 'pointer',
                  background: active ? palette.accentSoft : 'transparent',
                  border: '1px solid transparent',
                  borderBottom: active ? `2px solid ${palette.accent}` : '2px solid transparent',
                  borderRadius: 4,
                  color: palette.text,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {cat.tab.kind === 'emoji' ? (
                  cat.tab.char
                ) : (
                  <i className={`fa-${cat.tab.family} fa-${cat.tab.name}`} aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Grid — grows to fill the picker. The wrapper's `maxHeight`
          caps the popover overall (set on the root element above), so
          the grid scrolls only when the content doesn't fit. With the
          default sizing (480 wide × 560 tall, 10 columns) the common
          categories fit without a scrollbar at all. */}
      <div
        style={{
          padding: 6,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(10, 1fr)',
          gap: 2,
        }}
      >
        {visibleEntries.length === 0 ? (
          <div
            style={{
              gridColumn: '1 / -1',
              padding: '20px 8px',
              textAlign: 'center',
              color: palette.textMuted,
              fontSize: 13,
            }}
          >
            {query.trim() ? `No matches for "${query.trim()}"` : 'No entries'}
          </div>
        ) : (
          visibleEntries.map((entry, idx) => {
            const tooltip = entry.kind === 'emoji' ? entry.name : entry.label;
            const key =
              entry.kind === 'emoji' ? `e-${entry.char}-${idx}` : `i-${entry.token}-${idx}`;
            return (
              <button
                key={key}
                type="button"
                title={tooltip}
                aria-label={tooltip}
                data-picker-kind={entry.kind}
                onClick={() => onSelect(entry)}
                style={{
                  fontSize: 22,
                  lineHeight: 1,
                  padding: 4,
                  background: 'transparent',
                  border: '1px solid transparent',
                  borderRadius: 4,
                  cursor: 'pointer',
                  color: palette.text,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = palette.accentSoft;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                {entry.kind === 'emoji' ? (
                  entry.char
                ) : (
                  <i className={`fa-${entry.family} fa-${entry.name}`} aria-hidden="true" />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
