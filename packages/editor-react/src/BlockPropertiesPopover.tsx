/**
 * BlockPropertiesPopover
 *
 * The on-canvas "block properties" palette — the sibling of the block-template
 * badge. Anchored at the `.squisq-props-badge` chip on a heading, it edits the
 * block's playback/animation metadata:
 *
 *   - Transition  (type / direction / duration) — stored in `{[…]}` params
 *   - Duration    (`duration`)  — stored in Pandoc `dataBlockAttrs`
 *   - Start time  (`startTime`) — stored in Pandoc `dataBlockAttrs`
 *
 * The popover holds the `dataBlockAttrs` inner string as working state and
 * re-derives each control from it, so successive edits compose. Every change
 * serializes a new inner and bubbles up through `onChange`; the host applies it
 * to the heading node. Positioning/portal/outside-click mirror
 * `TemplateBadgePopover`.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TransitionPicker } from './TransitionPicker';
import {
  readBlockAttrsTransition,
  setHeadingAttrsTransition,
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
  /** Apply a paired `dataBlockAttrs` / `dataTemplateParams` transition rewrite. */
  onAnnotationChange: (next: {
    blockAttrsInner: string | null;
    templateParams: string | null;
  }) => void;
  /** Editor surface scheme. Required explicitly because this popover is portaled to `<body>`. */
  colorScheme?: 'light' | 'dark';
  /** Active document-theme accent used for focus and selected-state highlights. */
  accentColor?: string;
  onClose: () => void;
}

/** The nested transition flyout is portaled out here; don't treat it as "outside". */
const TRANSITION_FLYOUT = '.squisq-transition-flyout';

export function BlockPropertiesPopover({
  anchorRect,
  blockAttrs,
  templateParams,
  onChange,
  onAnnotationChange,
  colorScheme = 'light',
  accentColor,
  onClose,
}: BlockPropertiesPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = `squisq-block-props-portal-${useId().replace(/:/g, '')}`;
  // Working copy of the Pandoc inner; successive edits compose off it.
  const [inner, setInner] = useState<string | null>(blockAttrs);
  const [templateInner, setTemplateInner] = useState<string | null>(templateParams);
  const [style, setStyle] = useState<React.CSSProperties>(() => computeStyle(anchorRect));

  useEffect(() => {
    requestAnimationFrame(() => setStyle(computeStyle(anchorRect, panelRef.current)));
  }, [anchorRect]);

  // Outside click + Escape close. A click inside the popover OR inside the
  // nested transition flyout (portaled elsewhere in the DOM) is kept open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onMouse = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const inPanel = panelRef.current?.contains(target);
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

  const transition = readBlockAttrsTransition(inner, templateInner);
  const duration = readBlockAttrsValue(inner, 'duration');
  const startTime = readBlockAttrsValue(inner, 'startTime');

  const onTransition = (next: TransitionFields) => {
    const updated = setHeadingAttrsTransition(inner, templateInner, next);
    setInner(updated.blockAttrsInner);
    setTemplateInner(updated.templateParams);
    onAnnotationChange(updated);
  };
  const onDuration = (v: string) => apply(setBlockAttrsValue(inner, 'duration', v));
  const onStartTime = (v: string) => apply(setBlockAttrsValue(inner, 'startTime', v));

  return createPortal(
    <div
      ref={panelRef}
      id={panelId}
      className="squisq-block-props-popover"
      data-theme={colorScheme}
      role="dialog"
      aria-label="Block properties"
      style={{ ...style, ...blockAccentStyle(accentColor) }}
    >
      <div className="squisq-block-props-row">
        <span className="squisq-block-props-label">Transition</span>
        <TransitionPicker
          value={transition}
          onChange={onTransition}
          colorScheme={colorScheme}
          accentColor={accentColor}
        />
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

function blockAccentStyle(accentColor: string | undefined): React.CSSProperties {
  return accentColor
    ? ({ ['--squisq-block-props-accent' as string]: accentColor } as React.CSSProperties)
    : {};
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
function computeStyle(rect: DOMRect, element?: HTMLElement | null): React.CSSProperties {
  const panel = element?.getBoundingClientRect();
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
