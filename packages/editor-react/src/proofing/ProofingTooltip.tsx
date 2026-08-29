/**
 * Hover card for a squiggle — the pointer-driven sibling of
 * `ProofingMenu`. It answers "what is wrong here?" without the user
 * having to right-click, and now also acts on the answer: the
 * suggestions are buttons, and the same Ignore / dictionary actions the
 * menu offers sit beneath them.
 *
 * Being interactive is what makes the pointer lifecycle non-trivial:
 * the card is portaled and sits a few pixels off the flagged word, so
 * `useProofing` arms a close when the pointer leaves the squiggle and
 * this card cancels it (`onHold`) the moment the pointer arrives. Every
 * action closes the card explicitly, because after applying a
 * suggestion the finding it describes no longer exists.
 */

import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { ProofFinding } from '@bendyline/squisq/proof';
import { PROOF_CATEGORY_LABELS, proofSuggestionLabel } from './findingText';
import type { ProofingHoverAnchor } from './useProofing';

export interface ProofingTooltipProps {
  anchor: ProofingHoverAnchor;
  finding: ProofFinding;
  colorScheme: 'light' | 'dark';
  onApply: (suggestionIndex: number) => void;
  onIgnore: () => void;
  /** Accept the word app-wide (host storage). */
  onAddToAppDictionary: () => void;
  /** Accept the word in this document's frontmatter word list. */
  onAddToDocWordList: () => void;
  /** Hide the app-dictionary item when the host persists nothing. */
  canAddToAppDictionary: boolean;
  /** Open the full menu at these client coordinates (overflow suggestions). */
  onMore: (x: number, y: number) => void;
  /** Pointer entered the card — cancel the pending close. */
  onHold: () => void;
  /** Pointer left the card — re-arm the close. */
  onRelease: () => void;
}

/** Suggestions shown as buttons; the rest live behind "more". */
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
  onApply,
  onIgnore,
  onAddToAppDictionary,
  onAddToDocWordList,
  canAddToAppDictionary,
  onMore,
  onHold,
  onRelease,
}: ProofingTooltipProps): JSX.Element {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>(() => computeStyle(anchor));

  // Measure before paint so the card never flashes at its unmeasured
  // guess position (it appears already settled, unlike the menu, which
  // the user is looking at when it opens).
  useLayoutEffect(() => {
    setStyle(computeStyle(anchor, tooltipRef.current));
  }, [anchor, finding.id]);

  const suggestions = finding.suggestions.slice(0, MAX_SUGGESTIONS);
  const extra = finding.suggestions.length - suggestions.length;
  // Only an unknown WORD can be dictionary material; a grammar or style
  // finding spans a phrase. Same rule as `ProofingMenu`.
  const showAddWord = finding.category === 'spelling';

  return createPortal(
    <div
      ref={tooltipRef}
      className="squisq-proof-tooltip"
      data-theme={colorScheme}
      data-proof-tooltip-id={finding.id}
      role="group"
      aria-label={`${PROOF_CATEGORY_LABELS[finding.category]} suggestion`}
      style={style}
      onMouseEnter={onHold}
      onMouseLeave={onRelease}
      // The card lives outside the editor, so a click in it would blur
      // the selection an applied suggestion needs.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="squisq-proof-tooltip-head">
        <span className={`squisq-proof-dot squisq-proof-dot--${finding.category}`} aria-hidden />
        <span className="squisq-proof-tooltip-category">
          {PROOF_CATEGORY_LABELS[finding.category]}
        </span>
      </div>
      <div className="squisq-proof-tooltip-message">{finding.message}</div>
      {suggestions.length > 0 && (
        <div className="squisq-proof-tooltip-suggestions">
          {suggestions.map((suggestion, index) => (
            <button
              key={`${index}-${suggestion.kind}-${suggestion.text}`}
              type="button"
              className="squisq-proof-tooltip-chip"
              onClick={() => onApply(index)}
            >
              {proofSuggestionLabel(suggestion)}
            </button>
          ))}
          {extra > 0 && (
            <button
              type="button"
              className="squisq-proof-tooltip-more"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                onMore(rect.left, rect.bottom);
              }}
            >
              +{extra} more
            </button>
          )}
        </div>
      )}
      <div className="squisq-proof-tooltip-actions">
        <button type="button" className="squisq-proof-tooltip-action" onClick={onIgnore}>
          Ignore
        </button>
        {/* Two deliberately distinct scopes: the app dictionary is
            invisible to the file, the document word list is written into
            its frontmatter — so the labels have to say so. */}
        {showAddWord && canAddToAppDictionary && (
          <button
            type="button"
            className="squisq-proof-tooltip-action"
            onClick={onAddToAppDictionary}
          >
            Add to dictionary
          </button>
        )}
        {showAddWord && (
          <button
            type="button"
            className="squisq-proof-tooltip-action"
            onClick={onAddToDocWordList}
          >
            Add to document word list
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
