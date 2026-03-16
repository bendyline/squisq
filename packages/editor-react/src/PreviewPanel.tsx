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

import { useMemo, useState, useEffect } from 'react';
import { DocPlayer, LinearDocView } from '@bendyline/squisq-react';
import type { DisplayMode } from '@bendyline/squisq-react';
import { flattenBlocks } from '@bendyline/squisq/doc';
import { hasTemplate } from '@bendyline/squisq/doc';
import { extractPlainText } from '@bendyline/squisq/markdown';
import type { Block, Doc, ViewportConfig, ViewportPreset } from '@bendyline/squisq/schemas';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import { getThemeSummaries, resolveTheme } from '@bendyline/squisq/schemas';
import type { MarkdownBlockNode, MarkdownList } from '@bendyline/squisq/markdown';
import { useEditorContext } from './EditorContext';

export interface PreviewPanelProps {
  /** Base path for resolving media URLs in DocPlayer */
  basePath?: string;
  /** Additional class name for the container */
  className?: string;
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
    : block.id || `Slide ${index + 1}`;

  // Validate template name — fall back to sectionHeader for unknowns
  const requestedTemplate = block.template || 'sectionHeader';
  const template = hasTemplate(requestedTemplate) ? requestedTemplate : 'sectionHeader';

  // Get sensible defaults for templates that need more than just `title`
  const defaults = getTemplateDefaults(template, headingText, block);

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
    // Spread annotation overrides last so explicit values win
    ...block.templateOverrides,
  };
}

/**
 * Build a player-ready Doc from the markdown-derived Doc.
 *
 * Flattens hierarchical blocks, converts each to a TemplateBlock-compatible
 * slide, recalculates timing, and adds a synthetic audio segment.
 */
function buildPreviewDoc(doc: Doc): Doc {
  const flat = flattenBlocks(doc.blocks);
  const slides = flat.map(blockToSlide);

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
  };
}

// ── Viewport helpers ───────────────────────────────────────────────

/** All viewport preset entries for the dropdown */
const VIEWPORT_OPTIONS: { key: ViewportPreset; label: string }[] = [
  { key: 'landscape', label: '16:9 Landscape' },
  { key: 'portrait', label: '9:16 Portrait' },
  { key: 'square', label: '1:1 Square' },
  { key: 'standard', label: '4:3 Standard' },
];

/**
 * Resolve a `document-render-as` frontmatter value to a ViewportPreset.
 * Accepts preset names ("landscape"), aspect ratio shorthand ("16:9"),
 * and common aliases ("widescreen", "vertical", "stories").
 */
function resolveRenderAs(value: unknown): ViewportPreset | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  const mapping: Record<string, ViewportPreset> = {
    landscape: 'landscape',
    '16:9': 'landscape',
    widescreen: 'landscape',
    portrait: 'portrait',
    '9:16': 'portrait',
    vertical: 'portrait',
    stories: 'portrait',
    square: 'square',
    '1:1': 'square',
    standard: 'standard',
    '4:3': 'standard',
  };
  return mapping[v] ?? null;
}

/** Display mode options for the dropdown */
const DISPLAY_MODE_OPTIONS: { key: DisplayMode; label: string }[] = [
  { key: 'video', label: 'Video' },
  { key: 'slideshow', label: 'Slideshow' },
  { key: 'linear', label: 'Document' },
];

/** Theme options for the dropdown */
const THEME_OPTIONS = getThemeSummaries().map((s) => ({ key: s.id, label: s.name }));

/** Set of valid theme IDs for fast lookup */
const VALID_THEME_IDS = new Set(THEME_OPTIONS.map((o) => o.key));

/**
 * Resolve a `theme` frontmatter value to a theme id.
 * Accepts exact theme ids ('documentary', 'bold') and common aliases.
 */
function resolveFrontmatterTheme(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (VALID_THEME_IDS.has(v)) return v;
  // Allow hyphenated/spaced aliases: "morning light" → "morning-light"
  const normalized = v.replace(/\s+/g, '-');
  if (VALID_THEME_IDS.has(normalized)) return normalized;
  return null;
}

/**
 * Resolve a `display-mode` frontmatter value to a DisplayMode.
 */
function resolveDisplayMode(value: unknown): DisplayMode | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'video' || v === 'slideshow' || v === 'linear') return v;
  if (v === 'slides' || v === 'presentation' || v === 'deck') return 'slideshow';
  if (v === 'document' || v === 'scroll' || v === 'page') return 'linear';
  return null;
}

// ── Component ──────────────────────────────────────────────────────

/**
 * Live preview panel that renders the current document as a slideshow.
 * Uses DocPlayer from @bendyline/squisq-react for SVG block rendering
 * with template expansion, transitions, and playback controls.
 *
 * Includes a viewport format dropdown above the player. The default
 * format can be hinted via YAML frontmatter `document-render-as:`.
 */
export function PreviewPanel({ basePath = '/', className }: PreviewPanelProps) {
  const { doc, parseError, isParsing } = useEditorContext();

  // Determine the frontmatter-hinted viewport preset (if any)
  const frontmatterPreset = useMemo<ViewportPreset | null>(() => {
    if (!doc?.frontmatter) return null;
    return resolveRenderAs(doc.frontmatter['document-render-as']);
  }, [doc?.frontmatter]);

  // Track user-selected viewport; null means "use frontmatter or default"
  const [selectedPreset, setSelectedPreset] = useState<ViewportPreset | null>(null);

  // When frontmatter preset changes and user hasn't explicitly chosen, sync
  useEffect(() => {
    setSelectedPreset(null);
  }, [frontmatterPreset]);

  // Active preset: explicit user choice > frontmatter hint > landscape
  const activePreset: ViewportPreset = selectedPreset ?? frontmatterPreset ?? 'landscape';
  const activeViewport: ViewportConfig = VIEWPORT_PRESETS[activePreset];

  // ── Display mode (video vs slideshow) ──────────────────────────

  // Determine the frontmatter-hinted display mode (if any)
  const frontmatterDisplayMode = useMemo<DisplayMode | null>(() => {
    if (!doc?.frontmatter) return null;
    return resolveDisplayMode(doc.frontmatter['display-mode']);
  }, [doc?.frontmatter]);

  // Track user-selected display mode; null means "use frontmatter or default"
  const [selectedDisplayMode, setSelectedDisplayMode] = useState<DisplayMode | null>(null);

  // When frontmatter display mode changes and user hasn't explicitly chosen, sync
  useEffect(() => {
    setSelectedDisplayMode(null);
  }, [frontmatterDisplayMode]);

  // Active display mode: explicit user choice > frontmatter hint > video
  const activeDisplayMode: DisplayMode = selectedDisplayMode ?? frontmatterDisplayMode ?? 'video';

  // ── Theme selection ────────────────────────────────────────────

  // Determine the frontmatter-hinted theme (if any)
  const frontmatterThemeId = useMemo<string | null>(() => {
    if (!doc?.frontmatter) return null;
    return resolveFrontmatterTheme(doc.frontmatter['theme']);
  }, [doc?.frontmatter]);

  // Track user-selected theme; null means "use frontmatter or default"
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null);

  // When frontmatter theme changes and user hasn't explicitly chosen, sync
  useEffect(() => {
    setSelectedThemeId(null);
  }, [frontmatterThemeId]);

  // Active theme: explicit user choice > frontmatter hint > documentary
  const activeThemeId = selectedThemeId ?? frontmatterThemeId ?? 'documentary';
  const activeTheme = useMemo(() => resolveTheme(activeThemeId), [activeThemeId]);

  // Build the player-ready Doc whenever the parsed doc changes
  const previewDoc = useMemo(() => {
    if (!doc || !doc.blocks.length) return null;
    return buildPreviewDoc(doc);
  }, [doc]);

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
      {/* Viewport format selector */}
      <div
        className="squisq-preview-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 12px',
          borderBottom: '1px solid var(--squisq-border, #e0e0e0)',
          flexShrink: 0,
          fontSize: '13px',
        }}
      >
        <label htmlFor="viewport-preset" style={{ color: 'var(--squisq-text-muted, #6b7280)' }}>
          Format:
        </label>
        <select
          id="viewport-preset"
          value={activePreset}
          onChange={(e) => setSelectedPreset(e.target.value as ViewportPreset)}
          style={{
            padding: '3px 8px',
            borderRadius: '4px',
            border: '1px solid var(--squisq-border, #d1d5db)',
            background: 'var(--squisq-input-bg, #fff)',
            color: 'var(--squisq-text, #1f2937)',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          {VIEWPORT_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
        {frontmatterPreset && selectedPreset === null && (
          <span
            style={{
              fontSize: '11px',
              color: 'var(--squisq-text-muted, #9ca3af)',
              fontStyle: 'italic',
            }}
          >
            (from frontmatter)
          </span>
        )}

        {/* Divider */}
        <span
          style={{
            width: '1px',
            height: '18px',
            background: 'var(--squisq-border, #d1d5db)',
            margin: '0 4px',
          }}
        />

        {/* Display mode selector */}
        <label htmlFor="display-mode" style={{ color: 'var(--squisq-text-muted, #6b7280)' }}>
          Mode:
        </label>
        <select
          id="display-mode"
          value={activeDisplayMode}
          onChange={(e) => setSelectedDisplayMode(e.target.value as DisplayMode)}
          style={{
            padding: '3px 8px',
            borderRadius: '4px',
            border: '1px solid var(--squisq-border, #d1d5db)',
            background: 'var(--squisq-input-bg, #fff)',
            color: 'var(--squisq-text, #1f2937)',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          {DISPLAY_MODE_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
        {frontmatterDisplayMode && selectedDisplayMode === null && (
          <span
            style={{
              fontSize: '11px',
              color: 'var(--squisq-text-muted, #9ca3af)',
              fontStyle: 'italic',
            }}
          >
            (from frontmatter)
          </span>
        )}

        {/* Divider */}
        <span
          style={{
            width: '1px',
            height: '18px',
            background: 'var(--squisq-border, #d1d5db)',
            margin: '0 4px',
          }}
        />

        {/* Theme selector */}
        <label htmlFor="theme-select" style={{ color: 'var(--squisq-text-muted, #6b7280)' }}>
          Theme:
        </label>
        <select
          id="theme-select"
          value={activeThemeId}
          onChange={(e) => setSelectedThemeId(e.target.value)}
          style={{
            padding: '3px 8px',
            borderRadius: '4px',
            border: '1px solid var(--squisq-border, #d1d5db)',
            background: 'var(--squisq-input-bg, #fff)',
            color: 'var(--squisq-text, #1f2937)',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          {THEME_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
        {frontmatterThemeId && selectedThemeId === null && (
          <span
            style={{
              fontSize: '11px',
              color: 'var(--squisq-text-muted, #9ca3af)',
              fontStyle: 'italic',
            }}
          >
            (from frontmatter)
          </span>
        )}
      </div>

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
          />
        )}
      </div>
    </div>
  );
}
