/** Browser-only, lazy official Mermaid renderer shared by page and slide views. */

import type { RenderResult } from 'mermaid';
import type { Theme } from '@bendyline/squisq/schemas';
import { buildMermaidThemeVariables } from '@bendyline/squisq/schemas';
import { DEFAULT_THEME } from '@bendyline/squisq/doc';

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

const MERMAID_BASE_CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict' as const,
  suppressErrorRendering: true,
  deterministicIds: false,
  logLevel: 'error' as const,
};

interface MermaidQueueHost {
  __squisqMermaidWorkQueue?: Promise<void>;
}

async function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid')
      .then(({ default: mermaid }) => mermaid)
      .catch((error: unknown) => {
        mermaidPromise = null;
        throw error;
      });
  }
  return mermaidPromise;
}

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  // Mermaid's diagram databases are shared by every consumer of the loaded
  // module. Keep editor inspection/rendering and read-only rendition work in
  // one browser-wide queue even though they live in separate packages.
  const host = globalThis as typeof globalThis & MermaidQueueHost;
  const previous = host.__squisqMermaidWorkQueue ?? Promise.resolve();
  const result = previous.then(run, run);
  host.__squisqMermaidWorkQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Mermaid wraps an HTML label only when the label, laid out on one line under
 * its wrapping `max-width`, measures exactly that width (`bbox.width ===
 * width`). At fractional display scales Chromium snaps layout to device
 * pixels, so a clamped 200px label measures 199.995 or 200.00002 and Mermaid
 * lays every long label out as one clipped line. Half a pixel is far beyond
 * that snapping, and a label really that much narrower fits on one line
 * whether or not Mermaid switches it to wrapping.
 */
const LABEL_WIDTH_SNAP = 0.5;

/**
 * Run Mermaid work with HTML label widths snapped to their wrapping width, so
 * long labels wrap at every display scale. Call it inside the shared Mermaid
 * work queue, which keeps two renders from overlapping.
 */
export async function withMermaidLabelWrapping<T>(run: () => Promise<T>): Promise<T> {
  const prototype = Element.prototype;
  const measure = prototype.getBoundingClientRect;
  function snapped(this: Element): DOMRect {
    const rect = measure.call(this);
    if (!(this instanceof HTMLElement) || this.parentElement?.localName !== 'foreignObject') {
      return rect;
    }
    const maxWidth = Number.parseFloat(this.style.maxWidth);
    return Math.abs(rect.width - maxWidth) < LABEL_WIDTH_SNAP
      ? new DOMRect(rect.x, rect.y, maxWidth, rect.height)
      : rect;
  }
  prototype.getBoundingClientRect = snapped;
  try {
    return await run();
  } finally {
    if (prototype.getBoundingClientRect === snapped) prototype.getBoundingClientRect = measure;
  }
}

/** Render one source through Mermaid's public API. */
export function renderMermaidSvg(
  id: string,
  source: string,
  container?: Element,
  theme: Theme = DEFAULT_THEME,
): Promise<Pick<RenderResult, 'svg' | 'diagramType'>> {
  return enqueue(async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      ...MERMAID_BASE_CONFIG,
      theme: 'base',
      themeVariables: buildMermaidThemeVariables(theme),
    });
    const { svg, diagramType } = await withMermaidLabelWrapping(() =>
      mermaid.render(id, source, container),
    );
    return { svg, diagramType };
  });
}

/**
 * Render one source for a static picture (a document export) rather than for
 * the page. Labels are SVG text instead of HTML: an SVG with
 * `<foreignObject>` labels cannot be drawn onto a canvas and read back in
 * every browser. `fontFamily` should be a system font, because a picture of
 * the SVG cannot load the page's web fonts.
 */
export function renderMermaidSvgForExport(
  id: string,
  source: string,
  theme: Theme = DEFAULT_THEME,
  fontFamily?: string,
): Promise<string> {
  return enqueue(async () => {
    const mermaid = await loadMermaid();
    const themeVariables = buildMermaidThemeVariables(theme);
    mermaid.initialize({
      ...MERMAID_BASE_CONFIG,
      theme: 'base',
      themeVariables: fontFamily ? { ...themeVariables, fontFamily } : themeVariables,
      htmlLabels: false,
      journey: { textPlacement: 'tspan' },
    });
    const { svg } = await mermaid.render(id, source);
    return svg;
  });
}

export function mermaidRenderErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return (
    raw
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .slice(0, 6)
      .join('\n') || 'Unknown Mermaid rendering error.'
  );
}
