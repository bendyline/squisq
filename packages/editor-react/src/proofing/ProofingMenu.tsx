/**
 * Cursor-positioned suggestions menu, shared by the Write and Source
 * views. Portal + flip/clamp follow `BlockPropertiesPopover`; the
 * `role="menu"` markup, arrow-key navigation, and dismissal wiring
 * follow `MediaBin`'s context menu. Portaled, so it carries its own
 * `data-theme`.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { ProofFinding } from '@bendyline/squisq/proof';
import { useEscapeDismissal } from '../useEscapeDismissal';
import { proofSuggestionLabel } from './findingText';
import type { ProofingMenuAnchor } from './useProofing';

export interface ProofingMenuProps {
  anchor: ProofingMenuAnchor;
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
  onClose: () => void;
}

const MAX_SUGGESTIONS = 5;

/** Place the menu at the pointer, flipping above / clamping to the viewport. */
function computeStyle(anchor: ProofingMenuAnchor, element?: HTMLElement | null): CSSProperties {
  const rect = element?.getBoundingClientRect();
  const width = rect?.width ?? 220;
  const height = rect?.height ?? 160;
  const margin = 8;
  const gap = 4;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = anchor.y + gap;
  if (top + height + margin > vh && anchor.y - height - gap >= margin) {
    top = anchor.y - height - gap;
  }
  const left = Math.min(Math.max(margin, anchor.x), Math.max(margin, vw - width - margin));
  return { position: 'fixed', top, left, zIndex: 9999 };
}

export function ProofingMenu({
  anchor,
  finding,
  colorScheme,
  onApply,
  onIgnore,
  onAddToAppDictionary,
  onAddToDocWordList,
  canAddToAppDictionary,
  onClose,
}: ProofingMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>(() => computeStyle(anchor));
  const [focusIndex, setFocusIndex] = useState(0);

  useEffect(() => {
    requestAnimationFrame(() => setStyle(computeStyle(anchor, menuRef.current)));
  }, [anchor]);

  useEscapeDismissal(true, onClose);

  // Outside mousedown (deferred a frame so the opening click can't
  // self-dismiss) + any scroll/resize closes the menu.
  useEffect(() => {
    const onMouse = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onScrollOrResize = () => onClose();
    const id = requestAnimationFrame(() => document.addEventListener('mousedown', onMouse));
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener('mousedown', onMouse);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [onClose]);

  const suggestions = finding.suggestions.slice(0, MAX_SUGGESTIONS);
  // Only an unknown WORD can be dictionary material; a grammar or style
  // finding spans a phrase.
  const showAddWord = finding.category === 'spelling';
  const actions: { key: string; label: string; run: () => void; className?: string }[] = [
    ...suggestions.map((_, index) => ({
      key: `s${index}`,
      label: proofSuggestionLabel(finding.suggestions[index]),
      run: () => onApply(index),
      className: 'squisq-proof-menu-suggestion',
    })),
    { key: 'ignore', label: 'Ignore', run: onIgnore },
    // Two deliberately distinct scopes: the app dictionary is invisible
    // to the file, the document word list is written into its
    // frontmatter — so the label has to say so.
    ...(showAddWord && canAddToAppDictionary
      ? [{ key: 'add-app', label: 'Add to dictionary', run: onAddToAppDictionary }]
      : []),
    ...(showAddWord
      ? [
          {
            key: 'add-doc',
            label: 'Add to document word list',
            run: onAddToDocWordList,
          },
        ]
      : []),
  ];

  useEffect(() => {
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items?.[focusIndex]?.focus();
  }, [focusIndex]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setFocusIndex((index) => (index + 1) % actions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setFocusIndex((index) => (index - 1 + actions.length) % actions.length);
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      className="squisq-proof-menu"
      data-theme={colorScheme}
      role="menu"
      aria-label="Proofing suggestions"
      style={style}
      onKeyDown={onKeyDown}
    >
      <div className="squisq-proof-menu-header">
        <span className={`squisq-proof-dot squisq-proof-dot--${finding.category}`} aria-hidden />
        <span className="squisq-proof-menu-message">{finding.message}</span>
      </div>
      {actions.map((action, index) => (
        <button
          key={action.key}
          type="button"
          role="menuitem"
          tabIndex={index === focusIndex ? 0 : -1}
          className={`squisq-proof-menu-item ${action.className ?? ''}`.trim()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={action.run}
        >
          {action.label}
        </button>
      ))}
      {suggestions.length === 0 && <div className="squisq-proof-menu-empty">No suggestions</div>}
    </div>,
    document.body,
  );
}
