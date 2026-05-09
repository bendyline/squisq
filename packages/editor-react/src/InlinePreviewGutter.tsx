/**
 * InlinePreviewGutter
 *
 * Renders one small SVG preview card per template-annotated block in the
 * current document, positioned to vertically align with its corresponding
 * heading in the WYSIWYG editor. A short horizontal connector line bridges
 * each heading and its preview card.
 *
 * The gutter consumes the parsed `Doc` from `useEditorContext()` and reuses
 * the same template-resolution path as `LinearDocView` (heading text →
 * template defaults → `getLayers()` → `BlockRenderer`).
 *
 * Auto-hides via container queries when the surrounding container is too
 * narrow (see `.squisq-wysiwyg-with-gutter` rules in `styles/editor.css`).
 *
 * Implementation notes:
 * - Cards are absolutely positioned inside the gutter with `top` synced to
 *   each heading's position relative to the gutter's top edge. Because both
 *   reference frames live in viewport coordinates, scroll changes are
 *   automatically reflected after a recompute.
 * - The connector layer is rendered as a sibling absolute overlay sitting
 *   immediately to the left of the gutter, so the lines can cross the gap
 *   between editor and gutter without fighting `overflow: hidden`.
 * - We pair items to DOM headings by ordinal index of `[data-template]`
 *   elements within the WYSIWYG container — this matches markdown order.
 */

import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Block, DocBlock, ViewportConfig } from '@bendyline/squisq/schemas';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import {
  flattenBlocks,
  getLayers,
  hasTemplate,
  DEFAULT_THEME,
  type RenderContext,
} from '@bendyline/squisq/doc';
import { extractPlainText } from '@bendyline/squisq/markdown';
import type { MarkdownBlockNode, MarkdownList, MarkdownTable } from '@bendyline/squisq/markdown';
import { BlockRenderer } from '@bendyline/squisq-react';
import { useEditorContext } from './EditorContext';
import { templateLabel } from './TemplatePicker';

// ── Helpers (mirrored from LinearDocView; kept local to avoid cross-package
// churn — extract to a shared module if a fourth copy appears) ────────────

function isAnnotated(block: Block): boolean {
  const annotation = block.sourceHeading?.templateAnnotation;
  if (!annotation) return false;
  return !!annotation.template && hasTemplate(annotation.template);
}

function extractBodyPlainText(contents?: MarkdownBlockNode[]): string {
  if (!contents || contents.length === 0) return '';
  return contents
    .map((n) => extractPlainText(n))
    .join('\n')
    .trim();
}

function extractListItems(contents?: MarkdownBlockNode[]): string[] {
  if (!contents) return [];
  const items: string[] = [];
  for (const node of contents) {
    if (node.type === 'list') {
      for (const item of (node as MarkdownList).children) {
        const text = extractPlainText(item).trim();
        if (text) items.push(text);
      }
    }
  }
  return items;
}

function extractTableData(contents?: MarkdownBlockNode[]): {
  headers: string[];
  rows: string[][];
  align?: (('left' | 'right' | 'center') | null)[];
} | null {
  if (!contents) return null;
  for (const node of contents) {
    if (node.type === 'table') {
      const table = node as MarkdownTable;
      const [headerRow, ...bodyRows] = table.children;
      if (!headerRow) return null;
      const headers = headerRow.children.map((cell) => extractPlainText(cell).trim());
      const rows = bodyRows.map((row) => row.children.map((cell) => extractPlainText(cell).trim()));
      return { headers, rows, align: table.align };
    }
  }
  return null;
}

function getTemplateDefaults(
  templateName: string,
  headingText: string,
  bodyText: string,
  contents?: MarkdownBlockNode[],
): Record<string, unknown> {
  switch (templateName) {
    case 'statHighlight':
      return { stat: headingText, description: bodyText || headingText };
    case 'quoteBlock':
    case 'fullBleedQuote':
    case 'pullQuote':
      return { quote: bodyText || headingText };
    case 'factCard':
      return { fact: headingText, explanation: bodyText || headingText };
    case 'comparisonBar':
      return { leftLabel: 'A', leftValue: 60, rightLabel: 'B', rightValue: 40 };
    case 'listBlock': {
      const items = extractListItems(contents);
      return { items: items.length > 0 ? items : ['Item 1', 'Item 2', 'Item 3'] };
    }
    case 'definitionCard':
      return { term: headingText, definition: bodyText || headingText };
    case 'dateEvent':
      return { date: headingText, description: bodyText || headingText };
    case 'dataTable': {
      const tableData = extractTableData(contents);
      return tableData ?? { headers: ['Column'], rows: [['Data']] };
    }
    default:
      return {};
  }
}

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
}

interface PreviewItem {
  id: string;
  template: string;
  headingText: string;
  block: Block;
}

// ── Component ──────────────────────────────────────────────────────

export function InlinePreviewGutter({
  width = 320,
  basePath = '/',
  viewport = VIEWPORT_PRESETS.landscape,
  className,
  connectorWidth = 24,
}: InlinePreviewGutterProps) {
  const { doc } = useEditorContext();
  const gutterRef = useRef<HTMLElement | null>(null);
  // Card tops, after the de-overlap stacking pass.
  const [positions, setPositions] = useState<Map<string, number>>(new Map());
  // Connector tops, kept aligned to each heading's row so the dots stay
  // anchored even when their card has been pushed down to clear the
  // previous card.
  const [connectorTops, setConnectorTops] = useState<Map<string, number>>(new Map());
  // Vertical extents for every heading (annotated or not). Drives the
  // vertical bracket lines in the connector strip — annotated blocks get
  // a stronger color and pair with a horizontal connector to their card.
  const [allBlockExtents, setAllBlockExtents] = useState<
    Array<{ key: string; top: number; bottom: number; annotated: boolean }>
  >([]);
  // Where the editor's centered "page" ends, in pixels relative to the
  // wrapper. The gutter sits at this offset so it tracks the page edge
  // rather than the (much wider) container edge.
  const [pageRight, setPageRight] = useState<number | null>(null);

  const items = useMemo<PreviewItem[]>(() => {
    if (!doc || !doc.blocks.length) return [];
    const flat = flattenBlocks(doc.blocks);
    const totalBlocks = flat.length;
    const result: PreviewItem[] = [];

    flat.forEach((block, index) => {
      if (!isAnnotated(block)) return;
      const annotation = block.sourceHeading!.templateAnnotation!;
      const template = annotation.template!;
      const headingText = block.sourceHeading ? extractPlainText(block.sourceHeading) : '';
      const bodyText = extractBodyPlainText(block.contents);

      const templateBlock: Record<string, unknown> = {
        id: block.id,
        template,
        startTime: 0,
        duration: 1,
        audioSegment: 0,
        title: headingText,
        ...getTemplateDefaults(template, headingText, bodyText, block.contents),
        ...annotation.params,
        ...block.templateOverrides,
      };

      const ctx: RenderContext = {
        blockIndex: index,
        totalBlocks,
        theme: DEFAULT_THEME,
        viewport,
      };

      try {
        const layers = getLayers(templateBlock as unknown as DocBlock, ctx);
        const visualBlock = {
          ...block,
          layers,
          template,
        } as Block;
        result.push({
          id: block.id,
          template,
          headingText,
          block: visualBlock,
        });
      } catch (err: unknown) {
        // Skip blocks that fail to render — keep the gutter resilient
        // when authors are mid-edit and a template's required field
        // is temporarily missing.
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[InlinePreviewGutter] Skipped block "${block.id}" (${template}): ${message}`);
      }
    });

    return result;
  }, [doc, viewport]);

  // Recompute the vertical position of each card so it lines up with the
  // top of its corresponding heading inside the WYSIWYG editor. Cards are
  // paired with `[data-template]` elements by ordinal index — markdown
  // order matches DOM order.
  useLayoutEffect(() => {
    const gutter = gutterRef.current;
    if (!gutter) return;

    const wrapper = gutter.parentElement;
    if (!wrapper) return;
    const wysiwygContainer = wrapper.querySelector(
      '.squisq-wysiwyg-container',
    ) as HTMLElement | null;
    if (!wysiwygContainer) return;

    let raf = 0;
    const recompute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // Match only heading elements — badges inside the heading also
        // carry `data-template`, so a bare `[data-template]` selector
        // doubles every match and breaks pairing by ordinal index.
        const headings = wysiwygContainer.querySelectorAll<HTMLElement>(
          'h1[data-template], h2[data-template], h3[data-template], h4[data-template], h5[data-template], h6[data-template]',
        );
        // All headings (annotated or not) drive each block's vertical
        // extent — a block reaches from its heading down to the next
        // heading (any level) or the editor bottom.
        const allHeadings = Array.from(
          wysiwygContainer.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'),
        );
        const editorRect = wysiwygContainer.getBoundingClientRect();
        const gutterRect = gutter.getBoundingClientRect();
        // Existing card elements are queried so we can use their measured
        // heights for the stacking pass below. On the very first run the
        // cards are already in the DOM at top:0 with visibility:hidden,
        // so their heights are valid. Cards rendered after items change
        // get measured on the next observer-triggered recompute.
        const cardEls = gutter.querySelectorAll<HTMLElement>('.squisq-inline-preview-card');
        const next = new Map<string, number>();
        const nextConnectors = new Map<string, number>();
        const nextAllExtents: Array<{
          key: string;
          top: number;
          bottom: number;
          annotated: boolean;
        }> = [];

        // Compute extent for every heading (annotated or not). The extent
        // runs from this heading's top to the next heading's top, or to
        // the editor bottom for the last one.
        allHeadings.forEach((h, i) => {
          const top = h.getBoundingClientRect().top - gutterRect.top;
          const nextH = i < allHeadings.length - 1 ? allHeadings[i + 1] : null;
          const bottom = nextH
            ? nextH.getBoundingClientRect().top - gutterRect.top
            : editorRect.bottom - gutterRect.top;
          nextAllExtents.push({
            key: `h-${i}`,
            top,
            bottom,
            annotated: !!h.getAttribute('data-template'),
          });
        });
        // Minimum vertical gap between adjacent cards.
        const STACK_GAP = 12;
        // Used until a real card height is measured (covers the brief
        // window after a new template is added but before its card has
        // mounted). Picked to roughly match a landscape-aspect preview
        // card with one-line label.
        const FALLBACK_CARD_HEIGHT = 220;
        let lastBottom = -Infinity;
        items.forEach((item, i) => {
          const h = headings[i];
          if (!h) return;
          const hRect = h.getBoundingClientRect();
          const headingTop = hRect.top - gutterRect.top;
          // Connector dot tracks the heading row, regardless of whether
          // the card had to slide down to clear the previous one.
          nextConnectors.set(item.id, headingTop);
          // Stack: push the card down if its heading-aligned top would
          // overlap the previous card.
          const top = Math.max(headingTop, lastBottom + STACK_GAP);
          next.set(item.id, top);
          const cardEl = cardEls[i];
          const cardHeight = cardEl
            ? cardEl.getBoundingClientRect().height
            : FALLBACK_CARD_HEIGHT;
          lastBottom = top + cardHeight;
        });
        const dedupMap = (prev: Map<string, number>, n: Map<string, number>) => {
          if (prev.size === n.size) {
            let same = true;
            for (const [k, v] of n) {
              const prevV = prev.get(k);
              // Treat a missing key as a real change — block ids shift
              // when heading text is edited, and the dedup must catch
              // that or the card sticks on its old (now-empty) id.
              if (prevV == null || Math.abs(prevV - v) > 0.5) {
                same = false;
                break;
              }
            }
            if (same) return prev;
          }
          return n;
        };
        setPositions((prev) => dedupMap(prev, next));
        setConnectorTops((prev) => dedupMap(prev, nextConnectors));
        setAllBlockExtents((prev) => {
          if (prev.length === nextAllExtents.length) {
            let same = true;
            for (let i = 0; i < prev.length; i++) {
              const a = prev[i];
              const b = nextAllExtents[i];
              if (
                a.annotated !== b.annotated ||
                Math.abs(a.top - b.top) > 0.5 ||
                Math.abs(a.bottom - b.bottom) > 0.5
              ) {
                same = false;
                break;
              }
            }
            if (same) return prev;
          }
          return nextAllExtents;
        });

        // Track the editor page's right edge so the gutter can hug it
        // instead of floating at the far end of the container.
        const page = wysiwygContainer.querySelector('.squisq-wysiwyg-editor') as HTMLElement | null;
        const wrapperEl = wrapper.getBoundingClientRect();
        if (page) {
          const pageRect = page.getBoundingClientRect();
          const offset = pageRect.right - wrapperEl.left;
          setPageRight((prev) => (prev != null && Math.abs(prev - offset) < 0.5 ? prev : offset));
        }
      });
    };

    recompute();

    const editorSurface = wysiwygContainer.querySelector('.squisq-wysiwyg-editor');
    const ro = new ResizeObserver(recompute);
    ro.observe(wysiwygContainer);
    if (editorSurface) ro.observe(editorSurface);

    const mo = new MutationObserver(recompute);
    mo.observe(wysiwygContainer, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-template', 'data-template-params'],
    });

    wysiwygContainer.addEventListener('scroll', recompute, { passive: true });
    window.addEventListener('resize', recompute);

    // Re-run a positioning pass shortly after mount to catch fonts /
    // images settling — some headings shift down once webfonts load.
    const settleTimer = window.setTimeout(recompute, 250);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settleTimer);
      ro.disconnect();
      mo.disconnect();
      wysiwygContainer.removeEventListener('scroll', recompute);
      window.removeEventListener('resize', recompute);
    };
  }, [items]);

  const isEmpty = items.length === 0;
  // Until measured, fall back to right-anchored layout so the gutter
  // doesn't flicker at left:0.
  const gutterLeft = pageRight != null ? `${pageRight + connectorWidth}px` : undefined;
  const gutterStyle: CSSProperties = {
    width: `${width}px`,
    overflow: 'hidden',
    ...(gutterLeft
      ? { position: 'absolute', top: 0, bottom: 0, left: gutterLeft }
      : { position: 'absolute', top: 0, bottom: 0, right: 0 }),
    visibility: pageRight == null ? 'hidden' : 'visible',
  };

  return (
    <>
      {/* Connector strip — sits in the wrapper just to the left of the
          gutter so each line can bridge the gap between the editor's
          right edge and the card's left edge without being clipped. */}
      {pageRight != null && allBlockExtents.length > 0 && (
        <div
          className="squisq-inline-preview-connectors"
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            left: pageRight,
            width: connectorWidth,
            height: '100%',
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          {/* Vertical bracket line per heading (annotated or not). Tagged
              blocks get a stronger color since they're paired with a card.
              A small bottom gap visually separates adjacent bars so the
              eye can pick out individual blocks even when several
              same-colored untagged bars stack next to each other. */}
          {allBlockExtents.map((ex) => {
            const EXTENT_GAP = 6;
            const height = Math.max(2, ex.bottom - ex.top - EXTENT_GAP);
            return (
              <div
                key={ex.key}
                className={`squisq-inline-preview-extent${
                  ex.annotated ? '' : ' squisq-inline-preview-extent--untagged'
                }`}
                style={{
                  position: 'absolute',
                  top: `${ex.top}px`,
                  height: `${height}px`,
                  right: 0,
                }}
              />
            );
          })}
          {/* Short horizontal connector at each annotated heading row,
              bridging the vertical line to the card. */}
          {items.map((item) => {
            const top = connectorTops.get(item.id);
            if (top == null) return null;
            return (
              <div
                key={item.id}
                className="squisq-inline-preview-connector"
                style={{
                  position: 'absolute',
                  top: `${top + 12}px`,
                  left: 0,
                  right: 0,
                }}
              />
            );
          })}
        </div>
      )}

      <aside
        ref={gutterRef}
        className={`squisq-inline-preview-gutter ${className ?? ''}`}
        style={gutterStyle}
        data-testid="inline-preview-gutter"
        aria-label="Block previews"
      >
        {isEmpty ? (
          <div className="squisq-inline-preview-empty">
            <p>Tag a heading with a template to see a preview here.</p>
          </div>
        ) : (
          items.map((item) => {
            const top = positions.get(item.id);
            // Hide cards we haven't measured yet to avoid a flash at top:0.
            const hidden = top == null;
            return (
              <div
                key={item.id}
                className="squisq-inline-preview-card"
                data-template={item.template}
                style={{
                  position: 'absolute',
                  top: `${top ?? 0}px`,
                  left: 12,
                  right: 12,
                  visibility: hidden ? 'hidden' : 'visible',
                }}
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
                    blockTime={0}
                    basePath={basePath}
                    viewport={viewport}
                  />
                </div>
              </div>
            );
          })
        )}
      </aside>
    </>
  );
}
