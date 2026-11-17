/**
 * Cross-browser review harness: one source drawn one way, so the driver
 * (`scripts/generate-cross-browser-review.ts`) can capture the same page in
 * Chromium and WebKit and compare the two engines cell by cell.
 *
 *   ?source=templates | sample:<key> | corpus:<name> | doc:<name>
 *   &mode=slides | linear | html | editor
 *   &vp=landscape | portrait | square
 *   &theme=<id>          (optional; defaults to the document's own theme)
 *   &only=<id,id>        (optional; slides/templates to draw, by cell id or template)
 *   &motion=1            (optional; run entrance motion, for a driver to freeze mid-flight)
 *   &grow=0              (optional; no slideshow text growth — how video export draws)
 *
 * Slides are built the way the player builds them (`buildPreviewDoc` →
 * `expandDocBlocks`) and drawn by `BlockRenderer` with the slideshow text fit
 * on. `linear` draws the scrolling page view, `html` the plain document
 * preview, and `editor` the Write view (read-only). Every comparable unit is a `[data-xb-cell]` holding one
 * `[data-xb-frame]`; slide cells also publish their `measureFrame` metrics so
 * engine-specific clipping and overflow surface as issues, not only pixels.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { BlockRenderer, LinearDocView } from '@bendyline/squisq-react';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import {
  buildPreviewDoc,
  expandDocBlocks,
  flattenRenderableBlocks,
  markdownToDoc,
  resolveThemeForDoc,
} from '@bendyline/squisq/doc';
import {
  VIEWPORT_PRESETS,
  resolveTheme,
  type Block,
  type Doc,
  type Theme,
  type ViewportConfig,
} from '@bendyline/squisq/schemas';
import '@bendyline/squisq-react/styles';
import '@bendyline/squisq-editor-react/styles';
import { EditorProvider, PlainHtmlPreview, WysiwygEditor } from '@bendyline/squisq-editor-react';
import { SAMPLES } from '../samples';
import { TEMPLATE_SCREENSHOT_FIXTURES } from '../templateScreenshots/templateSamples';
import { measureFrame, type SwatchMetrics } from '../swatches/measure';

export interface CrossBrowserCell {
  id: string;
  label: string;
  template?: string;
  metrics?: SwatchMetrics;
}

export interface CrossBrowserState {
  ready: boolean;
  error?: string;
  cells?: CrossBrowserCell[];
  /** `?source=list`: the inline site samples the driver can request. */
  samples?: string[];
}

type ReviewWindow = Window & { __SQUISQ_CROSS_BROWSER__?: CrossBrowserState };

function query(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

function publish(state: CrossBrowserState): void {
  (window as ReviewWindow).__SQUISQ_CROSS_BROWSER__ = state;
}

const twoFrames = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

/** Wait for Mermaid layers to draw (or fail) so both engines capture them settled. */
async function waitForMermaid(deadlineMs: number): Promise<void> {
  const started = performance.now();
  while (performance.now() - started < deadlineMs) {
    const frames = Array.from(document.querySelectorAll('.block-layer--mermaid'));
    if (frames.every((f) => f.querySelector('svg') || f.querySelector('[data-error]'))) return;
    await sleep(100);
  }
}

/** Wait for every image on the page to load or fail. */
async function waitForImages(deadlineMs: number): Promise<void> {
  const started = performance.now();
  while (performance.now() - started < deadlineMs) {
    const pending = Array.from(document.images).filter((img) => !img.complete);
    if (pending.length === 0) return;
    await sleep(100);
  }
}

async function loadMarkdown(source: string): Promise<string> {
  const [kind, name] = source.split(':', 2) as [string, string | undefined];
  if (kind === 'sample') {
    const markdown = name ? SAMPLES[name] : undefined;
    if (markdown === undefined) throw new Error(`Unknown sample: ${name}`);
    return markdown;
  }
  const url =
    kind === 'corpus'
      ? `/scripts/deck-review/corpus/${name}.md`
      : kind === 'doc'
        ? `/reports/cross-browser/docs/${name}.md`
        : null;
  if (!url || !name) throw new Error(`Unknown source: ${source}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`);
  return response.text();
}

/** Keep the slides `?only=` names, by cell id or template; all when absent. */
function only<T extends { id: string; template?: string }>(slides: T[]): T[] {
  const names = query('only')?.split(',');
  if (!names) return slides;
  return slides.filter(
    (slide) => names.includes(slide.id) || (slide.template && names.includes(slide.template)),
  );
}

interface Built {
  theme: Theme;
  doc?: Doc;
  markdown?: string;
  slides?: Array<{ id: string; label: string; template?: string; block: Block }>;
}

function buildSlides(
  doc: Doc,
  viewport: ViewportConfig,
  theme: Theme,
): NonNullable<Built['slides']> {
  const blocks = expandDocBlocks(flattenRenderableBlocks(doc.blocks), {
    viewport,
    theme,
    customTemplates: doc.customTemplates,
  });
  return blocks.map((block, index) => {
    const template = (block as { template?: string }).template;
    return {
      id: `slide-${String(index + 1).padStart(2, '0')}`,
      label: `${index + 1} ${template ?? 'layers'} · ${block.id}`,
      template,
      block,
    };
  });
}

async function build(
  source: string,
  mode: string,
  viewport: ViewportConfig,
  themeId: string | null,
): Promise<Built> {
  if (source === 'templates') {
    const theme = resolveTheme(themeId ?? 'standard');
    const slides = Object.entries(TEMPLATE_SCREENSHOT_FIXTURES).flatMap(([id, fixture]) => {
      const [block] = expandDocBlocks([fixture.block], { theme, viewport });
      return block ? [{ id: `template-${id}`, label: id, template: id, block }] : [];
    });
    return { theme, slides: only(slides) };
  }
  const markdown = await loadMarkdown(source);
  const doc = buildPreviewDoc(markdownToDoc(parseMarkdown(markdown)));
  const theme = themeId ? resolveTheme(themeId) : resolveThemeForDoc(doc);
  if (mode === 'slides') return { theme, doc, slides: only(buildSlides(doc, viewport, theme)) };
  return { theme, doc, markdown };
}

export function CrossBrowserApp() {
  const source = query('source') ?? 'templates';
  const mode = query('mode') ?? 'slides';
  const vpName = (query('vp') ?? 'landscape') as keyof typeof VIEWPORT_PRESETS;
  const viewport = VIEWPORT_PRESETS[vpName] ?? VIEWPORT_PRESETS.landscape;
  const themeId = query('theme');
  const motion = query('motion') === '1';
  const grow = query('grow') !== '0';
  const portrait = viewport.height > viewport.width;
  const cellWidth = Number(query('w') ?? (portrait ? 270 : 480));
  const cellHeight = Math.round((cellWidth * viewport.height) / viewport.width);
  const [built, setBuilt] = useState<Built | null>(null);

  useEffect(() => {
    if (source === 'list') {
      publish({ ready: true, samples: Object.keys(SAMPLES) });
      return;
    }
    build(source, mode, viewport, themeId).then(setBuilt, (error: unknown) => {
      publish({ ready: true, error: error instanceof Error ? error.message : String(error) });
    });
    // The query is fixed for the page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!built) return;
    let cancelled = false;
    void (async () => {
      await Promise.race([document.fonts.ready, sleep(5000)]);
      await waitForMermaid(8000);
      await waitForImages(5000);
      await twoFrames();
      // Page views lay out lazily (diagrams, data cards); give them a beat.
      await sleep(mode === 'slides' ? 250 : 1200);
      await Promise.race([document.fonts.ready, sleep(3000)]);
      await twoFrames();
      if (cancelled) return;
      const cells = Array.from(document.querySelectorAll<HTMLElement>('[data-xb-cell]')).map(
        (cell): CrossBrowserCell => {
          const frame = cell.querySelector<HTMLElement>('[data-xb-frame]');
          const id = cell.dataset.xbCell!;
          const slide = built.slides?.find((s) => s.id === id);
          return {
            id,
            label: cell.dataset.xbLabel ?? id,
            template: slide?.template,
            metrics: slide && frame ? measureFrame(frame, viewport, []) : undefined,
          };
        },
      );
      publish({ ready: true, cells });
    })();
    return () => {
      cancelled = true;
    };
  }, [built, mode, viewport]);

  if (!built) return null;

  const cell = (id: string, label: string, frame: ReactNode) => (
    <figure key={id} className="xb-cell" data-xb-cell={id} data-xb-label={label}>
      {frame}
      <figcaption>{label}</figcaption>
    </figure>
  );

  if (built.slides) {
    return (
      <div className="xb-grid">
        {built.slides.map(({ id, label, block }) =>
          cell(
            id,
            label,
            <div
              className="xb-frame"
              data-xb-frame
              style={{ width: cellWidth, height: cellHeight }}
            >
              <BlockRenderer
                block={block}
                viewport={viewport}
                theme={built.theme}
                basePath="/"
                blockTime={motion ? 0 : 30}
                animationsEnabled={motion}
                growTextToFit={grow}
              />
            </div>,
          ),
        )}
      </div>
    );
  }

  return (
    <div className="xb-grid">
      {cell(
        mode,
        `${source} · ${mode}`,
        <div className="xb-page" data-xb-frame>
          {mode === 'html' ? (
            <PlainHtmlPreview markdown={built.markdown ?? ''} theme={built.theme} />
          ) : mode === 'editor' ? (
            <EditorProvider initialMarkdown={built.markdown ?? ''} initialView="wysiwyg">
              <WysiwygEditor readOnly ariaLabel="Document" />
            </EditorProvider>
          ) : (
            <LinearDocView doc={built.doc!} viewport={viewport} theme={built.theme} basePath="/" />
          )}
        </div>,
      )}
    </div>
  );
}
