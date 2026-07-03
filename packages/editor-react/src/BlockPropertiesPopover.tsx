/**
 * BlockPropertiesPopover
 *
 * The on-canvas "block properties" palette — the sibling of the block-template
 * badge. Anchored at the `.squisq-props-badge` chip on a heading, it edits the
 * block's playback/animation metadata, all stored in the heading's Pandoc `{…}`
 * attribute block (`dataBlockAttrs`):
 *
 *   - Transition  (type / direction / duration) — reuses `TransitionPicker`
 *   - Duration    (`duration`)  — how long the block is shown
 *   - Start time  (`startTime`) — timeline position
 *
 * The popover holds the `dataBlockAttrs` inner string as working state and
 * re-derives each control from it, so successive edits compose. Every change
 * serializes a new inner and bubbles up through `onChange`; the host applies it
 * to the heading node. Positioning/portal/outside-click mirror
 * `TemplateBadgePopover`.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { TransitionPicker } from './TransitionPicker';
import {
  readBlockAttrsTransition,
  setBlockAttrsTransition,
  type TransitionFields,
} from './headingTransition';
import { readBlockAttrsValue, setBlockAttrsValue } from './blockProperties';

export interface BlockPropertiesPopoverProps {
  /** DOMRect of the badge that triggered the popover (viewport coords). */
  anchorRect: DOMRect;
  /** Current `dataBlockAttrs` inner (Pandoc), or null when unset. */
  blockAttrs: string | null;
  /** `dataTemplateParams`, so a hand-typed `{[… transition=]}` reads through. */
  templateParams: string | null;
  /** Apply a new `dataBlockAttrs` inner to the heading (null clears it). */
  onChange: (nextInner: string | null) => void;
  onClose: () => void;
}

const PANEL_ID = 'squisq-block-props-portal';
/** The nested transition flyout is portaled out here; don't treat it as "outside". */
const TRANSITION_FLYOUT = '.squisq-transition-flyout';

export function BlockPropertiesPopover({
  anchorRect,
  blockAttrs,
  templateParams,
  onChange,
  onClose,
}: BlockPropertiesPopoverProps) {
  // Working copy of the Pandoc inner; successive edits compose off it.
  const [inner, setInner] = useState<string | null>(blockAttrs);
  const [style, setStyle] = useState<React.CSSProperties>(() => computeStyle(anchorRect));

  useEffect(() => {
    requestAnimationFrame(() => setStyle(computeStyle(anchorRect)));
  }, [anchorRect]);

  // Outside click + Escape close. A click inside the popover OR inside the
  // nested transition flyout (portaled elsewhere in the DOM) is kept open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onMouse = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const inPanel = document.getElementById(PANEL_ID)?.contains(target);
      const inFlyout = target.closest?.(TRANSITION_FLYOUT);
      if (!inPanel && !inFlyout) onClose();
    };
    const id = requestAnimationFrame(() => document.addEventListener('mousedown', onMouse));
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const apply = (next: string | null) => {
    setInner(next);
    onChange(next);
  };

  const transition = readBlockAttrsTransition(inner, templateParams);
  const duration = readBlockAttrsValue(inner, 'duration');
  const startTime = readBlockAttrsValue(inner, 'startTime');

  const onTransition = (next: TransitionFields) => apply(setBlockAttrsTransition(inner, next));
  const onDuration = (v: string) => apply(setBlockAttrsValue(inner, 'duration', v));
  const onStartTime = (v: string) => apply(setBlockAttrsValue(inner, 'startTime', v));

  return createPortal(
    <div
      id={PANEL_ID}
      className="squisq-block-props-popover"
      role="dialog"
      aria-label="Block properties"
      style={style}
    >
      <div className="squisq-block-props-row">
        <span className="squisq-block-props-label">Transition</span>
        <TransitionPicker value={transition} onChange={onTransition} />
      </div>

      <div className="squisq-block-props-row">
        <span className="squisq-block-props-label">Duration</span>
        <NumberField
          value={duration}
          placeholder="auto"
          unit="sec"
          ariaLabel="Block duration in seconds"
          onChange={onDuration}
        />
      </div>

      <div className="squisq-block-props-row">
        <span className="squisq-block-props-label">Start time</span>
        <NumberField
          value={startTime}
          placeholder="—"
          unit="sec"
          ariaLabel="Block start time in seconds"
          onChange={onStartTime}
        />
      </div>
    </div>,
    document.body,
  );
}

function NumberField({
  value,
  placeholder,
  unit,
  ariaLabel,
  onChange,
}: {
  value: string;
  placeholder: string;
  unit: string;
  ariaLabel: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="squisq-block-props-numfield">
      <input
        type="number"
        min="0"
        step="0.1"
        className="squisq-block-props-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
      />
      <span className="squisq-block-props-unit">{unit}</span>
    </div>
  );
}

/** Place the panel below the badge, flipping above / clamping to the viewport. */
function computeStyle(rect: DOMRect): React.CSSProperties {
  const panel = document.getElementById(PANEL_ID)?.getBoundingClientRect();
  const width = panel?.width ?? 280;
  const height = panel?.height ?? 160;
  const margin = 8;
  const gap = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const spaceBelow = vh - rect.bottom - margin;
  let top: number;
  if (height + gap <= spaceBelow || rect.top - margin < height + gap) {
    top = rect.bottom + gap;
  } else {
    top = rect.top - height - gap;
  }
  const maxLeft = Math.max(margin, vw - width - margin);
  const left = Math.min(Math.max(margin, rect.left), maxLeft);

  return {
    position: 'fixed',
    top,
    left,
    maxHeight: `${vh - 2 * margin}px`,
    zIndex: 9999,
  };
}
