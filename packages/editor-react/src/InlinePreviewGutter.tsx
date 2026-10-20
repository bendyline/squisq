/**
 * InlinePreviewGutter
 *
 * Renders one small SVG preview card per block in the
 * current document, positioned to vertically align with its corresponding
 * heading in whichever editor view is active. A diagonal connector line
 * + vertical block-extent bars bridge each heading and its preview card.
 *
 * The gutter consumes the parsed `Doc` from `useEditorContext()` and reuses
 * the shared preview pipeline (`resolveBlockVisual` → `BlockRenderer`), including
 * content-preserving defaults for blocks without template annotations.
 *
 * Auto-hides via container queries when the surrounding container is too
 * narrow (see `.squisq-editor-with-gutter` rules in `styles/editor.css`).
 *
 * Implementation notes:
 * - **View-agnostic positioning** — heading positions, page edges, and
 *   click-to-scroll all come from `useHeadingLayout()`, which has
 *   per-view backends (DOM-query for WYSIWYG, Monaco API for Markdown).
 *   The component only handles card stacking (which needs rendered card
 *   heights) and the visual rendering layer.
 * - **Card stacking** — cards are absolutely positioned with `top` set
 *   from each heading's hook-supplied position. If two headings sit too
 *   close together, the lower card slides down so cards never overlap;
 *   the connector line then slopes from the (still heading-anchored)
 *   bar across to the (now lower) card.
 */

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Block, ViewportConfig, MediaProvider } from '@bendyline/squisq/schemas';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import { flattenRenderableBlocks, DEFAULT_THEME } from '@bendyline/squisq/doc';
import { extractPlainText } from '@bendyline/squisq/markdown';
import { BlockRenderer, MediaContext } from '@bendyline/squisq-react';
import { usePreviewSettingsOptional } from './PreviewControls';
import { useEditorContext } from './EditorContext';
import { templateLabel } from './TemplatePicker';
import { useHeadingLayout } from './useHeadingLayout';
import { usePreviewProjection } from './usePreviewProjection';
import { resolveBlockVisual } from './resolveBlockVisual';

// ── Types ──────────────────────────────────────────────────────────

export interface InlinePreviewGutterProps {
  /** Width of the gutter in pixels (default: 320). */
  width?: number;
  /** Base path for resolving media URLs in card thumbnails. */
  basePath?: string;
  /** Viewport used to render each card (default: landscape preset). */
  viewport?: ViewportConfig;
  /** Optional CSS class for the outer container. */
  className?: string;
  /**
   * Width in pixels of the connector strip that bridges the editor and
   * the gutter. Defaults to 24.
   */
  connectorWidth?: number;
  /**
   * Optional MediaProvider used to resolve relative image src values inside
   * preview cards. When omitted, images with relative paths fall back to
   * `basePath`-prefixed URLs (which usually 404 in container-backed editors).
   */
  mediaProvider?: MediaProvider | null;
}

interface PreviewItem {
  id: string;
  template: string;
  headingText: string;
  block: Block;
  sourceBlock: Block;
}

// ── Connector layout constants ─────────────────────────────────────

/** Distance from the strip's right edge to the bar's right edge (px). */
const BAR_RIGHT_OFFSET = 14;
/** Vertical offset within a card to the center of the caption row. Card
 *  padding (8) + half line-height of the 12px label (~8) ≈ 16. */
const CARD_LABEL_OFFSET = 16;
/** Vertical offset from heading top to the left connector dot. Matches
 *  CARD_LABEL_OFFSET so the line is horizontal when the card sits at its
 *  natural (heading-aligned) position. */
const EXTENT_TOP_PAD = CARD_LABEL_OFFSET;
/** Card's `left: 12px` inside the gutter — used to land the right circle on
 *  the card's left edge for the diagonal connector line. */
const CARD_LEFT_INSET = 12;

// ── Component ──────────────────────────────────────────────────────

export function InlinePreviewGutter({
  width = 320,
  basePath = '/',
  viewport = VIEWPORT_PRESETS.landscape,
  className,
  connectorWidth = 24,
  mediaProvider = null,
}: InlinePreviewGutterProps) {
  const { doc, workspaceContainer, fileName, mediaRevision } = useEditorContext();
  const projection = usePreviewProjection(doc, '', workspaceContainer, fileName, mediaRevision);
  const previewDoc = projection?.contentDoc ?? doc;
  const gutterRef = useRef<HTMLElement | null>(null);
  const { entries: headingEntries, scrollToBlock } = useHeadingLayout(gutterRef);
  // Follow the document's active theme so the mini cards reflect the
  // same palette as the main preview surface. PreviewSettingsProvider
  // resolves this from frontmatter (`squisq-theme` / legacy `theme`)
  // and theme overrides, so we never duplicate that logic here. Falls
  // back to DEFAULT_THEME when the gutter is mounted outside the
  // provider (defensive — EditorShell always wraps with it).
  const previewSettings = usePreviewSettingsOptional();
  const activeTheme = previewSettings?.activeTheme ?? DEFAULT_THEME;

  // Keep the source block for positioning/navigation: the preview projection
  // intentionally strips source headings while choosing a renderable template.
  const items = useMemo<PreviewItem[]>(() => {
    if (!previewDoc || !previewDoc.blocks.length) return [];
    const flat = flattenRenderableBlocks(previewDoc.blocks);
    const result: PreviewItem[] = [];

    flat.forEach((block, index) => {
      const visual = resolveBlockVisual(previewDoc, block, activeTheme, viewport, {
        blockIndex: index,
        totalBlocks: flat.length,
      });
      if (!visual) return;
      result.push({
        id: block.id,
        template: visual.template ?? 'content',
        headingText: block.sourceHeading ? extractPlainText(block.sourceHeading) : '',
        block: visual,
        sourceBlock: block,
      });
    });

    return result;
  }, [previewDoc, viewport, activeTheme]);

  // Heading top per item id — derived from the layout hook. The connector
  // dot tracks this even when stacking pushes the card below.
  const connectorTops = useMemo(() => {
    const m = new Map<string, number>();
    headingEntries.forEach((e) => m.set(e.block.id, e.top));
    return m;
  }, [headingEntries]);

  // Card stacking state — populated by a small post-render measurement
  // pass that reads each card's height to push subsequent cards down.
  const [positions, setPositions] = useState<Map<string, number>>(new Map());

  useLayoutEffect(() => {
    if (items.length === 0) {
      setPositions((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    const gutter = gutterRef.current;
    if (!gutter) return;
    const cardEls = gutter.querySelectorAll<HTMLElement>('.squisq-inline-preview-card');
    const STACK_GAP = 12;
    const FALLBACK_CARD_HEIGHT = 220;
    let lastBottom = -Infinity;
    const next = new Map<string, number>();
    items.forEach((item, i) => {
      const headingTop = connectorTops.get(item.id);
      if (headingTop == null) return;
      const top = Math.max(headingTop, lastBottom + STACK_GAP);
      next.set(item.id, top);
      const cardEl = cardEls[i];
      const cardHeight = cardEl ? cardEl.getBoundingClientRect().height : FALLBACK_CARD_HEIGHT;
      lastBottom = top + cardHeight;
    });
    setPositions((prev) => {
      if (prev.size === next.size) {
        let same = true;
        for (const [k, v] of next) {
          const p = prev.get(k);
          if (p == null || Math.abs(p - v) > 0.5) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return next;
    });
  }, [items, connectorTops]);

  const isEmpty = items.length === 0;
  if (isEmpty) return null;

  const totalWidth = width + connectorWidth;
  const gutterStyle: CSSProperties = {
    position: 'relative',
    width: `${totalWidth}px`,
    flex: `0 0 ${totalWidth}px`,
    overflow: 'hidden',
  };

  return (
    <aside
      ref={gutterRef}
      className={`squisq-inline-preview-gutter ${className ?? ''}`}
      style={gutterStyle}
      data-testid="inline-preview-gutter"
      aria-label="Block previews"
    >
      {/* Connector strip — vertical bracket bars per heading, on the
          left edge of the gutter so they sit immediately next to the
          editor body. */}
      {headingEntries.length > 0 && (
        <div
          className="squisq-inline-preview-connectors"
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: connectorWidth,
            height: '100%',
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          {headingEntries.map((ex, i) => {
            const EXTENT_GAP = 6;
            const height = Math.max(2, ex.bottom - ex.top - EXTENT_GAP);
            return (
              <div
                key={`h-${i}-${ex.block.id}`}
                className={`squisq-inline-preview-extent${
                  ex.annotated ? '' : ' squisq-inline-preview-extent--untagged'
                }`}
                style={{
                  position: 'absolute',
                  top: `${ex.top}px`,
                  height: `${height}px`,
                  right: `${BAR_RIGHT_OFFSET}px`,
                }}
              />
            );
          })}
        </div>
      )}
      {/* Diagonal connector SVG — overlays the connector strip + the
          start of the card area, drawing a line from each bar to its
          card's caption row. */}
      {items.length > 0 && (
        <svg
          className="squisq-inline-preview-connector-svg"
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: connectorWidth + CARD_LEFT_INSET,
            height: '100%',
            pointerEvents: 'none',
            overflow: 'visible',
          }}
        >
          {items.map((item) => {
            const headingTop = connectorTops.get(item.id);
            const cardTop = positions.get(item.id);
            if (headingTop == null || cardTop == null) return null;
            const x1 = connectorWidth - BAR_RIGHT_OFFSET - 2;
            const y1 = headingTop + EXTENT_TOP_PAD;
            const x2 = connectorWidth + CARD_LEFT_INSET;
            const y2 = cardTop + CARD_LABEL_OFFSET;
            return (
              <g key={item.id}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="#6366f1"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx={x1} cy={y1} r="4" fill="#6366f1" stroke="#ffffff" strokeWidth="2" />
                <circle cx={x2} cy={y2} r="4" fill="#6366f1" stroke="#ffffff" strokeWidth="2" />
              </g>
            );
          })}
        </svg>
      )}

      {/* Positioned preview cards. */}
      <MediaContext.Provider value={mediaProvider ?? null}>
        {items.map((item) => {
          const top = positions.get(item.id);
          const hidden = top == null;
          return (
            <div
              key={item.id}
              className="squisq-inline-preview-card"
              data-template={item.template}
              style={{
                position: 'absolute',
                top: `${top ?? 0}px`,
                left: connectorWidth + CARD_LEFT_INSET,
                right: 12,
                visibility: hidden ? 'hidden' : 'visible',
              }}
              onClick={() => scrollToBlock(item.sourceBlock)}
            >
              <div className="squisq-inline-preview-card-label">
                <span className="squisq-inline-preview-card-template">
                  {templateLabel(item.template)}
                </span>
                {item.headingText && (
                  <>
                    <span className="squisq-inline-preview-card-sep">—</span>
                    <span className="squisq-inline-preview-card-title">{item.headingText}</span>
                  </>
                )}
              </div>
              <div
                className="squisq-inline-preview-card-svg"
                style={{
                  aspectRatio: `${viewport.width} / ${viewport.height}`,
                }}
              >
                <BlockRenderer
                  block={item.block}
                  buildPlayback="all"
                  blockTime={0}
                  basePath={basePath}
                  viewport={viewport}
                />
              </div>
            </div>
          );
        })}
      </MediaContext.Provider>
    </aside>
  );
}
