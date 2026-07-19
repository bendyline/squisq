/**
 * BlockCardView
 *
 * Presentational chrome for the block-at-a-time view: a single card holding
 * one block's editor surface, with Previous / Next navigation, a
 * "Block N of M" position indicator, and an optional "Add block" affordance.
 *
 * It is intentionally decoupled from `EditorContext` / `EditorShell` — it
 * takes plain props (typically sourced from {@link useBlockNavigator}) and
 * renders arbitrary `children`, so any host can reuse the block-at-a-time UX
 * around its own editor or content.
 */

import type { ReactNode } from 'react';

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
  children,
  className,
}: BlockCardViewProps) {
  const atStart = activeBlockKey <= 0;
  const atEnd = activeBlockKey >= blockCount - 1;
  // 1-based for humans; clamp to ≥1 so an empty doc still reads "Block 1 of 1".
  const position = Math.min(activeBlockKey + 1, Math.max(blockCount, 1));
  const total = Math.max(blockCount, 1);

  return (
    <div
      className={`squisq-block-card-frame${active ? ' squisq-block-card' : ''}${className ? ` ${className}` : ''}`}
      data-testid={active ? 'block-card-view' : undefined}
    >
      <div className={`squisq-block-card-frame-body${active ? ' squisq-block-card-body' : ''}`}>
        {children}
      </div>
      {active && (
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
            Block {position} of {total}
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
      )}
    </div>
  );
}
