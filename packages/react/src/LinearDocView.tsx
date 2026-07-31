/**
 * LinearDocView Component — the "Page" rendition of a Doc.
 *
 * Renders a Doc as a marketing-website-style scrolling page. Every block
 * becomes a variable-height HTML section via core's
 * `materializePageSections` (hero, banner, stat band, quote band, feature
 * split, gallery, prose, …), art-directed by the active theme's
 * `pageStyle`. Inherently spatial blocks (diagram/tree/timeline/map/
 * drawing/layout, authored layers, custom templates) keep rendering
 * through `materializeBlockLayers` + `BlockRenderer`, embedded responsively
 * inside a canvas section.
 *
 * This is the view used when `displayMode === 'linear'` in DocPlayer.
 *
 * Styling: the structural stylesheet (`PAGE_BASE_CSS` from core) is
 * injected inline so the standalone bundle and single-file HTML exports
 * stay self-contained; the theme flows exclusively through
 * `--squisq-page-*` custom properties + token data-attributes.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useAutoSurface } from './hooks/useAutoSurface';
import type { Doc } from '@bendyline/squisq/schemas';
import type { ViewportConfig } from '@bendyline/squisq/schemas';
import {
  applySurface,
  resolveFontFamily,
  type SurfaceScheme,
  type Theme,
} from '@bendyline/squisq/schemas';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import {
  markdownToDoc,
  materializePageSections,
  resolvePageStyle,
  buildPageCssVars,
  pageStyleDataAttributes,
  PAGE_BASE_CSS,
  DEFAULT_THEME,
} from '@bendyline/squisq/doc';
import type {
  MaterializeBlockLayersOptions,
  PageSectionMaterialization,
  PageTransformHints,
} from '@bendyline/squisq/doc';
import { parseMarkdown, type HtmlPolicy } from '@bendyline/squisq/markdown';
import { fenceRendererLangs, type FenceRendererMap } from '@bendyline/squisq/fence';
import { PageViewContext, type PageViewContextValue } from './page/PageViewContext';
import { PageSectionView } from './page/PageSectionView';
import type { CodeBlockCopyHandler } from './MarkdownRenderer';

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
  /** Viewport config for embedded SVG canvas sections (default: landscape) */
  viewport?: ViewportConfig;
  /** Optional CSS class for the outer container */
  className?: string;
  /** Theme to use for rendering (default: DEFAULT_THEME from the theme library) */
  theme?: Theme;
  /** Whether embedded canvas sections render their layer animations (default: true). */
  animationsEnabled?: boolean;
  /**
   * Optional surface scheme (light / dark paper) overlaid on top of the
   * theme's colors. Orthogonal to `theme` — a theme picks editorial
   * identity, a surface picks the paper. Pass `'auto'` to follow the
   * user's OS `prefers-color-scheme`, a `SurfaceScheme` object to force a
   * specific surface, or omit to use the theme's built-in colors.
   */
  surface?: SurfaceScheme | 'auto';
  /**
   * Use tight padding + a hugging layout. The default layout is a full
   * page with themed section bands. Short conversational snippets like
   * chat replies benefit from a much tighter layout. Set to `true` to
   * render with minimal padding so the content hugs its container.
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
  /**
   * Let unmodified Up/Down arrows scroll this view even when it does not
   * currently hold focus. Intended for a primary document preview.
   */
  globalKeyboardShortcuts?: boolean;
  /**
   * Synthesize a hero section from `doc.startBlock` at the top of the
   * page (default: true). The editor's Cover toggle maps here.
   */
  showCover?: boolean;
  /**
   * Page hints from the active transform (Summarize) style — spacing and
   * emphasis-curve adjustments defined by `TransformStyleConfig.page`.
   */
  transformPage?: PageTransformHints;
  /** Show a Copy button on ordinary fenced code blocks (default: false). */
  showCodeCopyButton?: boolean;
  /** Optional host clipboard adapter; otherwise the browser Clipboard API is used. */
  onCopyCode?: CodeBlockCopyHandler;
  /**
   * Host fence-renderer registry (`@bendyline/squisq/fence`). Claimed
   * fence languages render through the host's widgets in every markdown
   * section — including rich content preserved inside typed template
   * sections (the claimed languages are threaded into the page
   * materializer so those fences survive slot extraction).
   */
  fenceRenderers?: FenceRendererMap;
  /** Raw-HTML policy for markdown sections (default: `sanitize`). */
  htmlPolicy?: HtmlPolicy;
  /** Extra link URL schemes allowed in markdown sections. */
  linkSchemes?: readonly string[];
}

export type ImageDisplayMode = 'inline' | 'thumbnail';

// ── Main Component ─────────────────────────────────────────────────

/**
 * Renders a Doc as a scrolling, theme-art-directed page.
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
  animationsEnabled = true,
  thinMargins = false,
  imageDisplayMode = 'inline',
  globalKeyboardShortcuts = false,
  showCover = true,
  transformPage,
  showCodeCopyButton = false,
  onCopyCode,
  fenceRenderers,
  htmlPolicy,
  linkSchemes,
}: LinearDocViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeViewport = viewport ?? VIEWPORT_PRESETS.landscape;

  // Parse markdown into a Doc only when no explicit doc is supplied.
  const markdownDoc = useMemo(
    () => (!doc && markdown !== undefined ? markdownToDoc(parseMarkdown(markdown)) : undefined),
    [doc, markdown],
  );
  const resolvedDoc = doc ?? markdownDoc;

  const autoSurface = useAutoSurface(surface === 'auto');
  const resolvedSurface: SurfaceScheme | undefined = surface === 'auto' ? autoSurface : surface;

  const activeTheme = useMemo(() => {
    const baseTheme = theme ?? DEFAULT_THEME;
    return resolvedSurface ? applySurface(baseTheme, resolvedSurface) : baseTheme;
  }, [theme, resolvedSurface]);

  const pageStyle = useMemo(
    () => resolvePageStyle(activeTheme, transformPage),
    [activeTheme, transformPage],
  );

  // Claimed fence languages must survive typed-template slot extraction —
  // without this, a host widget inside a callout/card section is dropped
  // by the materializer before the renderer ever sees it.
  const widgetFenceLangs = useMemo(() => fenceRendererLangs(fenceRenderers), [fenceRenderers]);

  const sections: PageSectionMaterialization[] = useMemo(() => {
    if (!resolvedDoc) return [];
    return materializePageSections(resolvedDoc, {
      theme: activeTheme,
      viewport: activeViewport,
      customTemplates: resolvedDoc.customTemplates,
      cover: showCover !== false ? resolvedDoc.startBlock : false,
      transformPage,
      ...(widgetFenceLangs.length > 0 ? { widgetFenceLangs } : {}),
    });
  }, [resolvedDoc, activeTheme, activeViewport, showCover, transformPage, widgetFenceLangs]);

  // Canvas embeds materialize SVG layers with the same options the player
  // uses, so diagrams/trees/maps keep the theme atmosphere.
  const renderContext: MaterializeBlockLayersOptions = useMemo(
    () => ({
      theme: activeTheme,
      viewport: activeViewport,
      totalBlocks: sections.length,
      persistentLayers: activeTheme.persistentLayers,
      customTemplates: resolvedDoc?.customTemplates,
    }),
    [activeTheme, activeViewport, sections.length, resolvedDoc?.customTemplates],
  );

  const pageContext: PageViewContextValue = useMemo(
    () => ({
      theme: activeTheme,
      pageStyle,
      basePath,
      viewport: activeViewport,
      renderContext,
      animationsEnabled,
      imageDisplayMode,
      showCodeCopyButton,
      onCopyCode,
      fenceRenderers,
      htmlPolicy,
      linkSchemes,
    }),
    [
      activeTheme,
      pageStyle,
      basePath,
      activeViewport,
      renderContext,
      animationsEnabled,
      imageDisplayMode,
      showCodeCopyButton,
      onCopyCode,
      fenceRenderers,
      htmlPolicy,
      linkSchemes,
    ],
  );

  // Feature-split alternation (theme `alternate` hint) + lead-prose
  // detection (drop-cap target) are sequence-scoped presentation details.
  const { featureOrdinals, leadProseIndex } = useMemo(() => {
    const ordinals = new Map<number, number>();
    let featureCount = 0;
    let firstProse = -1;
    for (const entry of sections) {
      if (entry.section.kind === 'feature-split') {
        ordinals.set(entry.section.index, featureCount++);
      }
      if (firstProse < 0 && entry.section.kind === 'prose') {
        firstProse = entry.section.index;
      }
    }
    return { featureOrdinals: ordinals, leadProseIndex: firstProse };
  }, [sections]);

  useEffect(() => {
    if (!globalKeyboardShortcuts) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')
      ) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="listbox"], [role="menu"], [role="dialog"], [aria-modal="true"], .monaco-editor',
        )
      ) {
        return;
      }
      const scroller = scrollRef.current;
      if (!scroller) return;
      event.preventDefault();
      const distance = Math.max(64, Math.round(scroller.clientHeight * 0.12));
      scroller.scrollBy({
        top: event.key === 'ArrowDown' ? distance : -distance,
        behavior: 'smooth',
      });
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [globalKeyboardShortcuts]);

  // Nothing to render — keep an empty (but classed) container so hosts can
  // still target/measure the view.
  if (!resolvedDoc) {
    return (
      <div ref={scrollRef} className={`squisq-linear squisq-linear--empty ${className || ''}`} />
    );
  }

  const bgColor = activeTheme.colors.background;
  const textColor = activeTheme.colors.text;
  const mutedColor = activeTheme.colors.textMuted;
  const primaryColor = activeTheme.colors.primary;
  const bodyFont = resolveFontFamily(activeTheme.typography.bodyFont, 'system-ui, sans-serif');
  const titleFont = resolveFontFamily(activeTheme.typography.titleFont, 'Georgia, serif');
  const lineHt = activeTheme.typography.lineHeight ?? 1.65;

  const contentClasses = [
    'squisq-linear-content',
    'squisq-md',
    'squisq-page',
    thinMargins ? 'squisq-linear-content--thin squisq-page--thin' : '',
    imageDisplayMode === 'thumbnail'
      ? 'squisq-linear-content--thumbnail-images squisq-page--thumbnail-images'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={scrollRef}
      className={`squisq-linear ${className || ''}`}
      role="region"
      aria-label="Document page"
      tabIndex={thinMargins ? undefined : 0}
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
        // Container queries drive the responsive page layout — the page
        // often lives inside editor panes / chat bubbles where viewport
        // media queries lie about the available width.
        containerType: 'inline-size',
        containerName: 'squisq-page',
      }}
    >
      <div
        className={contentClasses}
        {...pageStyleDataAttributes(pageStyle)}
        style={
          {
            lineHeight: lineHt,
            fontSize: '16px',
            fontFamily: bodyFont,
            color: textColor,
            ...buildPageCssVars(activeTheme, pageStyle),
            // Legacy custom properties kept for one release so host CSS
            // and MarkdownRenderer content keyed on them keep working.
            '--squisq-linear-title-font': titleFont,
            '--squisq-linear-body-font': bodyFont,
            '--squisq-linear-text': textColor,
            '--squisq-linear-muted': mutedColor,
            '--squisq-linear-primary': primaryColor,
            '--squisq-linear-bg': bgColor,
          } as React.CSSProperties
        }
      >
        {/* Structural page stylesheet (theme-independent; values via vars). */}
        <style data-squisq-page="">{PAGE_BASE_CSS}</style>
        <PageViewContext.Provider value={pageContext}>
          {sections.map((entry) => {
            const ordinal = featureOrdinals.get(entry.section.index) ?? 0;
            const flip = !!entry.section.hints?.alternate && ordinal % 2 === 1;
            return (
              <PageSectionView
                key={`${entry.section.blockId}-${entry.section.index}`}
                entry={entry}
                featureFlip={flip}
                isLeadProse={entry.section.index === leadProseIndex}
              />
            );
          })}
        </PageViewContext.Provider>
      </div>
    </div>
  );
}
