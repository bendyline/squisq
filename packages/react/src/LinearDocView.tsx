/**
 * LinearDocView Component
 *
 * Renders a Doc as a long-scrolling document view. Each block is displayed
 * as a readable section: non-annotated blocks render their markdown content
 * as HTML, while template-annotated blocks render as inline SVG visual cards
 * via BlockRenderer.
 *
 * This is the view used when `displayMode === 'linear'` in DocPlayer.
 *
 * Layout:
 * - Scrollable container with max-width for readability
 * - Headings from the block hierarchy rendered as HTML headings
 * - Body content rendered via MarkdownRenderer
 * - Template-annotated sections show an SVG card (BlockRenderer)
 *   using `getLayers()` for on-demand layer computation
 * - Blocks are rendered recursively to preserve the heading hierarchy
 */

import { useMemo } from 'react';
import type { Doc, Block, DocBlock } from '@bendyline/squisq/schemas';
import type { ViewportConfig } from '@bendyline/squisq/schemas';
import type { Theme } from '@bendyline/squisq/schemas';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import { getLayers, hasTemplate, DEFAULT_THEME } from '@bendyline/squisq/doc';
import type { RenderContext } from '@bendyline/squisq/doc';
import { extractPlainText } from '@bendyline/squisq/markdown';
import type { MarkdownBlockNode, MarkdownList, MarkdownTable } from '@bendyline/squisq/markdown';
import { BlockRenderer } from './BlockRenderer';
import { MarkdownRenderer } from './MarkdownRenderer';

// ── Props ──────────────────────────────────────────────────────────

export interface LinearDocViewProps {
  /** The Doc to render */
  doc: Doc;
  /** Base path for resolving media URLs (images, etc.) */
  basePath?: string;
  /** Viewport config for SVG card rendering (default: landscape) */
  viewport?: ViewportConfig;
  /** Optional CSS class for the outer container */
  className?: string;
  /** Theme to use for rendering (default: DEFAULT_THEME from the theme library) */
  theme?: Theme;
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Determine whether a block has a template annotation that should be
 * rendered as a visual SVG card. A block is "annotated" when:
 * 1. Its sourceHeading has a templateAnnotation, AND
 * 2. The annotated template exists in the registry
 */
function isAnnotatedBlock(block: Block): boolean {
  const annotation = block.sourceHeading?.templateAnnotation;
  if (!annotation) return false;
  return !!annotation.template && hasTemplate(annotation.template);
}

/**
 * Count total blocks in a hierarchy (for RenderContext.totalBlocks).
 */
function countAll(blocks: Block[]): number {
  let count = 0;
  for (const b of blocks) {
    count++;
    if (b.children) count += countAll(b.children);
  }
  return count;
}

// ── Block Section Renderer ─────────────────────────────────────────

interface BlockSectionProps {
  block: Block;
  basePath: string;
  viewport: ViewportConfig;
  renderContext: RenderContext;
  blockIndex: number;
}

/**
 * Render a single block section: heading + body content or SVG card.
 * Recurses into children to render the full heading tree.
 */
function BlockSection({ block, basePath, viewport, renderContext, blockIndex }: BlockSectionProps) {
  const isAnnotated = isAnnotatedBlock(block);

  // For annotated blocks, compute layers and build a Block with them
  const visualBlock = useMemo(() => {
    if (!isAnnotated) return null;

    const annotation = block.sourceHeading!.templateAnnotation!;
    const headingText = extractPlainText(block.sourceHeading!);
    const bodyText = extractBodyPlainText(block.contents);

    // Build a TemplateBlock-compatible object
    const templateBlock: Record<string, unknown> = {
      id: block.id,
      template: annotation.template,
      startTime: 0,
      duration: 1,
      audioSegment: 0,
      title: headingText,
      ...getTemplateDefaults(
        annotation.template ?? 'sectionHeader',
        headingText,
        bodyText,
        block.contents,
      ),
      ...annotation.params,
      ...block.templateOverrides,
    };

    // Compute layers via getLayers
    const ctx: RenderContext = {
      ...renderContext,
      blockIndex,
    };
    const layers = getLayers(templateBlock as unknown as DocBlock, ctx);

    return {
      ...block,
      layers,
      template: annotation.template,
    } as Block;
  }, [block, isAnnotated, renderContext, blockIndex]);

  return (
    <div
      className="squisq-linear-section"
      data-block-id={block.id}
      data-template={isAnnotated ? block.sourceHeading?.templateAnnotation?.template : undefined}
    >
      {/* Render the heading (if present — preamble has no sourceHeading) */}
      {block.sourceHeading && !isAnnotated && <MarkdownRenderer nodes={[block.sourceHeading]} />}

      {/* Annotated block: render SVG card */}
      {isAnnotated && visualBlock && (
        <div className="squisq-linear-card">
          {/* Optional heading label above the card */}
          {block.sourceHeading && (
            <div className="squisq-linear-card-label squisq-md">
              <MarkdownRenderer nodes={[block.sourceHeading]} />
            </div>
          )}
          <div
            className="squisq-linear-card-svg"
            style={{
              width: '100%',
              aspectRatio: `${viewport.width} / ${viewport.height}`,
              overflow: 'hidden',
              borderRadius: '8px',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)',
              marginBottom: '1em',
            }}
          >
            <BlockRenderer
              block={visualBlock}
              blockTime={0}
              basePath={basePath}
              viewport={viewport}
            />
          </div>
        </div>
      )}

      {/* Body content (always render for non-annotated blocks, skipped for annotated) */}
      {!isAnnotated && block.contents && block.contents.length > 0 && (
        <MarkdownRenderer nodes={block.contents} />
      )}

      {/* Recurse into children */}
      {block.children && block.children.length > 0 && (
        <div className="squisq-linear-children">
          {block.children.map((child, i) => (
            <BlockSection
              key={child.id}
              block={child}
              basePath={basePath}
              viewport={viewport}
              renderContext={renderContext}
              blockIndex={blockIndex + i + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Template Defaults (mirrored from PreviewPanel) ─────────────────

/** Extract plain text from block contents. */
function extractBodyPlainText(contents?: MarkdownBlockNode[]): string {
  if (!contents || contents.length === 0) return '';
  return contents
    .map((n) => extractPlainText(n))
    .join('\n')
    .trim();
}

/** Extract list items as plain text. */
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

/** Extract table data (headers, rows, alignment) from block contents. */
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

/**
 * Provide sensible default fields for templates that require more than
 * just a `title`. Prevents crashes from undefined required fields.
 */
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
    case 'listBlock':
      return { items: extractListItems(contents) || ['Item 1', 'Item 2', 'Item 3'] };
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

// ── Main Component ─────────────────────────────────────────────────

/**
 * Renders a Doc as a long-scrolling, readable document.
 *
 * Non-annotated blocks are rendered as HTML text (headings, paragraphs,
 * lists, etc.) via MarkdownRenderer. Template-annotated blocks are
 * rendered as inline SVG visual cards via BlockRenderer.
 *
 * @example
 * ```tsx
 * <LinearDocView doc={doc} basePath="/media/" />
 * ```
 */
export function LinearDocView({
  doc,
  basePath = '/',
  viewport,
  className,
  theme,
}: LinearDocViewProps) {
  const activeViewport = viewport ?? VIEWPORT_PRESETS.landscape;
  const totalBlocks = useMemo(() => countAll(doc.blocks), [doc.blocks]);

  const renderContext: RenderContext = useMemo(
    () => ({
      theme: theme ?? DEFAULT_THEME,
      viewport: activeViewport,
      totalBlocks,
    }),
    [activeViewport, totalBlocks, theme],
  );

  const activeTheme = renderContext.theme!;
  const bgColor = activeTheme.colors.background;
  const textColor = activeTheme.colors.text;
  const mutedColor = activeTheme.colors.textMuted;
  const primaryColor = activeTheme.colors.primary;
  const bodyFont = activeTheme.typography.bodyFontFamily;
  const titleFont = activeTheme.typography.titleFontFamily;
  const lineHt = activeTheme.typography.lineHeight ?? 1.7;

  return (
    <div
      className={`squisq-linear ${className || ''}`}
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        background: bgColor,
      }}
    >
      <div
        className="squisq-linear-content squisq-md"
        style={
          {
            maxWidth: '720px',
            margin: '0 auto',
            padding: '24px 16px',
            lineHeight: lineHt,
            fontSize: '16px',
            fontFamily: bodyFont,
            color: textColor,
            // CSS custom properties for MarkdownRenderer / nested elements
            '--squisq-linear-title-font': titleFont,
            '--squisq-linear-body-font': bodyFont,
            '--squisq-linear-text': textColor,
            '--squisq-linear-muted': mutedColor,
            '--squisq-linear-primary': primaryColor,
            '--squisq-linear-bg': bgColor,
          } as React.CSSProperties
        }
      >
        {/* Theme-aware typography and layout for document mode */}
        <style>{`
          .squisq-linear-content h1,
          .squisq-linear-content h2,
          .squisq-linear-content h3,
          .squisq-linear-content h4,
          .squisq-linear-content h5,
          .squisq-linear-content h6 {
            font-family: var(--squisq-linear-title-font);
            color: var(--squisq-linear-text);
            margin-top: 1.2em;
            margin-bottom: 0.4em;
          }
          .squisq-linear-content h1 { font-size: 2em; }
          .squisq-linear-content h2 { font-size: 1.5em; }
          .squisq-linear-content h3 { font-size: 1.25em; }
          .squisq-linear-content p {
            margin-bottom: 0.75em;
          }
          .squisq-linear-content ul,
          .squisq-linear-content ol {
            padding-left: 2em;
            margin-bottom: 0.75em;
          }
          .squisq-linear-content li {
            margin-bottom: 0.3em;
          }
          .squisq-linear-content a {
            color: var(--squisq-linear-primary);
          }
          .squisq-linear-content code {
            color: var(--squisq-linear-primary);
            font-size: 0.9em;
            padding: 0.15em 0.3em;
            border-radius: 3px;
            background: rgba(128, 128, 128, 0.15);
          }
          .squisq-linear-content pre {
            padding: 1em;
            border-radius: 6px;
            background: rgba(0, 0, 0, 0.2);
            overflow-x: auto;
            margin-bottom: 0.75em;
          }
          .squisq-linear-content pre code {
            padding: 0;
            background: none;
          }
          .squisq-linear-content blockquote {
            border-left: 3px solid var(--squisq-linear-muted);
            color: var(--squisq-linear-muted);
            padding-left: 1em;
            margin-left: 0;
            margin-bottom: 0.75em;
          }
          .squisq-linear-content hr {
            border: none;
            border-top: 1px solid var(--squisq-linear-muted);
            margin: 1.5em 0;
          }
          .squisq-linear-content strong {
            font-weight: 700;
          }
          .squisq-linear-content em {
            font-style: italic;
          }
          .squisq-linear-content table {
            width: 100%;
            border-collapse: collapse;
            margin: 1em 0;
            font-size: 0.95em;
          }
          .squisq-linear-content thead th {
            background: var(--squisq-linear-primary);
            color: var(--squisq-linear-bg);
            font-family: var(--squisq-linear-title-font);
            font-weight: 600;
            padding: 10px 14px;
            text-align: left;
          }
          .squisq-linear-content tbody td {
            padding: 8px 14px;
            border-bottom: 1px solid color-mix(in srgb, var(--squisq-linear-muted) 30%, transparent);
          }
          .squisq-linear-content tbody tr:hover {
            background: color-mix(in srgb, var(--squisq-linear-primary) 8%, transparent);
          }
        `}</style>
        {doc.blocks.map((block, i) => (
          <BlockSection
            key={block.id}
            block={block}
            basePath={basePath}
            viewport={activeViewport}
            renderContext={renderContext}
            blockIndex={i}
          />
        ))}
      </div>
    </div>
  );
}
