/**
 * BlockCardView
 *
 * Presentational chrome for the block-at-a-time view: a single card holding
 * one block's editor surface, with Previous / Next navigation, a
 * "Block N of M" position indicator (plus the block's title when given), and
 * an optional "Add block" affordance. The navigation sits under the card, or
 * in another element when `navTarget` names one (EditorShell passes its
 * status bar's view region).
 *
 * It is intentionally decoupled from `EditorContext` / `EditorShell` — it
 * takes plain props (typically sourced from {@link useBlockNavigator}) and
 * renders arbitrary `children`, so any host can reuse the block-at-a-time UX
 * around its own editor or content.
 */

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface BlockCardViewProps {
  /**
   * Whether to show the block-card chrome. Defaults to true. When false the
   * stable frame remains mounted around `children`, allowing hosts to switch
   * between document and card layouts without remounting the editor surface.
   */
  active?: boolean;
  /** Total number of navigable blocks. */
  blockCount: number;
  /** Index of the block currently shown (0-based). */
  activeBlockKey: number;
  /** Move to the previous block. */
  onPrev: () => void;
  /** Move to the next block. */
  onNext: () => void;
  /** Insert a new block after the current one. Omit to hide the affordance. */
  onAdd?: () => void;
  /**
   * The active block's title, shown beside "Block N of M". Pass null for a
   * block with no title: its (empty) place is kept, so the controls after it
   * don't move. Omit it to show no titles at all.
   */
  title?: string | null;
  /**
   * Renders the navigation into this element — the editor's status bar —
   * instead of beneath the card. Null or omitted keeps it under the card.
   */
  navTarget?: HTMLElement | null;
  /** The editor surface (or any content) for the active block. */
  children: ReactNode;
  /** Optional extra class for the outer container. */
  className?: string;
}

export function BlockCardView({
  active = true,
  blockCount,
  activeBlockKey,
  onPrev,
  onNext,
  onAdd,
  title,
  navTarget,
  children,
  className,
}: BlockCardViewProps) {
  const atStart = activeBlockKey <= 0;
  const atEnd = activeBlockKey >= blockCount - 1;
  // 1-based for humans; clamp to ≥1 so an empty doc still reads "Block 1 of 1".
  const position = Math.min(activeBlockKey + 1, Math.max(blockCount, 1));
  const total = Math.max(blockCount, 1);

  const nav = (
    <div className="squisq-block-card-nav" role="toolbar" aria-label="Block navigation">
      <button
        type="button"
        className="squisq-block-card-button squisq-block-card-prev"
        onClick={onPrev}
        disabled={atStart}
        aria-label="Previous block"
        data-tooltip="Previous block"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M9 2.5 L4.5 7 L9 11.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        <span>Previous</span>
      </button>
      <span className="squisq-block-card-position" aria-live="polite">
        {/* Sized to "Block M of M" (status-bar.css), so the arrows hold still
            in the status bar as the number grows a digit. */}
        <span className="squisq-block-card-count" data-sizer={`Block ${total} of ${total}`}>
          <span>
            Block {position} of {total}
          </span>
        </span>
        {title !== undefined && (
          <>
            {' '}
            <span className="squisq-block-card-title">{title}</span>
          </>
        )}
      </span>
      <button
        type="button"
        className="squisq-block-card-button squisq-block-card-next"
        onClick={onNext}
        disabled={atEnd}
        aria-label="Next block"
        data-tooltip="Next block"
      >
        <span>Next</span>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
          <path
            d="M5 2.5 L9.5 7 L5 11.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </button>
      {onAdd && (
        <button
          type="button"
          className="squisq-block-card-button squisq-block-card-add"
          onClick={onAdd}
          aria-label="Add block"
          data-tooltip="Add block after this one"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M7 3 L7 11 M3 7 L11 7"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
          <span>Add block</span>
        </button>
      )}
    </div>
  );

  return (
    <div
      className={`squisq-block-card-frame${active ? ' squisq-block-card' : ''}${className ? ` ${className}` : ''}`}
      data-testid={active ? 'block-card-view' : undefined}
    >
      <div className={`squisq-block-card-frame-body${active ? ' squisq-block-card-body' : ''}`}>
        {children}
      </div>
      {active && (navTarget ? createPortal(nav, navTarget) : nav)}
    </div>
  );
}
