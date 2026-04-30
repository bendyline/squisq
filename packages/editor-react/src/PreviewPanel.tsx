/**
 * PreviewPanel
 *
 * Renders a live preview of the current markdown document as a slideshow
 * using the DocPlayer component from @bendyline/squisq-react.
 *
 * The markdown-derived Doc (from markdownToDoc) contains hierarchical blocks
 * with template names, heading text, and body content — but no audio or
 * visual layers. This component bridges the gap by:
 *
 * 1. Flattening the block tree into a linear slide sequence
 * 2. Converting each block into a TemplateBlock-compatible object
 *    (mapping heading text → title, templateOverrides → template fields)
 * 3. Synthesizing a dummy audio segment so DocPlayer's timing works
 *    (the player enters fallback-timer mode when audio can't load)
 * 4. Passing the prepared Doc to DocPlayer for SVG-based rendering
 */

import { useState, useEffect } from 'react';
import { DocPlayer, LinearDocView } from '@bendyline/squisq-react';
import { flattenBlocks } from '@bendyline/squisq/doc';
import { hasTemplate } from '@bendyline/squisq/doc';
import { extractPlainText } from '@bendyline/squisq/markdown';
import type { Block, Doc } from '@bendyline/squisq/schemas';
import type { MarkdownBlockNode, MarkdownList, MarkdownNode } from '@bendyline/squisq/markdown';
import { getChildren } from '@bendyline/squisq/markdown';
import { applyTransform } from '@bendyline/squisq/transform';
import { resolveAudioMapping } from '@bendyline/squisq/doc';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { useEditorContext } from './EditorContext';
import { usePreviewSettings } from './PreviewControls';

export interface PreviewPanelProps {
  /** Base path for resolving media URLs in DocPlayer */
  basePath?: string;
  /** Additional class name for the container */
  className?: string;
  /** Optional ContentContainer for audio mapping (MP3 discovery + timing.json) */
  container?: ContentContainer | null;
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Extract plain text from an array of markdown block nodes.
 * Walks paragraphs, blockquotes, and list items to collect all text.
 */
function extractBodyText(contents: MarkdownBlockNode[] | undefined): string {
  if (!contents || contents.length === 0) return '';
  const parts: string[] = [];
  for (const node of contents) {
    parts.push(extractPlainText(node));
  }
  return parts.join('\n').trim();
}

/**
 * Extract images from a block's markdown contents.
 * Walks the node tree recursively to find all MarkdownImage nodes.
 */
function extractBlockImages(
  contents: MarkdownBlockNode[] | undefined,
): Array<{ src: string; alt: string }> {
  if (!contents || contents.length === 0) return [];
  const images: Array<{ src: string; alt: string }> = [];

  function walk(node: MarkdownNode): void {
    if ('type' in node && node.type === 'image' && 'url' in node) {
      const img = node as { url: string; alt?: string };
      if (img.url) {
        images.push({ src: img.url, alt: img.alt ?? '' });
      }
    }
    for (const child of getChildren(node)) {
      walk(child);
    }
  }

  for (const node of contents) {
    walk(node);
  }
  return images;
}

/**
 * Collect all unique images from an entire Doc's block tree.
 * Walks nested children to find every image across all blocks.
 */
function collectAllDocImages(blocks: Block[]): Array<{ src: string; alt: string }> {
  const seen = new Set<string>();
  const images: Array<{ src: string; alt: string }> = [];

  function walkBlocks(blockList: Block[]): void {
    for (const block of blockList) {
      for (const img of extractBlockImages(block.contents)) {
        if (!seen.has(img.src)) {
          seen.add(img.src);
          images.push(img);
        }
      }
      if (block.children) {
        walkBlocks(block.children);
      }
    }
  }

  walkBlocks(blocks);
  return images;
}

/**
 * Extract list items from markdown body content.
 * Returns an array of plain text strings for each list item found.
 */
function extractListItems(contents: MarkdownBlockNode[] | undefined): string[] {
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

/**
 * Provide sensible default fields for templates that require more than
 * just a `title`. This prevents crashes from undefined required fields
 * when the markdown annotations don't supply all template-specific values.
 */
function getTemplateDefaults(
  templateName: string,
  headingText: string,
  block: Block,
): Record<string, unknown> {
  const body = extractBodyText(block.contents);

  switch (templateName) {
    case 'statHighlight':
      return {
        stat: headingText,
        description: body || headingText,
      };

    case 'quoteBlock':
    case 'fullBleedQuote':
    case 'pullQuote':
      return {
        quote: body || headingText,
      };

    case 'factCard':
      return {
        fact: headingText,
        explanation: body || headingText,
      };

    case 'comparisonBar':
      return {
        leftLabel: 'A',
        leftValue: 60,
        rightLabel: 'B',
        rightValue: 40,
      };

    case 'listBlock':
      return {
        items: extractListItems(block.contents) || ['Item 1', 'Item 2', 'Item 3'],
      };

    case 'definitionCard':
      return {
        term: headingText,
        definition: body || headingText,
      };

    case 'dateEvent':
      return {
        date: headingText,
        description: body || headingText,
      };

    default:
      return {};
  }
}

/**
 * Convert a markdown-derived Block into a TemplateBlock-compatible object.
 *
 * The block's heading text becomes `title` (works for sectionHeader,
 * titleBlock, factCard, etc.). Any templateOverrides from annotation
 * syntax `{[template key=value]}` are spread on top so template-specific
 * fields (stat, quote, description, …) are available.
 *
 * If the requested template doesn't exist in the registry, falls back
 * to `sectionHeader` to avoid "Unknown template" warnings.
 */
function blockToSlide(block: Block, index: number): Record<string, unknown> {
  const headingText = block.sourceHeading
    ? extractPlainText(block.sourceHeading)
    : block.title || block.id || `Slide ${index + 1}`;

  // Validate template name — fall back to sectionHeader for unknowns
  const requestedTemplate = block.template || 'sectionHeader';
  const template = hasTemplate(requestedTemplate) ? requestedTemplate : 'sectionHeader';

  // Get sensible defaults for templates that need more than just `title`
  const defaults = getTemplateDefaults(template, headingText, block);

  // Spread the block itself to pick up any template-specific fields
  // placed directly on the block by applyTransform (e.g. stat, description,
  // quote, colorScheme). These are not in templateOverrides — they live
  // on the block object because the transform produces hybrid Block+Template
  // objects via the timing allocator.
  const {
    id: _id,
    startTime: _st,
    duration: _d,
    audioSegment: _as,
    layers: _l,
    transition: _tr,
    template: _t,
    title: _ti,
    children: _c,
    contents: _co,
    sourceHeading: _sh,
    templateOverrides: _to,
    ...extraFields
  } = block as unknown as Record<string, unknown>;

  return {
    id: block.id,
    template,
    duration: block.duration,
    audioSegment: 0,
    transition: index > 0 ? { type: 'fade', duration: 0.5 } : undefined,
    // Provide heading text as title — consumed by sectionHeader, titleBlock, etc.
    title: headingText,
    // Template-specific defaults (safe fallbacks for required fields)
    ...defaults,
    // Template-specific fields from transform (stat, description, quote, etc.)
    ...extraFields,
    // Spread annotation overrides last so explicit values win
    ...block.templateOverrides,
  };
}

/** Ambient motions to rotate on image slides. */
const IMAGE_MOTIONS: Array<'zoomIn' | 'zoomOut' | 'panLeft' | 'panRight'> = [
  'zoomIn',
  'zoomOut',
  'panLeft',
  'panRight',
];

/**
 * Build a player-ready Doc from the markdown-derived Doc.
 *
 * Flattens hierarchical blocks, converts each to a TemplateBlock-compatible
 * slide, recalculates timing, and adds a synthetic audio segment.
 *
 * Images found in the markdown are used in two ways:
 * 1. Per-block: if a block has images, its first image becomes the background
 *    (via imageWithCaption template) or an accent image on text templates.
 * 2. Global: remaining images are interleaved as standalone image slides
 *    for visual variety.
 */
function buildPreviewDoc(doc: Doc): Doc {
  const flat = flattenBlocks(doc.blocks);

  // Collect all images from the doc for global interleaving
  const allImages = collectAllDocImages(doc.blocks);

  // Track which images are used per-block so we can interleave the rest
  const usedImageSrcs = new Set<string>();

  // First pass: convert blocks to slides, using per-block images
  const slides: Record<string, unknown>[] = [];
  let motionIndex = 0;

  for (let i = 0; i < flat.length; i++) {
    const block = flat[i];
    const blockImages = extractBlockImages(block.contents);
    const slide = blockToSlide(block, i);

    // If the block has images and is using the default sectionHeader template,
    // upgrade it to imageWithCaption so the image becomes the slide background.
    if (blockImages.length > 0 && slide.template === 'sectionHeader') {
      const img = blockImages[0];
      usedImageSrcs.add(img.src);
      slide.template = 'imageWithCaption';
      slide.imageSrc = img.src;
      slide.imageAlt = img.alt;
      slide.caption = slide.title as string;
      slide.captionPosition = 'bottom';
      slide.ambientMotion = IMAGE_MOTIONS[motionIndex++ % IMAGE_MOTIONS.length];
    } else if (blockImages.length > 0) {
      // For other templates, add the first image as an accent
      const img = blockImages[0];
      usedImageSrcs.add(img.src);
      if (!slide.accentImage) {
        slide.accentImage = {
          src: img.src,
          alt: img.alt,
          position: 'left-strip',
          ambientMotion: IMAGE_MOTIONS[motionIndex++ % IMAGE_MOTIONS.length],
        };
      }
    }

    slides.push(slide);
  }

  // Second pass: interleave unused images as standalone imageWithCaption slides.
  // Spread them evenly through the sequence for visual variety.
  const unusedImages = allImages.filter((img) => !usedImageSrcs.has(img.src));
  if (unusedImages.length > 0 && slides.length > 0) {
    const interval = Math.max(2, Math.floor(slides.length / (unusedImages.length + 1)));
    let insertOffset = 0;
    for (let imgIdx = 0; imgIdx < unusedImages.length; imgIdx++) {
      const insertAt = Math.min((imgIdx + 1) * interval + insertOffset, slides.length);
      const img = unusedImages[imgIdx];
      slides.splice(insertAt, 0, {
        id: `img-interleave-${imgIdx}`,
        template: 'imageWithCaption',
        duration: 5,
        audioSegment: 0,
        imageSrc: img.src,
        imageAlt: img.alt,
        ambientMotion: IMAGE_MOTIONS[motionIndex++ % IMAGE_MOTIONS.length],
        transition: { type: 'fade', duration: 0.5 },
      });
      insertOffset++;
    }
  }

  // Recalculate sequential timing
  let t = 0;
  for (const slide of slides) {
    slide.startTime = t;
    t += slide.duration as number;
  }

  return {
    articleId: doc.articleId,
    duration: t,
    blocks: slides as unknown as Block[],
    audio: {
      // Synthetic segment — audio will fail to load and DocPlayer will use
      // its fallback timer to advance currentTime via requestAnimationFrame.
      segments: t > 0 ? [{ src: '', name: 'preview', duration: t, startTime: 0 }] : [],
    },
    ...(doc.captions ? { captions: doc.captions } : {}),
    ...(doc.startBlock ? { startBlock: doc.startBlock } : {}),
    ...(doc.themeId ? { themeId: doc.themeId } : {}),
  };
}

// ── Component ──────────────────────────────────────────────────────

/**
 * Live preview panel that renders the current document as a slideshow
 * or document view. Controls (viewport, mode, theme, transform, captions)
 * are rendered in the main toolbar via PreviewToolbarControls.
 */
export function PreviewPanel({ basePath = '/', className, container }: PreviewPanelProps) {
  const { doc, parseError, isParsing } = useEditorContext();
  const {
    activeViewport,
    activeDisplayMode,
    activeTheme,
    activeTransformStyle,
    activeCaptionStyle,
  } = usePreviewSettings();

  // Build the player-ready Doc whenever the parsed doc changes.
  // Transform runs on the ORIGINAL doc (which has block.contents with
  // markdown body text) so the content extractor can analyze it.
  // Then buildPreviewDoc converts the result for DocPlayer.
  //
  // Audio mapping is async (reads container files), so we use a two-phase
  // approach: first build the base doc synchronously, then resolve audio
  // in an effect and update the state.
  const [previewDoc, setPreviewDoc] = useState<Doc | null>(null);

  useEffect(() => {
    if (!doc || !doc.blocks.length) {
      setPreviewDoc(null);
      return;
    }

    let sourceDoc = doc;
    if (activeTransformStyle) {
      const result = applyTransform(doc, activeTransformStyle);
      sourceDoc = result.doc;
    }

    // If we have a container, try to resolve audio mapping before building preview
    if (container) {
      let cancelled = false;
      resolveAudioMapping(sourceDoc, container).then((audioDoc) => {
        if (!cancelled) {
          setPreviewDoc(buildPreviewDoc(audioDoc));
        }
      });
      // Set an immediate preview without audio while mapping resolves
      setPreviewDoc(buildPreviewDoc(sourceDoc));
      return () => {
        cancelled = true;
      };
    }

    setPreviewDoc(buildPreviewDoc(sourceDoc));
  }, [doc, activeTransformStyle, container]);

  // Status overlays for non-ready states
  if (isParsing) {
    return (
      <div className={`squisq-preview-status ${className || ''}`} data-testid="preview-panel">
        <p>Parsing…</p>
      </div>
    );
  }

  if (parseError) {
    return (
      <div className={`squisq-preview-status ${className || ''}`} data-testid="preview-panel">
        <h3>Parse Error</h3>
        <pre>{parseError}</pre>
      </div>
    );
  }

  if (!previewDoc) {
    return (
      <div className={`squisq-preview-status ${className || ''}`} data-testid="preview-panel">
        <p>No content to preview. Start typing in the editor.</p>
      </div>
    );
  }

  return (
    <div
      className={`squisq-preview-container ${className || ''}`}
      data-testid="preview-panel"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--squisq-bg, #f5f5f5)',
      }}
    >
      {/* Player / Document view */}
      <div
        className="squisq-preview-player"
        style={{
          flex: 1,
          display: 'flex',
          alignItems: activeDisplayMode === 'linear' ? 'stretch' : 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {activeDisplayMode === 'linear' ? (
          <LinearDocView
            doc={doc!}
            basePath={basePath}
            viewport={activeViewport}
            theme={activeTheme}
          />
        ) : (
          <DocPlayer
            script={previewDoc}
            basePath={basePath}
            showControls
            muted
            forceViewport={activeViewport}
            displayMode={activeDisplayMode}
            theme={activeTheme}
            captionStyle={activeCaptionStyle}
          />
        )}
      </div>
    </div>
  );
}
