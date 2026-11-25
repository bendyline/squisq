/**
 * SummaryStylePicker — the Summary style field in Edit › Summaries.
 *
 * A dropdown rather than a panel of every style: the trigger names the chosen
 * style and says what it does, and the list it opens shows each style with its
 * description, so the choice reads as richly as the old cards did in a single
 * row of the view. Behaves like the other Squisq pickers (`ThemePicker`): a
 * listbox portaled to the body, arrow keys and Home/End between styles, Enter
 * to choose, Escape or Tab to close.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useEditorContext } from '../EditorContext';
import { useEscapeDismissal } from '../useEscapeDismissal';
import type { SummaryStyleOption } from './summaryStyles';

export interface SummaryStylePickerProps {
  /** The chosen style's `squisq-transform` value; `''` is None. */
  value: string;
  options: readonly SummaryStyleOption[];
  onChange: (id: string) => void;
  disabled?: boolean;
}

/** Narrowest the list opens, so descriptions stay readable under a small trigger. */
const MIN_LIST_WIDTH = 320;
const EDGE = 8;
const GAP = 4;
/** The list before it is placed: measurable, but not yet seen. */
const UNPLACED: CSSProperties = { position: 'fixed', visibility: 'hidden' };

export function SummaryStylePicker({
  value,
  options,
  onChange,
  disabled = false,
}: SummaryStylePickerProps) {
  const { colorScheme } = useEditorContext();
  const [open, setOpen] = useState(false);
  const [listStyle, setListStyle] = useState<CSSProperties>(UNPLACED);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const labelId = `${id}-label`;
  const valueId = `${id}-value`;
  const descriptionId = `${id}-description`;
  const listId = `${id}-list`;
  const selected = options.find((option) => option.id === value) ?? options[0];

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);
  useEscapeDismissal(open, () => setOpen(false), triggerRef);

  // Hangs from the trigger's left edge, at least as wide as it; opens upwards
  // only when there is more room there, and scrolls inside whatever room it has.
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const list = listRef.current;
    if (!trigger || !list) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(window.innerWidth - EDGE * 2, Math.max(rect.width, MIN_LIST_WIDTH));
    const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - width - EDGE));
    const below = window.innerHeight - rect.bottom - GAP - EDGE;
    const above = rect.top - GAP - EDGE;
    const upwards = list.scrollHeight > below && above > below;
    const height = Math.min(list.scrollHeight + 2, upwards ? above : below);
    setListStyle({
      position: 'fixed',
      visibility: 'visible',
      left,
      width,
      top: upwards ? rect.top - GAP - height : rect.bottom + GAP,
      maxHeight: height,
      boxSizing: 'border-box',
      overflowY: 'auto',
      zIndex: 9999,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setListStyle(UNPLACED);
      return;
    }
    place();
    const reposition = (event: Event) => {
      if (event.target instanceof Node && listRef.current?.contains(event.target)) return;
      place();
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, place]);

  // Focus the chosen style once the list is placed and shown (a browser will
  // not focus into a hidden list), so the arrow keys move on from it.
  const shown = open && listStyle.visibility === 'visible';
  useLayoutEffect(() => {
    if (shown) listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }, [shown]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  // A read-only document closes the list it can no longer act on.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const choose = (next: string) => {
    if (next !== value) onChange(next);
    close(true);
  };

  const list = open
    ? createPortal(
        <div
          ref={listRef}
          id={listId}
          className="squisq-summarize-style-menu"
          data-theme={colorScheme}
          role="listbox"
          aria-labelledby={labelId}
          style={listStyle}
          onKeyDown={(event) => {
            // Tab closes the list and moves on from the trigger, as from a select.
            if (event.key === 'Tab') {
              close(true);
              return;
            }
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];
            const at = items.indexOf(document.activeElement as HTMLElement);
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? items.length - 1
                  : event.key === 'ArrowUp'
                    ? Math.max(0, at - 1)
                    : Math.min(items.length - 1, at + 1);
            items[next]?.focus();
          }}
        >
          {options.map((option) => {
            const key = option.id || 'none';
            const chosen = option.id === selected?.id;
            return (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={chosen}
                aria-labelledby={`${id}-${key}-name`}
                aria-describedby={`${id}-${key}-description`}
                className={`squisq-summarize-style-option${chosen ? ' squisq-summarize-style-option--selected' : ''}`}
                data-style={key}
                onClick={() => choose(option.id)}
              >
                <span className="squisq-summarize-style-check" aria-hidden="true">
                  {chosen && <CheckMark />}
                </span>
                <span className="squisq-summarize-style-copy">
                  <span id={`${id}-${key}-name`} className="squisq-summarize-style-name">
                    {option.name}
                  </span>
                  <span
                    id={`${id}-${key}-description`}
                    className="squisq-summarize-style-description"
                  >
                    {option.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>,
        // Inside a modal, stay within its focus and accessibility boundary.
        triggerRef.current?.closest('[role="dialog"][aria-modal="true"]') ?? document.body,
      )
    : null;

  return (
    <div className="squisq-summarize-style-field">
      <span id={labelId} className="squisq-summarize-legend">
        Summary style
      </span>
      <button
        ref={triggerRef}
        type="button"
        className={`squisq-summarize-style-trigger${open ? ' squisq-summarize-style-trigger--open' : ''}`}
        data-style={selected?.id || 'none'}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-describedby={descriptionId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <span className="squisq-summarize-style-copy">
          <span id={valueId} className="squisq-summarize-style-name">
            {selected?.name}
          </span>
          <span id={descriptionId} className="squisq-summarize-style-description">
            {selected?.description}
          </span>
        </span>
        <svg
          className="squisq-summarize-style-caret"
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
      {list}
    </div>
  );
}

function CheckMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12">
      <path
        d="M2.5 6.2l2.4 2.4 4.6-5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
