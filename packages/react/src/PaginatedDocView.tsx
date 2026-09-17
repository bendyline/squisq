/**
 * PaginatedDocView
 *
 * Renders a Doc—or host-supplied document pages—as an accessible horizontal
 * reader with scroll snapping, keyboard controls, navigation buttons, and a
 * live page indicator. Hosts own document-specific page composition while
 * this component owns reusable pagination behavior and structural layout.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { Doc } from '@bendyline/squisq/schemas';
import { LinearDocView, type LinearDocViewProps } from './LinearDocView.js';

export interface PaginatedDocPage {
  key: string;
  label: string;
  /** React or react-compatible host node (for example Preact compat). */
  content: ReactNode | object | bigint;
  className?: string;
}

export interface PaginatedDocViewProps {
  /** A Doc to split into one page per top-level block. */
  doc?: Doc;
  /** Host-composed pages. Wins over doc when supplied. */
  pages?: readonly PaginatedDocPage[];
  /** Props applied to Doc pages rendered with LinearDocView. */
  linearViewProps?: Omit<LinearDocViewProps, 'doc'>;
  className?: string;
  scrollerClassName?: string;
  pageClassName?: string;
  previousButtonClassName?: string;
  nextButtonClassName?: string;
  indicatorClassName?: string;
  indicatorTextClassName?: string;
  renderPreviousIcon?: () => ReactNode | object | bigint;
  renderNextIcon?: () => ReactNode | object | bigint;
  ariaLabel?: string;
  initialPage?: number;
  focusOnMount?: boolean;
  einkMode?: boolean;
  onPageChange?: (pageIndex: number) => void;
  style?: CSSProperties;
  scrollerStyle?: CSSProperties;
  pageStyle?: CSSProperties;
}

export function PaginatedDocView({
  doc,
  pages,
  linearViewProps,
  className = '',
  scrollerClassName = '',
  pageClassName = '',
  previousButtonClassName = '',
  nextButtonClassName = '',
  indicatorClassName = '',
  indicatorTextClassName = '',
  renderPreviousIcon,
  renderNextIcon,
  ariaLabel = 'Document pages',
  initialPage = 0,
  focusOnMount = true,
  einkMode = false,
  onPageChange,
  style,
  scrollerStyle,
  pageStyle: pageStyleOverride,
}: PaginatedDocViewProps) {
  const resolvedPages = useMemo<readonly PaginatedDocPage[]>(() => {
    if (pages) return pages;
    if (!doc) return [];
    return doc.blocks.map((block, index) => ({
      key: block.id || `page-${index}`,
      label: block.sourceHeading ? `Document section ${index + 1}` : `Document page ${index + 1}`,
      content: (
        <LinearDocView
          {...linearViewProps}
          doc={{
            ...doc,
            blocks: [block],
            startBlock: index === 0 ? doc.startBlock : undefined,
          }}
          thinMargins={linearViewProps?.thinMargins ?? true}
        />
      ),
    }));
  }, [doc, linearViewProps, pages]);
  const lastPage = Math.max(0, resolvedPages.length - 1);
  const [currentPage, setCurrentPage] = useState(() =>
    Math.min(Math.max(0, initialPage), lastPage),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingPageRef = useRef<number | null>(null);
  const pendingPageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitPage = useCallback(
    (next: number) => {
      setCurrentPage((current) => {
        if (current !== next) onPageChange?.(next);
        return next;
      });
    },
    [onPageChange],
  );

  const updatePage = useCallback(
    (index: number) => {
      const next = Math.min(Math.max(0, index), lastPage);
      pendingPageRef.current = next;
      if (pendingPageTimeoutRef.current !== null) {
        clearTimeout(pendingPageTimeoutRef.current);
      }
      pendingPageTimeoutRef.current = setTimeout(() => {
        pendingPageRef.current = null;
        pendingPageTimeoutRef.current = null;
        commitPage(next);
      }, 750);
      const container = scrollRef.current;
      const pageNodes = container?.querySelectorAll<HTMLElement>(':scope > .squisq-paginated-page');
      const target = pageNodes?.[next];
      if (container && target) {
        const origin = pageNodes?.[0]?.offsetLeft ?? 0;
        container.scrollTo({
          left: target.offsetLeft - origin,
          behavior: einkMode ? 'auto' : 'smooth',
        });
      }
    },
    [commitPage, einkMode, lastPage],
  );

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const initial = Math.min(Math.max(0, initialPage), lastPage);
    pendingPageRef.current = null;
    container.scrollLeft = initial * container.clientWidth;
    setCurrentPage(initial);
    if (focusOnMount) container.focus({ preventScroll: true });
  }, [focusOnMount, initialPage, lastPage, resolvedPages]);

  useEffect(
    () => () => {
      if (pendingPageTimeoutRef.current !== null) {
        clearTimeout(pendingPageTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (container.clientWidth <= 0) return;
        const pageNodes = Array.from(
          container.querySelectorAll<HTMLElement>(':scope > .squisq-paginated-page'),
        );
        const origin = pageNodes[0]?.offsetLeft ?? 0;
        const pendingPage = pendingPageRef.current;
        if (pendingPage !== null) {
          const pendingTarget = pageNodes[pendingPage];
          const pendingLeft = pendingTarget ? pendingTarget.offsetLeft - origin : 0;
          if (Math.abs(container.scrollLeft - pendingLeft) > 1) return;
          pendingPageRef.current = null;
          if (pendingPageTimeoutRef.current !== null) {
            clearTimeout(pendingPageTimeoutRef.current);
            pendingPageTimeoutRef.current = null;
          }
        }
        const next = pageNodes.reduce(
          (nearest, page, index) =>
            Math.abs(container.scrollLeft - (page.offsetLeft - origin)) <
            Math.abs(container.scrollLeft - (pageNodes[nearest]?.offsetLeft ?? origin) + origin)
              ? index
              : nearest,
          0,
        );
        commitPage(next);
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener('scroll', onScroll);
    };
  }, [commitPage, lastPage]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      updatePage((pendingPageRef.current ?? currentPage) + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      updatePage((pendingPageRef.current ?? currentPage) - 1);
    }
  };

  const outerStyle: CSSProperties = { position: 'relative', width: '100%', height: '100%' };
  const scrollStyle: CSSProperties = {
    display: 'flex',
    width: '100%',
    height: '100%',
    overflowX: 'auto',
    overflowY: 'hidden',
    scrollSnapType: 'x mandatory',
  };
  const pageStyle: CSSProperties = {
    flex: '0 0 100%',
    minWidth: '100%',
    height: '100%',
    overflowY: 'auto',
    overflowX: 'hidden',
    scrollSnapAlign: 'start',
    scrollSnapStop: 'always',
    boxSizing: 'border-box',
  };

  return (
    <div className={`squisq-paginated ${className}`.trim()} style={{ ...outerStyle, ...style }}>
      <div
        ref={scrollRef}
        className={`squisq-paginated-scroll ${scrollerClassName}`.trim()}
        style={{ ...scrollStyle, ...scrollerStyle }}
        tabIndex={0}
        role="region"
        aria-label={ariaLabel}
        aria-roledescription="paginated reader"
        onKeyDown={onKeyDown}
      >
        {resolvedPages.map((page) => (
          <div
            key={page.key}
            className={`squisq-paginated-page ${pageClassName} ${page.className ?? ''}`.trim()}
            style={{ ...pageStyle, ...pageStyleOverride }}
            role="group"
            aria-label={page.label}
          >
            {page.content as ReactNode}
          </div>
        ))}
      </div>
      {currentPage > 0 && (
        <button
          type="button"
          className={`squisq-paginated-nav squisq-paginated-nav--previous ${previousButtonClassName}`.trim()}
          aria-label="Previous page"
          onClick={() => updatePage((pendingPageRef.current ?? currentPage) - 1)}
        >
          {(renderPreviousIcon?.() ?? '\u2039') as ReactNode}
        </button>
      )}
      {currentPage < lastPage && (
        <button
          type="button"
          className={`squisq-paginated-nav squisq-paginated-nav--next ${nextButtonClassName}`.trim()}
          aria-label="Next page"
          onClick={() => updatePage((pendingPageRef.current ?? currentPage) + 1)}
        >
          {(renderNextIcon?.() ?? '\u203a') as ReactNode}
        </button>
      )}
      {resolvedPages.length > 0 && (
        <div
          className={`squisq-paginated-indicator ${indicatorClassName}`.trim()}
          aria-live="polite"
        >
          <span className={indicatorTextClassName}>
            {currentPage + 1} / {resolvedPages.length}
          </span>
        </div>
      )}
    </div>
  );
}
