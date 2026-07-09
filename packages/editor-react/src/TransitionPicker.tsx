/**
 * TransitionPicker
 *
 * Toolbar control shown when a block (heading) is active. A trigger button
 * opens a portal flyout with a curated, grouped, searchable menu of block
 * transitions, plus direction and duration sub-controls. Selecting a
 * transition writes `transition=` (and optionally `transitionDirection=` /
 * `transitionDuration=`) onto the block — the parent does the actual edit
 * via `onChange`; this component is purely presentational.
 *
 * Positioning/portal/outside-click logic mirrors `TemplatePicker` so the two
 * toolbar popovers behave identically.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getTransitionClass } from '@bendyline/squisq-react';
import type { TransitionDirection, TransitionType } from '@bendyline/squisq/schemas';
import type { TransitionFields } from './headingTransition';
import { EMPTY_TRANSITION } from './headingTransition';
import {
  TRANSITION_GROUPS,
  TRANSITION_ENTRIES,
  DIRECTION_OPTIONS,
  findTransitionEntry,
  transitionLabel,
  type TransitionCatalogEntry,
} from './transitionCatalog';

export interface TransitionPickerProps {
  value: TransitionFields;
  onChange: (next: TransitionFields) => void;
}

/**
 * DOM id of the portaled transition flyout. Exported so hosts that embed the
 * picker inside their own popovers (e.g. the toolbar overflow menu) can treat
 * clicks inside the flyout as "inside" in their outside-click handling.
 */
export const TRANSITION_FLYOUT_PORTAL_ID = 'squisq-transition-flyout-portal';

const FLYOUT_ID = TRANSITION_FLYOUT_PORTAL_ID;

export function TransitionPicker({ value, onChange }: TransitionPickerProps) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const flyout = document.getElementById(FLYOUT_ID);
    const flyoutRect = flyout?.getBoundingClientRect();
    const width = flyoutRect?.width ?? 460;
    // Natural content height (the list scrolls inside, so scrollHeight is the
    // full unclamped height we'd like to show).
    const contentHeight = flyout?.scrollHeight ?? 520;
    const margin = 8;
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const left = Math.min(Math.max(margin, rect.left), Math.max(margin, vw - width - margin));

    // Prefer opening below the trigger; flip above when there's clearly more
    // room there. Either way cap the height to the available space so the
    // panel never runs off the viewport — the list scrolls within it.
    const spaceBelow = vh - rect.bottom - gap - margin;
    const spaceAbove = rect.top - gap - margin;
    const openDown = spaceBelow >= contentHeight || spaceBelow >= spaceAbove;
    const top = openDown
      ? rect.bottom + gap
      : Math.max(margin, rect.top - gap - Math.min(contentHeight, spaceAbove));
    const maxHeight = Math.max(140, openDown ? spaceBelow : spaceAbove);

    setStyle({ position: 'fixed', top, left, maxHeight, zIndex: 9999 });
  };

  const handleOpen = () => {
    updatePosition();
    setOpen((v) => !v);
  };

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = triggerRef.current?.contains(target);
      const inFlyout = document.getElementById(FLYOUT_ID)?.contains(target);
      if (!inTrigger && !inFlyout) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  // Reposition on scroll/resize while open (and once after mount for width)
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(updatePosition);
    const handler = () => updatePosition();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [open]);

  const flyout = open
    ? createPortal(
        <TransitionFlyout style={style} value={value} onChange={onChange} />,
        document.body,
      )
    : null;

  return (
    <div className="squisq-transition-picker">
      <button
        ref={triggerRef}
        type="button"
        className={`squisq-transition-picker-trigger${open ? ' squisq-transition-picker-trigger--open' : ''}`}
        onClick={handleOpen}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Block transition"
      >
        <span className="squisq-transition-picker-trigger-label">Transition:</span>
        <span className="squisq-transition-picker-trigger-value">
          {transitionLabel(value.type)}
        </span>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path
            d="M2 3.5l3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </button>
      {flyout}
    </div>
  );
}

function TransitionFlyout({
  style,
  value,
  onChange,
}: {
  style: React.CSSProperties;
  value: TransitionFields;
  onChange: (next: TransitionFields) => void;
}) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const trimmed = query.trim().toLowerCase();
  const hasQuery = trimmed.length > 0;

  // Flat, filtered list when searching; grouped otherwise.
  const filtered = useMemo(
    () =>
      hasQuery
        ? TRANSITION_ENTRIES.filter(
            (e) =>
              e.label.toLowerCase().includes(trimmed) || e.value.toLowerCase().includes(trimmed),
          )
        : null,
    [hasQuery, trimmed],
  );

  const activeEntry = findTransitionEntry(value.type);

  // Selecting a transition keeps the duration but drops a now-meaningless
  // direction (only directional transitions carry one).
  const selectType = (next: TransitionCatalogEntry | null) => {
    if (!next) {
      onChange({ ...EMPTY_TRANSITION });
      return;
    }
    onChange({
      type: next.value,
      direction: next.direction ? value.direction : '',
      duration: value.duration,
    });
  };

  const selectDirection = (dir: string) => {
    // Toggle off when re-clicking the active direction.
    onChange({ ...value, direction: value.direction === dir ? '' : dir });
  };

  const setDuration = (raw: string) => {
    onChange({ ...value, duration: raw.trim() });
  };

  return (
    <div id={FLYOUT_ID} className="squisq-transition-flyout" role="menu" style={style}>
      <div className="squisq-transition-flyout-search">
        <input
          ref={searchRef}
          type="search"
          className="squisq-transition-flyout-search-input"
          placeholder="Search transitions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search transitions"
        />
      </div>

      <div className="squisq-transition-flyout-list">
        <button
          type="button"
          role="menuitemradio"
          aria-checked={value.type === ''}
          className={`squisq-transition-option${value.type === '' ? ' squisq-transition-option--selected' : ''}`}
          onClick={() => selectType(null)}
        >
          None
        </button>

        {hasQuery ? (
          filtered && filtered.length > 0 ? (
            <div className="squisq-transition-flyout-grid">
              {filtered.map((entry) => (
                <TransitionOption
                  key={entry.value}
                  entry={entry}
                  selected={value.type === entry.value}
                  direction={value.type === entry.value ? value.direction : undefined}
                  onSelect={() => selectType(entry)}
                />
              ))}
            </div>
          ) : (
            <div className="squisq-transition-flyout-empty">No transitions match “{query}”.</div>
          )
        ) : (
          TRANSITION_GROUPS.map((group) => (
            <div key={group.title} className="squisq-transition-flyout-group">
              <h4 className="squisq-transition-flyout-group-title">{group.title}</h4>
              <div className="squisq-transition-flyout-grid">
                {group.entries.map((entry) => (
                  <TransitionOption
                    key={entry.value}
                    entry={entry}
                    selected={value.type === entry.value}
                    direction={value.type === entry.value ? value.direction : undefined}
                    onSelect={() => selectType(entry)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Direction + duration only apply once a transition is chosen. */}
      {value.type && (
        <div className="squisq-transition-flyout-controls">
          {activeEntry?.direction && (
            <div className="squisq-transition-flyout-control">
              <span className="squisq-transition-flyout-control-label">Direction</span>
              <div className="squisq-transition-direction-row">
                {DIRECTION_OPTIONS[activeEntry.direction].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`squisq-transition-direction-button${value.direction === opt.value ? ' squisq-transition-direction-button--selected' : ''}`}
                    onClick={() => selectDirection(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="squisq-transition-flyout-control">
            <span className="squisq-transition-flyout-control-label">Duration</span>
            <div className="squisq-transition-duration-row">
              <input
                type="number"
                min="0"
                step="0.1"
                className="squisq-transition-duration-input"
                placeholder="0.7"
                value={value.duration}
                onChange={(e) => setDuration(e.target.value)}
                aria-label="Transition duration in seconds"
              />
              <span className="squisq-transition-duration-unit">sec</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TransitionOption({
  entry,
  selected,
  direction,
  onSelect,
}: {
  entry: TransitionCatalogEntry;
  selected: boolean;
  /** Direction to preview (for the active entry); falls back to the default. */
  direction?: string;
  onSelect: () => void;
}) {
  // Play the real entering transition on the label while hovered. Local
  // state (rather than a flyout-wide hover map) keeps the rerender to the
  // single option, and toggling the class off on leave lets the animation
  // restart cleanly on the next hover. `getTransitionClass` is the same
  // mapping the player uses; if a consumer hasn't loaded the transition CSS
  // the class simply matches no rule and the label stays static.
  const [previewing, setPreviewing] = useState(false);
  // `entry.value` is a real `TransitionType` (guarded by transitionCatalog.test).
  const animClass =
    previewing && entry.value
      ? getTransitionClass(entry.value as TransitionType, true, normalizeDir(direction))
      : '';
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      className={`squisq-transition-option${selected ? ' squisq-transition-option--selected' : ''}`}
      onClick={onSelect}
      onMouseEnter={() => setPreviewing(true)}
      onMouseLeave={() => setPreviewing(false)}
    >
      <span className={`squisq-transition-option-label ${animClass}`}>{entry.label}</span>
    </button>
  );
}

/** `getTransitionClass` wants a `TransitionDirection | undefined`; '' → undefined. */
function normalizeDir(direction: string | undefined): TransitionDirection | undefined {
  return direction ? (direction as TransitionDirection) : undefined;
}
