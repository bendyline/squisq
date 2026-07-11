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
import { useAutoSurface } from './hooks/useAutoSurface';
import type { Doc, Block, DocBlock } from '@bendyline/squisq/schemas';
import type { ViewportConfig } from '@bendyline/squisq/schemas';
import {
  applySurface,
  resolveFontFamily,
  type SurfaceScheme,
  type Theme,
} from '@bendyline/squisq/schemas';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import {
  getLayers,
  hasTemplate,
  markdownToDoc,
  DEFAULT_THEME,
  deriveTemplateInputs,
} from '@bendyline/squisq/doc';
import type { RenderContext } from '@bendyline/squisq/doc';
import { extractPlainText, parseMarkdown } from '@bendyline/squisq/markdown';
import { BlockRenderer } from './BlockRenderer';
import { MarkdownRenderer } from './MarkdownRenderer';

// ── Props ──────────────────────────────────────────────────────────

export interface LinearDocViewProps {
  /**
   * The Doc to render. Wins over `markdown` when both are provided.
   * When neither `doc` nor `markdown` is given, an empty container renders.
   */
  doc?: Doc;
  /**
   * Markdown source to render. When `doc` is absent, the markdown is parsed
   * and converted to a Doc via `markdownToDoc(parseMarkdown(markdown))`.
   * Ignored when `doc` is provided.
   */
  markdown?: string;
  /** Base path for resolving media URLs (images, etc.) */
  basePath?: string;
  /** Viewport config for SVG card rendering (default: landscape) */
  viewport?: ViewportConfig;
  /** Optional CSS class for the outer container */
  className?: string;
  /** Theme to use for rendering (default: DEFAULT_THEME from the theme library) */
  theme?: Theme;
  /**
   * Optional surface scheme (light / dark paper) overlaid on top of the
   * theme's colors. Orthogonal to `theme` — a theme picks editorial
   * identity, a surface picks the paper. Pass `'auto'` to follow the
   * user's OS `prefers-color-scheme`, a `SurfaceScheme` object to force a
   * specific surface, or omit to use the theme's built-in colors.
   */
  surface?: SurfaceScheme | 'auto';
  /**
   * Use tight padding + a wider content column. The default layout is
   * designed for a reading surface with breathing room (720px column,
   * 24×16px padding). Short conversational snippets like chat replies
   * benefit from a much tighter layout. Set to `true` to render with
   * minimal padding and no max-width cap so the content hugs its
   * container.
   */
  thinMargins?: boolean;
  /**
   * How images inside the doc should be sized. `'inline'` (default)
   * flows them at natural size up to the column width; `'thumbnail'`
   * constrains each image to a 100×100 box with aspect-preserving
   * containment — use for chat history and other dense surfaces where
   * full-size images would dominate the layout.
   */
  imageDisplayMode?: ImageDisplayMode;
}

export type ImageDisplayMode = 'inline' | 'thumbnail';

// ── Helpers ────────────────────────────────────────────────────────

// Unknown template names we've already warned about (module-level so each
// name warns at most once per page, not once per render).
const warnedUnknownTemplates = new Set<string>();

/**
 * Determine whether a block has a template annotation that should be
 * rendered as a visual SVG card. A block is "annotated" when:
 * 1. Its sourceHeading has a templateAnnotation, AND
 * 2. The annotated template exists in the registry
 *
 * Blocks annotated with a template that is NOT in the registry fall back
 * to plain markdown rendering, with a one-shot dev-visible warning per
 * unknown template name.
 */
function isAnnotatedBlock(block: Block): boolean {
  const annotation = block.sourceHeading?.templateAnnotation;
  if (!annotation?.template) return false;
  if (!hasTemplate(annotation.template)) {
    if (!warnedUnknownTemplates.has(annotation.template)) {
      warnedUnknownTemplates.add(annotation.template);
      console.warn(
        `[squisq] Unknown template "${annotation.template}" — rendering the block as plain markdown.`,
      );
    }
    return false;
  }
  return true;
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
  blockIndices: ReadonlyMap<Block, number>;
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
  blockIndices,
}: BlockSectionProps) {
  const isAnnotated = isAnnotatedBlock(block);

  // For annotated blocks, compute layers and build a Block with them
  const visualBlock = useMemo(() => {
    if (!isAnnotated) return null;

    const annotation = block.sourceHeading!.templateAnnotation!;
    const headingText = extractPlainText(block.sourceHeading!);

    // Build a TemplateBlock-compatible object
    const templateBlock: Record<string, unknown> = {
      id: block.id,
      template: annotation.template,
      startTime: 0,
      duration: 1,
      audioSegment: 0,
      title: headingText,
      ...(deriveTemplateInputs(
        annotation.template ?? 'sectionHeader',
        headingText,
        block.contents,
        {
          placeholders: true,
        },
      ) ?? {}),
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
      data-block-index={blockIndex}
      data-template={isAnnotated ? block.sourceHeading?.templateAnnotation?.template : undefined}
    >
      {/* Render the heading (if present — preamble has no sourceHeading) */}
      {block.sourceHeading && !isAnnotated && <MarkdownRenderer nodes={[block.sourceHeading]} />}

      {/* Annotated block: render SVG card.
          The heading is intentionally *not* duplicated above the card —
          every template card renders its own title layer internally, so
          a separate `squisq-linear-card-label` only made the heading
          appear twice in the linear view. The card also drops its
          rounded border + drop shadow so it reads as a continuation of
          the surrounding page rather than a chrome'd preview. */}
      {isAnnotated && visualBlock && (
        <div className="squisq-linear-card">
          <div
            className="squisq-linear-card-svg"
            style={{
              width: '100%',
              aspectRatio: `${viewport.width} / ${viewport.height}`,
              overflow: 'hidden',
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
              blockIndex={blockIndices.get(child) ?? blockIndex + i + 1}
              blockIndices={blockIndices}
            />
          ))}
        </div>
      )}
    </div>
  );
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
  markdown,
  basePath = '/',
  viewport,
  className,
  theme,
  surface,
  thinMargins = false,
  imageDisplayMode = 'inline',
}: LinearDocViewProps) {
  const activeViewport = viewport ?? VIEWPORT_PRESETS.landscape;

  // Parse markdown into a Doc only when no explicit doc is supplied.
  const markdownDoc = useMemo(
    () => (!doc && markdown !== undefined ? markdownToDoc(parseMarkdown(markdown)) : undefined),
    [doc, markdown],
  );
  const resolvedDoc = doc ?? markdownDoc;

  const totalBlocks = useMemo(
    () => (resolvedDoc ? countAll(resolvedDoc.blocks) : 0),
    [resolvedDoc],
  );
  const blockIndices = useMemo(() => {
    const indices = new Map<Block, number>();
    let index = 0;
    const visit = (blocks: Block[]) => {
      for (const block of blocks) {
        indices.set(block, index++);
        if (block.children) visit(block.children);
      }
    };
    if (resolvedDoc) visit(resolvedDoc.blocks);
    return indices;
  }, [resolvedDoc]);
  const autoSurface = useAutoSurface(surface === 'auto');
  const resolvedSurface: SurfaceScheme | undefined = surface === 'auto' ? autoSurface : surface;

  const renderContext: RenderContext = useMemo(() => {
    const baseTheme = theme ?? DEFAULT_THEME;
    const effectiveTheme = resolvedSurface ? applySurface(baseTheme, resolvedSurface) : baseTheme;
    return {
      theme: effectiveTheme,
      viewport: activeViewport,
      totalBlocks,
      // Theme atmosphere (vignette/grain/gradient persistent layers) shows
      // on the inline template cards so they match the player's look.
      persistentLayers: effectiveTheme.persistentLayers,
    };
  }, [activeViewport, totalBlocks, theme, resolvedSurface]);

  const activeTheme = renderContext.theme!;

  // Nothing to render — keep an empty (but classed) container so hosts can
  // still target/measure the view.
  if (!resolvedDoc) {
    return <div className={`squisq-linear squisq-linear--empty ${className || ''}`} />;
  }

  const bgColor = activeTheme.colors.background;
  const textColor = activeTheme.colors.text;
  const mutedColor = activeTheme.colors.textMuted;
  const primaryColor = activeTheme.colors.primary;
  const bodyFont = resolveFontFamily(activeTheme.typography.bodyFont, 'system-ui, sans-serif');
  const titleFont = resolveFontFamily(activeTheme.typography.titleFont, 'Georgia, serif');
  const lineHt = activeTheme.typography.lineHeight ?? 1.7;

  return (
    <div
      className={`squisq-linear ${className || ''}`}
      style={{
        width: '100%',
        // Thin-margins mode is the "embedded in someone else's container"
        // signal (chat bubble, sidebar preview). Fit to content there so
        // the host's bubble doesn't render a tall empty box when the doc
        // is short. Standalone mode keeps height:100% for full-viewport
        // scrolling.
        height: thinMargins ? 'auto' : '100%',
        overflowY: thinMargins ? 'visible' : 'auto',
        overflowX: 'hidden',
        background: bgColor,
      }}
    >
      <div
        className={`squisq-linear-content squisq-md${thinMargins ? ' squisq-linear-content--thin' : ''}${imageDisplayMode === 'thumbnail' ? ' squisq-linear-content--thumbnail-images' : ''}`}
        style={
          {
            // Thin-margins mode drops the 720px reading column + generous
            // page padding (right for standalone docs) in favor of a tight
            // layout that hugs its container (right for chat bubbles and
            // sidebar previews).
            maxWidth: thinMargins ? 'none' : '720px',
            margin: thinMargins ? '0' : '0 auto',
            padding: thinMargins ? '0' : '24px 16px',
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
            /* Blend the theme's primary toward the body text color so
               links stay theme-flavored but always have enough contrast
               against the background. Some themes (e.g. Gezellig) pick a
               mid-tone primary that's nearly invisible on a dark page
               without this lift. */
            color: color-mix(in srgb, var(--squisq-linear-primary) 65%, var(--squisq-linear-text));
            text-decoration: underline;
            text-decoration-thickness: 1px;
            text-underline-offset: 2px;
          }
          .squisq-linear-content a:hover {
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
          .squisq-linear-content img {
            max-width: 100%;
            height: auto;
            border-radius: 6px;
            margin: 0.5em 0;
          }
          .squisq-linear-content--thumbnail-images img {
            max-width: 100px;
            max-height: 100px;
            width: auto;
            height: auto;
            object-fit: contain;
            display: block;
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
        {resolvedDoc.blocks.map((block, i) => (
          <BlockSection
            key={block.id}
            block={block}
            basePath={basePath}
            viewport={activeViewport}
            renderContext={renderContext}
            blockIndex={blockIndices.get(block) ?? i}
            blockIndices={blockIndices}
          />
        ))}
      </div>
    </div>
  );
}
