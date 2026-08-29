/**
 * Hover readout for a squiggle — the passive sibling of
 * `ProofingMenu`. It answers "what is wrong here?" without the user
 * having to right-click: category, the engine's message, and a preview
 * of the top suggestions (applying one still goes through the menu).
 *
 * Deliberately `pointer-events: none` and portaled: it never steals a
 * click from the text underneath, so it needs no outside-click or
 * hover-bridge handling — the pointer tracking in `useProofing` owns
 * its whole lifecycle.
 */

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { ProofFinding } from '@bendyline/squisq/proof';
import { PROOF_CATEGORY_LABELS, proofSuggestionLabels } from './findingText';
import type { ProofingHoverAnchor } from './useProofing';

export interface ProofingTooltipProps {
  anchor: ProofingHoverAnchor;
  finding: ProofFinding;
  colorScheme: 'light' | 'dark';
}

const MAX_SUGGESTIONS = 3;

/** Below the squiggle by default, flipped above / clamped to the viewport. */
function computeStyle(anchor: ProofingHoverAnchor, element?: HTMLElement | null): CSSProperties {
  const rect = element?.getBoundingClientRect();
  const width = rect?.width ?? 240;
  const height = rect?.height ?? 72;
  const margin = 8;
  const gap = 6;

  let top = anchor.bottom + gap;
  if (top + height + margin > window.innerHeight && anchor.top - height - gap >= margin) {
    top = anchor.top - height - gap;
  }
  const left = Math.min(
    Math.max(margin, anchor.left),
    Math.max(margin, window.innerWidth - width - margin),
  );
  return { position: 'fixed', top, left, zIndex: 9998 };
}

export function ProofingTooltip({
  anchor,
  finding,
  colorScheme,
}: ProofingTooltipProps): JSX.Element {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>(() => computeStyle(anchor));

  // Measure before paint so the card never flashes at its unmeasured
  // guess position (it appears already settled, unlike the menu, which
  // the user is looking at when it opens).
  useLayoutEffect(() => {
    setStyle(computeStyle(anchor, tooltipRef.current));
  }, [anchor, finding.id]);

  const labels = proofSuggestionLabels(finding, MAX_SUGGESTIONS);
  const extra = finding.suggestions.length - labels.length;

  return createPortal(
    <div
      ref={tooltipRef}
      className="squisq-proof-tooltip"
      data-theme={colorScheme}
      data-proof-tooltip-id={finding.id}
      role="tooltip"
      style={style}
    >
      <div className="squisq-proof-tooltip-head">
        <span className={`squisq-proof-dot squisq-proof-dot--${finding.category}`} aria-hidden />
        <span className="squisq-proof-tooltip-category">
          {PROOF_CATEGORY_LABELS[finding.category]}
        </span>
      </div>
      <div className="squisq-proof-tooltip-message">{finding.message}</div>
      {labels.length > 0 && (
        <div className="squisq-proof-tooltip-suggestions">
          <span className="squisq-proof-tooltip-label">Suggested</span>
          {labels.map((label, index) => (
            <span key={`${index}-${label}`} className="squisq-proof-tooltip-chip">
              {label}
            </span>
          ))}
          {extra > 0 && <span className="squisq-proof-tooltip-more">+{extra} more</span>}
        </div>
      )}
      <div className="squisq-proof-tooltip-hint">Right-click for options</div>
    </div>,
    document.body,
  );
}
