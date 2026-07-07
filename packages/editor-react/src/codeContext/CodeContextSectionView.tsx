import { parseMarkdown } from '@bendyline/squisq/markdown';
import { MarkdownRenderer } from '@bendyline/squisq-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CodeContext, CodeContextSection } from './types';

/**
 * One context section rendered inside a Monaco view zone: a single-line
 * disclosure strip, plus the full markdown body while expanded. The body is
 * rendered lazily — a file with 100 collapsed sections parses 100 one-liners,
 * nothing more.
 */
export interface CodeContextSectionViewProps {
  section: Omit<CodeContextSection, 'line'>;
  expanded: boolean;
  onToggle: (id: string) => void;
  linkSchemes?: readonly string[] | undefined;
  onLinkClick?: CodeContext['onLinkClick'] | undefined;
  /** Native `#L<n>` handling: reveal that line in the editor. */
  onRevealLine: (line: number) => void;
  /** Reports the rendered content height so the zone can be resized to fit. */
  onMeasure: (id: string, px: number) => void;
}

export function CodeContextSectionView({
  section,
  expanded,
  onToggle,
  linkSchemes,
  onLinkClick,
  onRevealLine,
  onMeasure,
}: CodeContextSectionViewProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const stripNodes = useMemo(
    () => parseMarkdown(section.summaryMarkdown).children,
    [section.summaryMarkdown],
  );
  const bodyNodes = useMemo(
    () => (expanded && section.markdown ? parseMarkdown(section.markdown).children : null),
    [expanded, section.markdown],
  );

  // Height feedback loop: report the content's real height whenever it
  // changes. Monaco display:none's offscreen zones and ResizeObserver reports
  // 0×0 for those — ignore zeros so scrolled-away zones keep their height.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const report = () => {
      const h = el.offsetHeight;
      if (h > 0) onMeasure(section.id, h);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [section.id, onMeasure]);

  // Delegated link interception. `#L<n>` reveals natively; everything else
  // goes to the host callback (returning false opts back into default
  // navigation).
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest?.('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href') ?? '';
      const lineMatch = /^#L(\d+)$/.exec(href);
      if (lineMatch) {
        e.preventDefault();
        e.stopPropagation();
        onRevealLine(Number(lineMatch[1]));
        return;
      }
      if (onLinkClick) {
        const handled = onLinkClick(href, { sectionId: section.id });
        if (handled !== false) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    },
    [onLinkClick, onRevealLine, section.id],
  );

  // Keep Monaco's container-level mousedown handler from hijacking clicks
  // and text selection inside the section.
  const stopMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    // Click handler is delegated anchor interception only; keyboard users
    // reach links natively and the strip itself is a real <button>.
    <div
      ref={rootRef}
      className={`squisq-ccx-section${expanded ? ' squisq-ccx-section--expanded' : ''}`}
      onClick={handleClick}
      onMouseDown={stopMouseDown}
    >
      <button
        type="button"
        className="squisq-ccx-strip"
        aria-expanded={expanded}
        onClick={() => onToggle(section.id)}
      >
        <span className="squisq-ccx-chevron" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
        <span className="squisq-ccx-strip-text">
          <MarkdownRenderer nodes={stripNodes} {...(linkSchemes ? { linkSchemes } : {})} />
        </span>
      </button>
      {expanded &&
        (bodyNodes ? (
          <div className="squisq-ccx-body">
            <MarkdownRenderer nodes={bodyNodes} {...(linkSchemes ? { linkSchemes } : {})} />
          </div>
        ) : (
          <div className="squisq-ccx-body squisq-ccx-body--loading">Loading…</div>
        ))}
    </div>
  );
}
