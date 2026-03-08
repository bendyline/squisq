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
import type { Doc, Block } from '@bendyline/squisq/schemas';
import type { ViewportConfig } from '@bendyline/squisq/schemas';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import {
  getLayers,
  hasTemplate,
  DEFAULT_THEME,
} from '@bendyline/squisq/doc';
import type { RenderContext } from '@bendyline/squisq/doc';
import { extractPlainText } from '@bendyline/squisq/markdown';
import type { MarkdownBlockNode } from '@bendyline/squisq/markdown';
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
  return hasTemplate(annotation.template);
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
function BlockSection({
  block,
  basePath,
  viewport,
  renderContext,
  blockIndex,
}: BlockSectionProps) {
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
      ...getTemplateDefaults(annotation.template, headingText, bodyText, block.contents),
      ...annotation.params,
      ...block.templateOverrides,
    };

    // Compute layers via getLayers
    const ctx: RenderContext = {
      ...renderContext,
      blockIndex,
    };
    const layers = getLayers(templateBlock as any, ctx);

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
      {block.sourceHeading && !isAnnotated && (
        <MarkdownRenderer nodes={[block.sourceHeading]} />
      )}

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
  return contents.map((n) => extractPlainText(n)).join('\n').trim();
}

/** Extract list items as plain text. */
function extractListItems(contents?: MarkdownBlockNode[]): string[] {
  if (!contents) return [];
  const items: string[] = [];
  for (const node of contents) {
    if (node.type === 'list' && 'children' in node) {
      for (const item of (node as any).children || []) {
        const text = extractPlainText(item).trim();
        if (text) items.push(text);
      }
    }
  }
  return items;
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
}: LinearDocViewProps) {
  const activeViewport = viewport ?? VIEWPORT_PRESETS.landscape;
  const totalBlocks = useMemo(() => countAll(doc.blocks), [doc.blocks]);

  const renderContext: RenderContext = useMemo(
    () => ({
      theme: DEFAULT_THEME,
      viewport: activeViewport,
      totalBlocks,
    }),
    [activeViewport, totalBlocks],
  );

  return (
    <div
      className={`squisq-linear ${className || ''}`}
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      <div
        className="squisq-linear-content"
        style={{
          maxWidth: '720px',
          margin: '0 auto',
          padding: '24px 16px',
          lineHeight: 1.7,
          fontSize: '16px',
          color: 'var(--squisq-text, #1f2937)',
        }}
      >
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
