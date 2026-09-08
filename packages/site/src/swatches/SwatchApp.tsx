import { useEffect, useMemo } from 'react';
import { BlockRenderer } from '@bendyline/squisq-react';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import {
  TEMPLATE_METADATA,
  expandDocBlocks,
  markdownToDoc,
  templateRegistry,
  type LayerMaterializationDiagnostic,
} from '@bendyline/squisq/doc';
import {
  VIEWPORT_PRESETS,
  buildGoogleFontsUrl,
  getThemeSummaries,
  resolveTheme,
  type Block,
  type Theme,
  type ViewportConfig,
} from '@bendyline/squisq/schemas';
import '@bendyline/squisq-react/styles';
import {
  CONTENT_VARIANTS,
  TEMPLATE_SEEDS,
  buildSwatchMarkdown,
  variantApplies,
  type BodyExpectation,
  type ContentVariant,
} from './content';
import { coverageWords, measureFrame, type SwatchMetrics } from './measure';

/** Capture frames at two-thirds of the viewport so a landscape swatch is 1280×720. */
const CSS_SCALE = 2 / 3;

export type Orientation = 'landscape' | 'portrait' | 'square';
const ORIENTATIONS: readonly Orientation[] = ['landscape', 'portrait', 'square'];

export interface SwatchManifest {
  orientations: Record<
    Orientation,
    { viewport: { width: number; height: number }; css: { width: number; height: number } }
  >;
  themes: Array<{ id: string; name: string; description?: string }>;
  templates: Array<{
    id: string;
    label: string;
    description: string;
    bodyExpectation: BodyExpectation;
    /** Variant ids that exercise this template's primary slot. */
    applicableVariants: string[];
  }>;
  variants: Array<{ id: string; label: string; description: string; features: string[] }>;
}

export interface SwatchResult {
  variant: string;
  applicable: boolean;
  markdown: string;
  heading: string;
  diagnostics: Array<{ code: string; message: string }>;
  metrics: SwatchMetrics;
}

interface HarnessState {
  ready: boolean;
  manifest: SwatchManifest;
  results: Record<string, SwatchResult>;
  error?: string;
}

declare global {
  interface Window {
    __SQUISQ_SWATCHES__?: HarnessState;
  }
}

function buildManifest(): SwatchManifest {
  const templateIds = Object.keys(templateRegistry);
  const orientations = Object.fromEntries(
    ORIENTATIONS.map((o) => {
      const viewport = VIEWPORT_PRESETS[o];
      return [
        o,
        {
          viewport: { width: viewport.width, height: viewport.height },
          css: {
            width: Math.round(viewport.width * CSS_SCALE),
            height: Math.round(viewport.height * CSS_SCALE),
          },
        },
      ];
    }),
  ) as SwatchManifest['orientations'];

  return {
    orientations,
    themes: getThemeSummaries(),
    templates: templateIds.map((id) => ({
      id,
      label: TEMPLATE_METADATA[id]?.label ?? id,
      description: TEMPLATE_METADATA[id]?.description ?? 'No template metadata found.',
      bodyExpectation: TEMPLATE_SEEDS[id]?.bodyExpectation ?? 'partial',
      applicableVariants: CONTENT_VARIANTS.filter((v) => variantApplies(id, v)).map((v) => v.id),
    })),
    variants: CONTENT_VARIANTS.map((v) => ({
      id: v.id,
      label: v.label,
      description: v.description,
      features: [...v.features],
    })),
  };
}

const MANIFEST = buildManifest();

function publish(state: Omit<HarnessState, 'manifest'>): void {
  window.__SQUISQ_SWATCHES__ = { manifest: MANIFEST, ...state };
}

publish({ ready: false, results: {} });

function query(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

interface PreparedSwatch {
  variant: ContentVariant;
  applicable: boolean;
  block?: Block;
  markdown: string;
  heading: string;
  bodyWords: string[];
  diagnostics: Array<{ code: string; message: string }>;
  error?: string;
}

function prepare(
  templateId: string,
  variant: ContentVariant,
  theme: Theme,
  viewport: ViewportConfig,
): PreparedSwatch {
  const { markdown, heading, bodyText } = buildSwatchMarkdown(templateId, variant);
  const diagnostics: Array<{ code: string; message: string }> = [];
  const applicable = variantApplies(templateId, variant);
  try {
    const doc = markdownToDoc(parseMarkdown(markdown), {
      generateCoverBlock: false,
      autoTemplates: false,
    });
    for (const d of doc.diagnostics ?? []) diagnostics.push({ code: d.code, message: d.message });
    const source = doc.blocks[0];
    if (!source) {
      return {
        variant,
        applicable,
        markdown,
        heading,
        bodyWords: [],
        diagnostics,
        error: 'No block parsed',
      };
    }
    const [block] = expandDocBlocks([source], {
      theme,
      viewport,
      onDiagnostic: (d: LayerMaterializationDiagnostic) =>
        diagnostics.push({ code: d.code, message: d.message }),
    });
    return {
      variant,
      applicable,
      block,
      markdown,
      heading,
      // Fenced code and mermaid are not prose a template is expected to show.
      bodyWords: coverageWords(bodyText.replace(/```[\s\S]*?```/g, ' ')),
      diagnostics,
    };
  } catch (error) {
    return {
      variant,
      applicable,
      markdown,
      heading,
      bodyWords: [],
      diagnostics,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function waitForImages(root: ParentNode, deadlineMs: number): Promise<void> {
  const images = Array.from(root.querySelectorAll('img')).filter((img) => !img.complete);
  // SVG <image> elements (contain/fill fits) expose no `complete` flag, so
  // warm the same URLs through HTMLImageElement: once decoded, the SVG
  // image paints from cache on the next frame.
  const svgHrefs = Array.from(root.querySelectorAll('image'))
    .map((el) => el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? '')
    .filter(Boolean);
  const waits: Array<Promise<unknown>> = [];
  for (const img of images) {
    waits.push(
      new Promise<void>((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      }),
    );
  }
  for (const href of new Set(svgHrefs)) {
    const probe = new Image();
    waits.push(
      new Promise<void>((resolve) => {
        probe.onload = () => resolve();
        probe.onerror = () => resolve();
        probe.src = href;
      }).then(() => probe.decode().catch(() => undefined)),
    );
  }
  if (waits.length === 0) return Promise.resolve();
  return Promise.race([
    Promise.all(waits).then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, deadlineMs)),
  ]);
}

function waitForMermaid(root: ParentNode, deadlineMs: number): Promise<void> {
  const frames = Array.from(root.querySelectorAll('.block-layer--mermaid'));
  if (frames.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const started = performance.now();
    const tick = () => {
      const settled = frames.every(
        (f) => f.querySelector('svg') || f.querySelector('[data-error], .squisq-mermaid-error'),
      );
      if (settled || performance.now() - started > deadlineMs) resolve();
      else window.setTimeout(tick, 100);
    };
    tick();
  });
}

function waitForFonts(theme: Theme, useGoogle: boolean): Promise<unknown> {
  const withDeadline = (p: Promise<unknown>, ms: number) =>
    Promise.race([p, new Promise((resolve) => window.setTimeout(resolve, ms))]);
  if (!useGoogle) return withDeadline(document.fonts.ready, 5000);
  const url = buildGoogleFontsUrl([
    theme.typography.titleFont,
    theme.typography.bodyFont,
    theme.typography.monoFont,
  ]);
  if (!url) return withDeadline(document.fonts.ready, 5000);
  return new Promise<void>((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    const done = () => resolve();
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
    window.setTimeout(done, 3000);
    document.head.appendChild(link);
  }).then(() => withDeadline(document.fonts.ready, 5000));
}

const twoFrames = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

export function SwatchApp() {
  const templateId = query('template');
  const themeId = query('theme') ?? MANIFEST.themes[0]?.id ?? 'standard';
  const orientationParam = query('orientation') as Orientation | null;
  const orientation: Orientation =
    orientationParam && ORIENTATIONS.includes(orientationParam) ? orientationParam : 'landscape';
  const variantsParam = query('variants') ?? '';
  const useGoogle = query('fonts') === 'google';

  const theme = useMemo(() => resolveTheme(themeId), [themeId]);
  const viewport = VIEWPORT_PRESETS[orientation];
  const css = MANIFEST.orientations[orientation].css;

  const prepared = useMemo<PreparedSwatch[]>(() => {
    if (!templateId) return [];
    const requested = variantsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const variants = requested.length
      ? requested
          .map((id) => CONTENT_VARIANTS.find((v) => v.id === id))
          .filter((v): v is ContentVariant => Boolean(v))
      : CONTENT_VARIANTS.filter((v) => variantApplies(templateId, v));
    return variants.map((variant) => prepare(templateId, variant, theme, viewport));
  }, [templateId, theme, viewport, variantsParam]);

  const unknownTemplate = templateId && !(templateId in templateRegistry);

  useEffect(() => {
    if (!templateId) {
      publish({ ready: true, results: {} });
      return;
    }
    if (unknownTemplate) {
      publish({ ready: true, results: {}, error: `Unknown template "${templateId}"` });
      return;
    }
    let cancelled = false;
    const root = document.getElementById('swatch-root') ?? document.body;
    waitForFonts(theme, useGoogle)
      .then(() => waitForImages(root, 4000))
      .then(() => waitForMermaid(root, 6000))
      .then(twoFrames)
      .then(() => new Promise((resolve) => window.setTimeout(resolve, 60)))
      .then(twoFrames)
      .then(() => {
        if (cancelled) return;
        const results: Record<string, SwatchResult> = {};
        let firstError: string | undefined;
        for (const item of prepared) {
          const frame = document.querySelector<HTMLElement>(
            `section.swatch-frame[data-variant="${item.variant.id}"]`,
          );
          if (item.error || !frame) {
            firstError ??= `${templateId}/${item.variant.id}: ${item.error ?? 'frame missing'}`;
            continue;
          }
          const metrics = measureFrame(frame, viewport, item.bodyWords);
          results[item.variant.id] = {
            variant: item.variant.id,
            applicable: item.applicable,
            markdown: item.markdown,
            heading: item.heading,
            diagnostics: item.diagnostics,
            metrics,
          };
        }
        publish({ ready: true, results, ...(firstError ? { error: firstError } : {}) });
      });
    return () => {
      cancelled = true;
    };
  }, [prepared, templateId, theme, unknownTemplate, useGoogle, viewport]);

  if (!templateId) {
    return (
      <main className="swatch-page">
        <p className="swatch-label">
          Swatch harness ready — {MANIFEST.themes.length} themes × {MANIFEST.templates.length}{' '}
          templates × {MANIFEST.variants.length} variants. Add ?theme=&template=&variants= to
          render.
        </p>
      </main>
    );
  }

  if (unknownTemplate) {
    return (
      <main className="swatch-page">
        <section className="swatch-error">Unknown template &quot;{templateId}&quot;.</section>
      </main>
    );
  }

  return (
    <main className="swatch-page" id="swatch-root">
      {prepared.map((item) =>
        item.block ? (
          <div key={item.variant.id}>
            <p className="swatch-label">
              {themeId} / {templateId} / {item.variant.id}
              {item.applicable ? '' : ' (inapplicable — fallback expected)'}
            </p>
            <section
              className="swatch-frame"
              data-variant={item.variant.id}
              data-applicable={item.applicable ? 'true' : 'false'}
              aria-label={`${theme.name} / ${templateId} / ${item.variant.id}`}
              style={{ width: css.width, height: css.height, background: theme.colors.background }}
            >
              <BlockRenderer
                block={item.block}
                blockTime={2}
                basePath="/"
                viewport={viewport}
                isPlaying={false}
                animationsEnabled={false}
                theme={theme}
              />
            </section>
          </div>
        ) : (
          <section key={item.variant.id} className="swatch-error" data-variant={item.variant.id}>
            {templateId}/{item.variant.id}: {item.error ?? 'did not render'}
          </section>
        ),
      )}
    </main>
  );
}
