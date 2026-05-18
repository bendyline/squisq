/**
 * InlinePreviewGutter
 *
 * Renders one small SVG preview card per template-annotated block in the
 * current document, positioned to vertically align with its corresponding
 * heading in whichever editor view is active. A diagonal connector line
 * + vertical block-extent bars bridge each heading and its preview card.
 *
 * The gutter consumes the parsed `Doc` from `useEditorContext()` and reuses
 * the same template-resolution path as `LinearDocView` (heading text →
 * template defaults → `getLayers()` → `BlockRenderer`).
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
import type { Block, DocBlock, ViewportConfig } from '@bendyline/squisq/schemas';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import {
  flattenBlocks,
  getLayers,
  hasTemplate,
  DEFAULT_THEME,
  type RenderContext,
} from '@bendyline/squisq/doc';
import { extractPlainText, getChildren } from '@bendyline/squisq/markdown';
import { usePreviewSettingsOptional } from './PreviewControls';
import type {
  MarkdownBlockNode,
  MarkdownList,
  MarkdownNode,
  MarkdownTable,
} from '@bendyline/squisq/markdown';
import { BlockRenderer, MediaContext } from '@bendyline/squisq-react';
import type { MediaProvider } from '@bendyline/squisq/schemas';
import { useEditorContext } from './EditorContext';
import { templateLabel } from './TemplatePicker';
import { useHeadingLayout } from './useHeadingLayout';

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

interface PreviewImage {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

function parseDim(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function extractBlockImages(contents?: MarkdownBlockNode[]): PreviewImage[] {
  if (!contents || contents.length === 0) return [];
  const images: PreviewImage[] = [];

  // Walk an HTML sub-DOM looking for <img src="..."> elements that the
  // markdown parser produced for HTML-block / inline-HTML image tags.
  // (When WYSIWYG persists an explicit width/height the image round-trips
  // as <img …> rather than the ![](src) shorthand.)
  function walkHtml(node: {
    type: string;
    tagName?: string;
    attributes?: Record<string, string>;
    children?: unknown[];
  }): void {
    if (node.type === 'htmlElement' && node.tagName === 'img') {
      const src = node.attributes?.src;
      if (src) {
        images.push({
          src,
          alt: node.attributes?.alt ?? '',
          width: parseDim(node.attributes?.width),
          height: parseDim(node.attributes?.height),
        });
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        walkHtml(child as { type: string });
      }
    }
  }

  function walk(node: MarkdownNode): void {
    if ('type' in node && node.type === 'image' && 'url' in node) {
      const img = node as { url: string; alt?: string };
      if (img.url) images.push({ src: img.url, alt: img.alt ?? '' });
    }
    if ('type' in node && node.type === 'htmlBlock') {
      const block = node as unknown as { htmlChildren?: unknown[] };
      for (const child of block.htmlChildren ?? []) {
        walkHtml(child as { type: string });
      }
    }
    for (const child of getChildren(node)) walk(child);
  }
  for (const node of contents) walk(node);
  return images;
}

/** Like extractBlockImages, but also descends into the block's child blocks
 *  so an annotated parent block can pick up media defined in a sub-section. */
function collectImagesDeep(block: Block): PreviewImage[] {
  const images: PreviewImage[] = [];
  const seen = new Set<string>();
  function visit(b: Block): void {
    for (const img of extractBlockImages(b.contents)) {
      if (seen.has(img.src)) continue;
      seen.add(img.src);
      images.push(img);
    }
    for (const child of b.children ?? []) visit(child);
  }
  visit(block);
  return images;
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
  images: PreviewImage[] = [],
): Record<string, unknown> {
  switch (templateName) {
    case 'statHighlight':
      return { stat: headingText, description: bodyText || headingText };
    case 'quote':
    case 'fullBleedQuote':
    case 'pullQuote':
      return { quote: bodyText || headingText };
    case 'factCard':
      return { fact: headingText, explanation: bodyText || headingText };
    case 'comparisonBar':
      return { leftLabel: 'A', leftValue: 60, rightLabel: 'B', rightValue: 40 };
    case 'list': {
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
    case 'imageWithCaption': {
      const first = images[0];
      return {
        imageSrc: first?.src ?? '',
        imageAlt: first?.alt ?? headingText,
        caption: bodyText || headingText,
        captionPosition: 'bottom',
      };
    }
    case 'leftFeature':
    case 'rightFeature': {
      // Mirror the LinearDocView / buildPreviewDoc defaults so the
      // mini gutter card shows the same content as the main preview.
      const first = images[0];
      return {
        imageSrc: first?.src ?? '',
        imageAlt: first?.alt ?? headingText,
        imageWidth: first?.width,
        imageHeight: first?.height,
        title: headingText,
        body: bodyText,
      };
    }
    case 'videoWithCaption': {
      const first = images[0];
      return {
        videoSrc: first?.src ?? '',
        caption: bodyText || headingText,
        captionPosition: 'bottom',
      };
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
  const { doc } = useEditorContext();
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

  // Build the renderable PreviewItem list (just for annotated blocks).
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
        ...getTemplateDefaults(
          template,
          headingText,
          bodyText,
          block.contents,
          collectImagesDeep(block),
        ),
        ...annotation.params,
        ...block.templateOverrides,
      };

      const ctx: RenderContext = {
        blockIndex: index,
        totalBlocks,
        theme: activeTheme,
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
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[InlinePreviewGutter] Skipped block "${block.id}" (${template}): ${message}`);
      }
    });

    return result;
  }, [doc, viewport, activeTheme]);

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

      {/* Card area — empty placeholder OR positioned cards. */}
      {isEmpty ? (
        <div
          className="squisq-inline-preview-empty"
          style={{ position: 'absolute', top: 12, left: connectorWidth + 12, right: 12 }}
        >
          <p>Tag a heading with a template to see a preview here.</p>
        </div>
      ) : (
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
                onClick={() => scrollToBlock(item.block)}
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
          })}
        </MediaContext.Provider>
      )}
    </aside>
  );
}
