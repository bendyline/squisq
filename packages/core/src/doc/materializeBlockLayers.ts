/**
 * Canonical block-to-layer materialization contract.
 *
 * Timeline scheduling and UI components both delegate here so template
 * lookup, custom templates, ownership, render style, persistent layers,
 * failure policy, and diagnostics cannot drift by render mode.
 */

import type { Block, Layer, MermaidLayer, Position, VideoLayer } from '../schemas/Doc.js';
import type {
  DocBlock,
  PersistentLayerConfig,
  TemplateBlock,
  TemplateContext,
} from '../schemas/BlockTemplates.js';
import type { CustomTemplateDefinition } from '../schemas/CustomTemplates.js';
import type { Theme } from '../schemas/Theme.js';
import type { ViewportConfig } from '../schemas/Viewport.js';
import type { MarkdownCodeBlock } from '../markdown/types.js';
import { createTemplateContext, isTemplateBlock } from '../schemas/BlockTemplates.js';
import { DEFAULT_THEME } from '../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../schemas/Viewport.js';
import { cloneData } from '../internal/immutable.js';
import { applyRenderStyleToLayers } from './utils/applyRenderStyle.js';
import { coerceTemplateParams } from './templates/inputDescriptors.js';
import { fallbackBlockLayers } from './templates/fallbackBlock.js';
import { expandPersistentLayers, wrapWithPersistentLayers } from './templates/persistentLayers.js';
import { resolveTemplateName } from './templates/templateNames.js';
import { deriveTemplateInputs, extractEmbeddedVideos } from './templateInputs.js';
import {
  buildRegistry,
  templateRegistry,
  type RuntimeTemplateRegistry,
} from './templates/registry.js';

/** Internal result from executing one template function. */
type TemplateLayerMaterialization =
  | { status: 'ok'; layers: Layer[] }
  | { status: 'unknown-template'; layers: [] }
  | { status: 'invalid-result'; layers: []; receivedType: string }
  | { status: 'error'; layers: []; error: unknown };

/** How a failed template render is represented in the returned layer graph. */
export type LayerMaterializationFailureMode = 'fallback' | 'empty';

/** A structured, inspectable explanation for a template render failure. */
export type LayerMaterializationDiagnostic =
  | {
      code: 'unknown-template';
      template: string;
      message: string;
    }
  | {
      code: 'invalid-template-result';
      template: string;
      message: string;
      receivedType: string;
    }
  | {
      code: 'template-error';
      template: string;
      message: string;
      cause: unknown;
    };

/** Identifies which path produced a materialized layer graph. */
export type LayerMaterializationSource =
  | 'authored'
  | 'template'
  | 'rich-content'
  | 'fallback'
  | 'empty';

/**
 * Complete result from {@link materializeBlockLayers}. Failures are data, not
 * console side effects: callers can display, report, or ignore the diagnostic.
 */
export interface BlockLayerMaterialization {
  layers: Layer[];
  source: LayerMaterializationSource;
  diagnostic?: LayerMaterializationDiagnostic;
}

/**
 * The single public context for turning a block into renderable layers.
 *
 * Theme persistent layers are inherited by default. Pass
 * `persistentLayers: false` to opt out, or a config to replace the theme's
 * persistent layers wholesale.
 */
export interface MaterializeBlockLayersOptions {
  /** Theme used by templates and render-style post-processing. */
  theme?: Theme;
  /** Target viewport. Defaults to the landscape preset. */
  viewport?: ViewportConfig;
  /** Theme inheritance override for persistent layers. */
  persistentLayers?: PersistentLayerConfig | false;
  /** Zero-based position in the flattened render sequence. */
  blockIndex?: number;
  /** Number of blocks in the flattened render sequence. */
  totalBlocks?: number;
  /** Document-scoped custom templates; built-ins win name collisions. */
  customTemplates?: readonly CustomTemplateDefinition[];
  /** Failed templates render a visible fallback by default. */
  failureMode?: LayerMaterializationFailureMode;
}

/** Pre-expanded scheduling cache; not part of the public materialization API. */
export interface ExpandedPersistentLayerSet {
  bottomLayers: Layer[];
  topLayers: Layer[];
}

/** Internal dependencies and compatibility switches supplied by orchestrators. */
export interface MaterializationRuntime {
  registry: RuntimeTemplateRegistry;
  templateContext?: TemplateContext;
  applyRenderStyle?: boolean;
  expandedPersistentLayers?: ExpandedPersistentLayerSet;
}

/**
 * Turn any doc block into an owned, render-ready layer graph.
 *
 * This is the only recommended public materialization entry point.
 */
export function materializeBlockLayers(
  block: DocBlock,
  options: MaterializeBlockLayersOptions = {},
): BlockLayerMaterialization {
  const registry =
    options.customTemplates && options.customTemplates.length > 0
      ? buildRegistry(options.customTemplates)
      : (templateRegistry as unknown as RuntimeTemplateRegistry);
  return materializeBlockLayersWithRuntime(block, options, { registry });
}

/** Internal entry point for schedulers that cache registry and persistent expansion. */
export function materializeBlockLayersWithRuntime(
  block: DocBlock,
  options: MaterializeBlockLayersOptions,
  runtime: MaterializationRuntime,
): BlockLayerMaterialization {
  const theme = options.theme ?? DEFAULT_THEME;
  const viewport = options.viewport ?? VIEWPORT_PRESETS.landscape;
  const blockIndex = options.blockIndex ?? 0;
  const totalBlocks = options.totalBlocks ?? 1;
  const effectivePersistentLayers =
    options.persistentLayers === false
      ? undefined
      : (options.persistentLayers ?? theme.persistentLayers);

  const existingLayers = (block as Block).layers;
  if (existingLayers && existingLayers.length > 0 && !isTemplateBlock(block)) {
    const layers = appendRichContentLayers(
      cloneData(existingLayers),
      block as Block,
      theme,
      viewport,
    );
    return {
      layers: injectPersistentLayers(
        layers,
        block,
        theme,
        effectivePersistentLayers,
        runtime.expandedPersistentLayers,
      ),
      source: 'authored',
    };
  }

  if (!isTemplateBlock(block)) {
    const layers = appendRichContentLayers([], block as Block, theme, viewport);
    return {
      layers: injectPersistentLayers(
        layers,
        block,
        theme,
        effectivePersistentLayers,
        runtime.expandedPersistentLayers,
      ),
      source: layers.length > 0 ? 'rich-content' : 'empty',
    };
  }

  const context = runtime.templateContext
    ? cloneData(runtime.templateContext)
    : createTemplateContext(theme, blockIndex, totalBlocks, viewport);
  context.block = cloneData(block as Block);

  const execution = executeTemplateMaterialization(block, context, runtime.registry);
  if (execution.status === 'ok') {
    const styledLayers =
      runtime.applyRenderStyle !== false
        ? applyRenderStyleToLayers(execution.layers, block as Block, theme)
        : execution.layers;
    const layers = appendRichContentLayers(styledLayers, block as Block, theme, viewport);
    return {
      layers: injectPersistentLayers(
        layers,
        block,
        theme,
        effectivePersistentLayers,
        runtime.expandedPersistentLayers,
      ),
      source: 'template',
    };
  }

  const diagnostic = toLayerMaterializationDiagnostic(block.template, execution);
  if ((options.failureMode ?? 'fallback') === 'empty') {
    const layers = appendRichContentLayers([], block as Block, theme, viewport);
    return {
      layers: injectPersistentLayers(
        layers,
        block,
        theme,
        effectivePersistentLayers,
        runtime.expandedPersistentLayers,
      ),
      source: layers.length > 0 ? 'rich-content' : 'empty',
      diagnostic,
    };
  }

  const fallbackLayers = appendRichContentLayers(
    fallbackBlockLayers(block, context, diagnostic.message),
    block as Block,
    theme,
    viewport,
  );
  return {
    layers: injectPersistentLayers(
      fallbackLayers,
      block,
      theme,
      effectivePersistentLayers,
      runtime.expandedPersistentLayers,
    ),
    source: 'fallback',
    diagnostic,
  };
}

interface LayerRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Mermaid fences are explicit author intent and never inferred from other code. */
function mermaidSources(block: Block): string[] {
  return (block.contents ?? [])
    .filter(
      (node): node is MarkdownCodeBlock =>
        node.type === 'code' && node.lang?.trim().toLowerCase() === 'mermaid',
    )
    .map((node) => node.value)
    .filter((source) => source.trim().length > 0);
}

function resolvePositionValue(value: number | string | undefined, dimension: number): number {
  if (value === undefined) return 0;
  if (typeof value === 'number') return value;
  const percent = value.match(/^\s*(-?\d+(?:\.\d+)?)%\s*$/);
  if (percent) return (Number(percent[1]) / 100) * dimension;
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function positionRect(
  position: Position,
  viewport: ViewportConfig,
  fallbackWidth: number,
  fallbackHeight: number,
): LayerRect {
  const width = position.width
    ? resolvePositionValue(position.width, viewport.width)
    : fallbackWidth;
  const height = position.height
    ? resolvePositionValue(position.height, viewport.height)
    : fallbackHeight;
  let x = resolvePositionValue(position.x, viewport.width);
  let y = resolvePositionValue(position.y, viewport.height);
  const anchor = position.anchor ?? 'top-left';
  if (anchor === 'center') {
    x -= width / 2;
    y -= height / 2;
  } else {
    if (anchor.endsWith('right')) x -= width;
    if (anchor.startsWith('bottom')) y -= height;
  }
  return { x, y, width, height };
}

function overlapArea(a: LayerRect, b: LayerRect): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

/**
 * Pick the least-obstructed media region when a template already owns the
 * slide. Background shapes/paths are deliberately ignored; text and existing
 * rich media are what an embedded-media inset must avoid.
 */
function richMediaRegion(layers: readonly Layer[], viewport: ViewportConfig): LayerRect {
  const occupied = layers
    .filter((layer) => layer.type !== 'shape' && layer.type !== 'path' && layer.type !== 'mermaid')
    .map((layer) =>
      positionRect(
        layer.position,
        viewport,
        layer.type === 'text' ? viewport.width * 0.45 : viewport.width * 0.5,
        layer.type === 'text' ? viewport.height * 0.2 : viewport.height * 0.55,
      ),
    );
  if (occupied.length === 0) {
    return {
      x: viewport.width * 0.06,
      y: viewport.height * 0.08,
      width: viewport.width * 0.88,
      height: viewport.height * 0.84,
    };
  }

  const candidates: LayerRect[] = [
    {
      x: viewport.width * 0.52,
      y: viewport.height * 0.12,
      width: viewport.width * 0.44,
      height: viewport.height * 0.76,
    },
    {
      x: viewport.width * 0.04,
      y: viewport.height * 0.12,
      width: viewport.width * 0.44,
      height: viewport.height * 0.76,
    },
    {
      x: viewport.width * 0.15,
      y: viewport.height * 0.53,
      width: viewport.width * 0.7,
      height: viewport.height * 0.41,
    },
  ];
  return candidates.reduce((best, candidate) => {
    const score = occupied.reduce((sum, rect) => sum + overlapArea(candidate, rect), 0);
    const bestScore = occupied.reduce((sum, rect) => sum + overlapArea(best, rect), 0);
    return score < bestScore ? candidate : best;
  });
}

/** Add directly embedded videos as synchronized, muted slide layers. */
function appendEmbeddedVideoLayers(
  layers: Layer[],
  block: Block,
  viewport: ViewportConfig,
): Layer[] {
  const existingSrcs = new Set(
    layers
      .filter((layer): layer is VideoLayer => layer.type === 'video')
      .map((layer) => layer.content.src),
  );
  const videos = extractEmbeddedVideos(block.contents).filter(
    (video) => !existingSrcs.has(video.src),
  );
  if (videos.length === 0) return layers;

  const region = richMediaRegion(layers, viewport);
  const columns = videos.length === 1 ? 1 : 2;
  const rows = Math.ceil(videos.length / columns);
  const gap = Math.min(viewport.width, viewport.height) * 0.018;
  const width = (region.width - gap * (columns - 1)) / columns;
  const height = (region.height - gap * (rows - 1)) / rows;
  const clipEnd = Math.max(0, block.duration);
  const videoLayers: VideoLayer[] = videos.map((video, index) => ({
    id: `${block.id}-embedded-video-${index + 1}`,
    type: 'video',
    position: {
      x: region.x + (index % columns) * (width + gap),
      y: region.y + Math.floor(index / columns) * (height + gap),
      width,
      height,
    },
    content: {
      src: video.src,
      ...(video.posterSrc ? { posterSrc: video.posterSrc } : {}),
      alt: video.alt || block.title || 'Embedded video',
      fit: 'contain',
      clipStart: 0,
      clipEnd,
    },
  }));
  return [...layers, ...videoLayers];
}

/** Add every Mermaid fence as a responsive rich-media layer. */
function appendMermaidLayers(
  layers: Layer[],
  block: Block,
  theme: Theme,
  viewport: ViewportConfig,
): Layer[] {
  const sources = mermaidSources(block);
  if (sources.length === 0 || layers.some((layer) => layer.type === 'mermaid')) return layers;

  const region = richMediaRegion(layers, viewport);
  const columns = sources.length === 1 ? 1 : 2;
  const rows = Math.ceil(sources.length / columns);
  const gap = Math.min(viewport.width, viewport.height) * 0.018;
  const width = (region.width - gap * (columns - 1)) / columns;
  const height = (region.height - gap * (rows - 1)) / rows;
  const mermaidLayers: MermaidLayer[] = sources.map((source, index) => ({
    id: `${block.id}-mermaid-${index + 1}`,
    type: 'mermaid',
    position: {
      x: region.x + (index % columns) * (width + gap),
      y: region.y + Math.floor(index / columns) * (height + gap),
      width,
      height,
    },
    content: {
      source,
      background: theme.colors.backgroundLight,
      foreground: theme.colors.text,
      padding: Math.max(12, Math.round(Math.min(width, height) * 0.025)),
    },
  }));
  return [...layers, ...mermaidLayers];
}

/** Promote high-value body embeds through one shared materialization path. */
function appendRichContentLayers(
  layers: Layer[],
  block: Block,
  theme: Theme,
  viewport: ViewportConfig,
): Layer[] {
  return appendMermaidLayers(
    appendEmbeddedVideoLayers(layers, block, viewport),
    block,
    theme,
    viewport,
  );
}

function executeTemplateMaterialization(
  templateBlock: TemplateBlock,
  context: TemplateContext,
  registry: RuntimeTemplateRegistry,
): TemplateLayerMaterialization {
  const safeTemplateBlock = cloneData(templateBlock);
  const safeContext = cloneData(context);
  const maybeChildren = (safeTemplateBlock as Block).children;
  if ((!safeContext.children || safeContext.children.length === 0) && maybeChildren?.length) {
    safeContext.children = maybeChildren;
  }

  const templateFn = registry[resolveTemplateName(safeTemplateBlock.template)];
  if (!templateFn) return { status: 'unknown-template', layers: [] };

  const { templateData, templateOverrides } = safeTemplateBlock as Block;
  const sourceBlock = safeTemplateBlock as Block;
  const derivedInputs = sourceBlock.sourceHeading
    ? deriveTemplateInputs(
        safeTemplateBlock.template,
        sourceBlock.title ?? '',
        sourceBlock.contents,
      )
    : null;
  const input =
    derivedInputs || templateData || templateOverrides
      ? ({
          ...derivedInputs,
          ...safeTemplateBlock,
          ...templateData,
          ...coerceTemplateParams(safeTemplateBlock.template, templateOverrides ?? {}).input,
        } as TemplateBlock)
      : safeTemplateBlock;

  try {
    const renderedLayers = templateFn(input, safeContext);
    if (!Array.isArray(renderedLayers)) {
      return {
        status: 'invalid-result',
        layers: [],
        receivedType: typeof renderedLayers,
      };
    }
    return { status: 'ok', layers: cloneData(renderedLayers) };
  } catch (error: unknown) {
    return { status: 'error', layers: [], error };
  }
}

function toLayerMaterializationDiagnostic(
  template: string,
  execution: Exclude<TemplateLayerMaterialization, { status: 'ok' }>,
): LayerMaterializationDiagnostic {
  if (execution.status === 'unknown-template') {
    return {
      code: 'unknown-template',
      template,
      message: `Unknown template "${template}"`,
    };
  }
  if (execution.status === 'invalid-result') {
    return {
      code: 'invalid-template-result',
      template,
      receivedType: execution.receivedType,
      message: `Template "${template}" returned ${execution.receivedType}, not a layer array`,
    };
  }
  return {
    code: 'template-error',
    template,
    cause: execution.error,
    message: `Template "${template}" failed`,
  };
}

function injectPersistentLayers(
  layers: Layer[],
  block: DocBlock,
  theme: Theme,
  persistentLayers?: PersistentLayerConfig,
  expanded?: ExpandedPersistentLayerSet,
): Layer[] {
  if (!persistentLayers) return layers;
  const bottomLayers =
    expanded?.bottomLayers ?? expandPersistentLayers(persistentLayers.bottomLayers, theme);
  const topLayers =
    expanded?.topLayers ?? expandPersistentLayers(persistentLayers.topLayers, theme);
  return wrapWithPersistentLayers(layers, block as TemplateBlock, bottomLayers, topLayers);
}
