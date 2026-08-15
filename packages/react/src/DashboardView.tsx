/**
 * DashboardView — the "Dashboard" rendition: one static canvas that
 * arranges the document's blocks into a layout's cells.
 *
 * All geometry comes from core's `materializeDashboard` (the dashboard
 * sibling of the slide and page projections); this component only maps
 * the returned rects onto absolutely-positioned per-cell
 * `<BlockRenderer>`s. Rendering each cell as its own SVG (rather than one
 * composed canvas) gives per-cell clipping and `useId`-scoped fragment
 * ids for free, and every layer type behaves exactly as it does on a
 * slide. Video layers render as paused, muted poster frames — a dashboard
 * has no clock.
 *
 * In render mode the view publishes a minimal `SquisqRenderAPI` whose
 * `seekTo` resolves once fonts and images have settled, so headless
 * single-frame capture (`squisq image`, the export modal) can await
 * readiness through the exact same contract the slideshow player uses.
 */

import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import type { Block, Doc, Theme } from '@bendyline/squisq/schemas';
import type { DashboardMaterialization, ViewportConfig } from '@bendyline/squisq/doc';
import { materializeDashboard, resolveThemeForDoc, VIEWPORT_PRESETS } from '@bendyline/squisq/doc';
import type { SquisqRenderAPI } from './types';
import { BlockRenderer } from './BlockRenderer';

export interface DashboardViewProps {
  doc: Doc;
  /** Resolved theme; defaults to the doc's own theme resolution. */
  theme?: Theme;
  /** Canvas viewport (default: the landscape preset). */
  viewport?: ViewportConfig;
  /** Layout override: an id or `'auto'`. Overrides doc frontmatter. */
  layout?: string;
  /** Title-band override. Overrides doc frontmatter (default true). */
  showTitle?: boolean;
  /** Host-supplied title fallback (typically the file name). */
  documentTitle?: string;
  /** Base path for resolving media URLs (default `'.'`). */
  basePath?: string;
  /** Render ambient/authored layer animations (default true). */
  animationsEnabled?: boolean;
  /** Silence audio carried by cell video layers (default true). */
  muted?: boolean;
  /** Publish the capture-readiness render API (headless export). */
  renderMode?: boolean;
  /** Receives the minimal render API, and `null` on cleanup. */
  onRenderAPIReady?: (api: SquisqRenderAPI | null) => void;
  className?: string;
}

/** Wait until every image inside `root` is decoded (or failed). */
async function waitForDashboardAssets(root: HTMLElement): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Font readiness is best-effort; capture proceeds with fallbacks.
    }
  }
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.allSettled(
    images.map((img) => {
      if (img.complete) return Promise.resolve();
      if (typeof img.decode === 'function') return img.decode().catch(() => undefined);
      return new Promise<void>((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      });
    }),
  );
  // Two frames so the committed paint includes the decoded images.
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/** Wrap canvas-level layers (backdrop, title band) as a renderable block. */
function syntheticBlock(
  id: string,
  layers: DashboardMaterialization['cells'][number]['layers'],
): Block {
  return { id, startTime: 0, duration: 0, audioSegment: 0, layers } as unknown as Block;
}

export function DashboardView({
  doc,
  theme,
  viewport,
  layout,
  showTitle,
  documentTitle,
  basePath = '.',
  animationsEnabled = true,
  muted = true,
  renderMode = false,
  onRenderAPIReady,
  className,
}: DashboardViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const activeTheme = useMemo(() => theme ?? resolveThemeForDoc(doc), [theme, doc]);
  const activeViewport = viewport ?? VIEWPORT_PRESETS.landscape;

  const materialization = useMemo(
    () =>
      materializeDashboard(doc, {
        theme: activeTheme,
        viewport: activeViewport,
        layout,
        showTitle,
        documentTitle,
      }),
    [doc, activeTheme, activeViewport, layout, showTitle, documentTitle],
  );

  const backdropBottom = useMemo(
    () => syntheticBlock('dashboard-backdrop-bottom', materialization.backdrop.bottomLayers),
    [materialization],
  );
  const backdropTop = useMemo(
    () =>
      materialization.backdrop.topLayers.length > 0
        ? syntheticBlock('dashboard-backdrop-top', materialization.backdrop.topLayers)
        : null,
    [materialization],
  );
  const titleBlock = useMemo(
    () =>
      materialization.title
        ? syntheticBlock('dashboard-title-band', materialization.title.layers)
        : null,
    [materialization],
  );

  // Minimal render API for single-frame capture: seekTo resolves when the
  // dashboard's assets are settled; there is no clock, cover, or audio.
  useEffect(() => {
    if (!renderMode || !onRenderAPIReady) return;
    const api: SquisqRenderAPI = {
      seekTo: async () => {
        const root = rootRef.current;
        if (root) await waitForDashboardAssets(root);
      },
      getRenderedTime: () => 0,
      getDuration: () => 0,
      getBlocks: () =>
        materialization.cells.map((cell) => ({
          id: String(cell.block.id),
          template: (cell.block as { template?: string }).template ?? 'content',
          startTime: 0,
          duration: 0,
        })),
      getAudioSegments: () => [],
      getCaptions: () => [],
      getChapters: () => [],
      showCover: async () => {},
      hideCover: async () => {},
      hasCoverBlock: () => false,
    };
    onRenderAPIReady(api);
    return () => onRenderAPIReady(null);
  }, [renderMode, onRenderAPIReady, materialization]);

  const canvasDimensions = { width: activeViewport.width, height: activeViewport.height };
  const coverStyle: CSSProperties = { position: 'absolute', inset: 0 };

  // The canvas is width-driven by default (an aspect-ratio box, like the
  // player). A host with a definite-height box can contain-fit it instead by
  // defining `--squisq-dashboard-fit-width` — typically
  // `min(100%, calc(100cqh * var(--squisq-dashboard-aspect)))` inside a
  // `container-type: size` wrapper — so the whole dashboard always stays
  // visible (the editor preview does exactly this).
  const canvasStyle = {
    position: 'relative',
    width: 'var(--squisq-dashboard-fit-width, 100%)',
    aspectRatio: `${activeViewport.width} / ${activeViewport.height}`,
    overflow: 'hidden',
    background: activeTheme.colors.background,
    margin: '0 auto',
    '--squisq-dashboard-aspect': (activeViewport.width / activeViewport.height).toFixed(6),
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className={className ? `squisq-dashboard ${className}` : 'squisq-dashboard'}
      data-dashboard-layout={materialization.layout.name}
      style={canvasStyle}
    >
      <div style={coverStyle} aria-hidden="true">
        <BlockRenderer
          block={backdropBottom}
          blockTime={0}
          basePath={basePath}
          viewport={canvasDimensions}
          isPlaying={false}
          muted
          animationsEnabled={animationsEnabled}
          theme={activeTheme}
        />
      </div>
      {materialization.cells.map((cell) => (
        <div
          key={`${cell.index}-${cell.block.id}`}
          className="squisq-dashboard__cell"
          data-cell-index={cell.index}
          style={{
            position: 'absolute',
            left: cell.rectPct.left,
            top: cell.rectPct.top,
            width: cell.rectPct.width,
            height: cell.rectPct.height,
          }}
        >
          <BlockRenderer
            block={{ ...cell.block, layers: cell.layers } as Block}
            blockTime={0}
            basePath={basePath}
            viewport={{ width: cell.viewport.width, height: cell.viewport.height }}
            isPlaying={false}
            muted={muted}
            animationsEnabled={animationsEnabled}
            theme={activeTheme}
          />
        </div>
      ))}
      {materialization.title && titleBlock && (
        <div
          className="squisq-dashboard__title"
          style={{
            position: 'absolute',
            left: materialization.title.rectPct.left,
            top: materialization.title.rectPct.top,
            width: materialization.title.rectPct.width,
            height: materialization.title.rectPct.height,
          }}
        >
          <BlockRenderer
            block={titleBlock}
            blockTime={0}
            basePath={basePath}
            viewport={{
              width: materialization.title.viewport.width,
              height: materialization.title.viewport.height,
            }}
            isPlaying={false}
            muted
            animationsEnabled={animationsEnabled}
            theme={activeTheme}
          />
        </div>
      )}
      {backdropTop && (
        <div style={{ ...coverStyle, pointerEvents: 'none' }} aria-hidden="true">
          <BlockRenderer
            block={backdropTop}
            blockTime={0}
            basePath={basePath}
            viewport={canvasDimensions}
            isPlaying={false}
            muted
            animationsEnabled={animationsEnabled}
            theme={activeTheme}
          />
        </div>
      )}
    </div>
  );
}
