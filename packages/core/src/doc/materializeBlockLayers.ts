/**
 * Canonical block-to-layer materialization contract.
 *
 * Timeline scheduling and UI components both delegate here so template
 * lookup, custom templates, ownership, render style, persistent layers,
 * failure policy, and diagnostics cannot drift by render mode.
 */

import type {
  Block,
  ImageLayer,
  ImageTreatment,
  Layer,
  MermaidLayer,
  ShapeLayer,
  VideoLayer,
} from '../schemas/Doc.js';
import type {
  DiagramBlockInput,
  DocBlock,
  PersistentLayerConfig,
  TemplateBlock,
  TemplateContext,
  TimelineBlockInput,
  TreeBlockInput,
} from '../schemas/BlockTemplates.js';
import type { CustomTemplateDefinition } from '../schemas/CustomTemplates.js';
import type { Theme } from '../schemas/Theme.js';
import type { ViewportConfig } from '../schemas/Viewport.js';
import type { MarkdownCodeBlock } from '../markdown/types.js';
import { createTemplateContext, isTemplateBlock } from '../schemas/BlockTemplates.js';
import { DEFAULT_THEME } from '../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../schemas/Viewport.js';
import { withAlpha } from '../schemas/colorUtils.js';
import { cloneData } from '../internal/immutable.js';
import { applyRenderStyleToLayers } from './utils/applyRenderStyle.js';
import { coerceTemplateParams } from './templates/inputDescriptors.js';
import { fallbackBlockLayers } from './templates/fallbackBlock.js';
import { expandPersistentLayers, wrapWithPersistentLayers } from './templates/persistentLayers.js';
import { resolveTemplateName } from './templates/templateNames.js';
import { deriveTemplateInputs, extractEmbeddedVideos, extractImages } from './templateInputs.js';
import {
  placeLayersInRect,
  resolveSupplementalMediaLayout,
  type LayerRect,
} from './richMediaLayout.js';
import {
  detectAsciiDiagram,
  isEligibleAsciiFenceLang,
  isExplicitDiagramLang,
} from './asciiDiagram/detect.js';
import { asciiDiagramToTemplateData } from './asciiDiagram/mapping.js';
import {
  detectAsciiTimeline,
  isEligibleAsciiTimelineFenceLang,
  isExplicitTimelineLang,
} from './asciiTimeline/detect.js';
import { asciiTimelineToTemplateData } from './asciiTimeline/mapping.js';
import { detectTree, isEligibleTreeFenceLang, isExplicitTreeLang } from './treeview/detect.js';
import { treeToTemplateData } from './treeview/mapping.js';
import { diagramBlock } from './templates/diagramBlock.js';
import { timelineBlock } from './templates/timelineBlock.js';
import { treeBlock } from './templates/treeBlock.js';
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

type RichMediaItem =
  | { kind: 'image'; src: string; alt: string; aspectRatio?: number }
  | {
      kind: 'video';
      src: string;
      posterSrc?: string;
      alt: string;
      aspectRatio: number;
      startAt?: number;
      clipStart?: number;
      clipEnd?: number;
    }
  | { kind: 'mermaid'; source: string; aspectRatio: number }
  | {
      kind: 'spatial';
      template: 'diagram' | 'tree' | 'timeline';
      data: Record<string, unknown>;
      aspectRatio: number;
    };

/** Detect spatial fences that an explicitly different outer template did not consume. */
function embeddedSpatialMedia(block: Block): RichMediaItem[] {
  const canonicalTemplate = block.template ? resolveTemplateName(block.template) : undefined;
  const fences = (block.contents ?? []).filter(
    (node): node is MarkdownCodeBlock => node.type === 'code',
  );
  const items: RichMediaItem[] = [];
  for (const fence of fences) {
    if (canonicalTemplate !== 'diagram' && isEligibleAsciiFenceLang(fence.lang)) {
      const detection = detectAsciiDiagram(fence.value, {
        explicit: isExplicitDiagramLang(fence.lang),
      });
      if (detection.isDiagram && detection.diagram) {
        items.push({
          kind: 'spatial',
          template: 'diagram',
          data: asciiDiagramToTemplateData(detection.diagram),
          aspectRatio: 16 / 9,
        });
        continue;
      }
    }
    if (canonicalTemplate !== 'tree' && isEligibleTreeFenceLang(fence.lang)) {
      const detection = detectTree(fence.value, { explicit: isExplicitTreeLang(fence.lang) });
      if (detection.isTree && detection.tree) {
        items.push({
          kind: 'spatial',
          template: 'tree',
          data: treeToTemplateData(detection.tree),
          aspectRatio: 3 / 4,
        });
        continue;
      }
    }
    if (canonicalTemplate !== 'timeline' && isEligibleAsciiTimelineFenceLang(fence.lang)) {
      const detection = detectAsciiTimeline(fence.value, {
        explicit: isExplicitTimelineLang(fence.lang),
      });
      if (detection.isTimeline && detection.timeline) {
        items.push({
          kind: 'spatial',
          template: 'timeline',
          data: asciiTimelineToTemplateData(detection.timeline),
          aspectRatio: 16 / 9,
        });
      }
    }
  }
  return items;
}

function collectRichMediaItems(layers: readonly Layer[], block: Block): RichMediaItem[] {
  const existingImages = new Set(
    layers
      .filter((layer): layer is ImageLayer => layer.type === 'image')
      .map((layer) => layer.content.src),
  );
  const existingVideos = new Set(
    layers
      .filter((layer): layer is VideoLayer => layer.type === 'video')
      .map((layer) => layer.content.src),
  );
  const existingMermaid = new Set(
    layers
      .filter((layer): layer is MermaidLayer => layer.type === 'mermaid')
      .map((layer) => layer.content.source),
  );

  const embeddedVideos = extractEmbeddedVideos(block.contents);
  const videos = embeddedVideos.filter((video) => !existingVideos.has(video.src));
  const videoSources = new Set(embeddedVideos.map((video) => video.src));
  const seenImages = new Set(existingImages);
  const images = extractImages(block.contents).filter((image) => {
    if (videoSources.has(image.src) || seenImages.has(image.src)) return false;
    seenImages.add(image.src);
    return true;
  });
  const sources = mermaidSources(block).filter((source) => !existingMermaid.has(source));

  return [
    ...images.map(
      (image): RichMediaItem => ({
        kind: 'image',
        src: image.src,
        alt: image.alt,
        ...(image.width && image.height ? { aspectRatio: image.width / image.height } : {}),
      }),
    ),
    ...videos.map(
      (video): RichMediaItem => ({
        kind: 'video',
        src: video.src,
        ...(video.posterSrc ? { posterSrc: video.posterSrc } : {}),
        alt: video.alt,
        aspectRatio: 16 / 9,
        ...(video.startAt != null ? { startAt: video.startAt } : {}),
        ...(video.clipStart != null ? { clipStart: video.clipStart } : {}),
        ...(video.clipEnd != null ? { clipEnd: video.clipEnd } : {}),
      }),
    ),
    ...sources.map((source): RichMediaItem => ({ kind: 'mermaid', source, aspectRatio: 16 / 9 })),
    ...embeddedSpatialMedia(block),
  ];
}

function gridCells(
  region: LayerRect,
  count: number,
  viewport: ViewportConfig,
  inset: boolean,
): LayerRect[] {
  const unit = Math.min(viewport.width, viewport.height);
  const padding = inset ? unit * 0.025 : 0;
  const gap = count > 1 ? unit * 0.018 : 0;
  const inner = {
    x: region.x + padding,
    y: region.y + padding,
    width: Math.max(0, region.width - padding * 2),
    height: Math.max(0, region.height - padding * 2),
  };
  const columns = Math.min(
    count,
    Math.max(1, Math.ceil(Math.sqrt(count * (inner.width / Math.max(1, inner.height))))),
  );
  const rows = Math.ceil(count / columns);
  const width = (inner.width - gap * (columns - 1)) / columns;
  const height = (inner.height - gap * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, index) => ({
    x: inner.x + (index % columns) * (width + gap),
    y: inner.y + Math.floor(index / columns) * (height + gap),
    width,
    height,
  }));
}

function effectiveImageTreatment(theme: Theme, block: Block): ImageTreatment | undefined {
  const override = (block as Block & { imageTreatment?: ImageTreatment['type'] }).imageTreatment;
  if (override === 'none') return undefined;
  const base = override
    ? { type: override, strength: theme.style.imageTreatment?.strength }
    : theme.style.imageTreatment;
  if (!base || base.type === 'none') return undefined;
  return base.type === 'duotone' && !base.color ? { ...base, color: theme.colors.primary } : base;
}

function richMediaLayers(
  item: RichMediaItem,
  position: LayerRect,
  block: Block,
  theme: Theme,
  kindIndex: number,
): Layer[] {
  if (item.kind === 'image') {
    const treatment = effectiveImageTreatment(theme, block);
    return [
      {
        id: `${block.id}-embedded-image-${kindIndex}`,
        type: 'image',
        position,
        content: {
          src: item.src,
          alt: item.alt || block.title || 'Embedded image',
          fit: 'contain',
          ...(treatment ? { treatment } : {}),
        },
      },
    ];
  }
  if (item.kind === 'video') {
    const clipStart = Math.max(0, item.clipStart ?? 0);
    return [
      {
        id: `${block.id}-embedded-video-${kindIndex}`,
        type: 'video',
        position,
        content: {
          src: item.src,
          ...(item.posterSrc ? { posterSrc: item.posterSrc } : {}),
          alt: item.alt || block.title || 'Embedded video',
          fit: 'contain',
          clipStart,
          clipEnd: Math.max(clipStart, item.clipEnd ?? clipStart + Math.max(0, block.duration)),
          ...(item.startAt != null ? { startAt: Math.max(0, item.startAt) } : {}),
        },
      },
    ];
  }
  if (item.kind === 'mermaid') {
    return [
      {
        id: `${block.id}-mermaid-${kindIndex}`,
        type: 'mermaid',
        position,
        content: {
          source: item.source,
          background: theme.colors.backgroundLight,
          foreground: theme.colors.text,
          padding: Math.max(12, Math.round(Math.min(position.width, position.height) * 0.025)),
        },
      },
    ];
  }

  const localViewport: ViewportConfig = {
    width: position.width,
    height: position.height,
    name: `Embedded ${item.template}`,
  };
  const context = createTemplateContext(theme, 0, 1, localViewport);
  context.block = cloneData(block);
  const base = {
    id: `${block.id}-embedded-${item.template}-${kindIndex}`,
    duration: block.duration,
    audioSegment: block.audioSegment,
    ...item.data,
  };
  const localLayers =
    item.template === 'timeline'
      ? timelineBlock({ ...base, template: 'timeline' } as TimelineBlockInput, context)
      : item.template === 'tree'
        ? treeBlock({ ...base, template: 'tree' } as TreeBlockInput, context)
        : diagramBlock({ ...base, template: 'diagram' } as DiagramBlockInput, context);
  return placeLayersInRect(
    localLayers,
    localViewport,
    position,
    `${block.id}-embedded-${item.template}-${kindIndex}`,
  );
}

/** Apply inline-video timing attributes to a template-produced video layer. */
function applyEmbeddedVideoTiming(layers: Layer[], block: Block): Layer[] {
  const timedBySrc = new Map(
    extractEmbeddedVideos(block.contents)
      .filter((video) => video.startAt != null || video.clipStart != null || video.clipEnd != null)
      .map((video) => [video.src, video]),
  );
  if (timedBySrc.size === 0) return layers;

  return layers.map((layer) => {
    if (layer.type !== 'video') return layer;
    const video = timedBySrc.get(layer.content.src);
    if (!video) return layer;
    const clipStart = Math.max(0, video.clipStart ?? layer.content.clipStart);
    return {
      ...layer,
      content: {
        ...layer.content,
        clipStart,
        clipEnd: Math.max(
          clipStart,
          video.clipEnd ??
            (video.clipStart != null
              ? clipStart + Math.max(0, block.duration)
              : layer.content.clipEnd),
        ),
        ...(video.startAt != null ? { startAt: Math.max(0, video.startAt) } : {}),
      },
    };
  });
}

/** Promote unconsumed images, videos, and rich diagram fences through one layout path. */
function appendRichContentLayers(
  layers: Layer[],
  block: Block,
  theme: Theme,
  viewport: ViewportConfig,
): Layer[] {
  const timedLayers = applyEmbeddedVideoTiming(layers, block);
  const items = collectRichMediaItems(timedLayers, block);
  if (items.length === 0) return timedLayers;

  const layout = resolveSupplementalMediaLayout(
    timedLayers,
    block.template ? resolveTemplateName(block.template) : undefined,
    viewport,
    items.length,
    items.map((item) => item.aspectRatio),
  );
  const cells = gridCells(layout.mediaRect, items.length, viewport, layout.framed);
  const counters: Record<RichMediaItem['kind'], number> = {
    image: 0,
    video: 0,
    mermaid: 0,
    spatial: 0,
  };
  const mediaLayers = items.flatMap((item, index) => {
    counters[item.kind] += 1;
    return richMediaLayers(item, cells[index], block, theme, counters[item.kind]);
  });
  const frame: ShapeLayer | undefined = layout.framed
    ? {
        id: `${block.id}-rich-media-frame`,
        type: 'shape',
        position: layout.mediaRect,
        content: {
          shape: 'rect',
          fill: theme.colors.backgroundLight,
          stroke: withAlpha(theme.colors.text, 0.14),
          strokeWidth: 2,
          borderRadius: Math.max(12, Math.round(Math.min(viewport.width, viewport.height) * 0.018)),
        },
      }
    : undefined;
  return [...layout.layers, ...(frame ? [frame] : []), ...mediaLayers];
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
  const coercedOverrides = coerceTemplateParams(
    safeTemplateBlock.template,
    templateOverrides ?? {},
  ).input;
  const input =
    derivedInputs || templateData || templateOverrides
      ? ({
          ...derivedInputs,
          ...safeTemplateBlock,
          ...templateData,
          ...coercedOverrides,
        } as TemplateBlock)
      : safeTemplateBlock;

  const explicitQuote = Object.prototype.hasOwnProperty.call(coercedOverrides, 'quote')
    ? coercedOverrides.quote
    : Object.prototype.hasOwnProperty.call(templateData ?? {}, 'quote')
      ? templateData?.quote
      : Object.prototype.hasOwnProperty.call(safeTemplateBlock, 'quote')
        ? (safeTemplateBlock as unknown as Record<string, unknown>).quote
        : undefined;
  if (
    resolveTemplateName(safeTemplateBlock.template) === 'quote' &&
    derivedInputs &&
    !Object.prototype.hasOwnProperty.call(derivedInputs, 'title') &&
    !(typeof explicitQuote === 'string' && explicitQuote.trim())
  ) {
    const quoteInput = input as unknown as Record<string, unknown>;
    quoteInput.quote = derivedInputs.quote;
    if (
      !Object.prototype.hasOwnProperty.call(templateData ?? {}, 'title') &&
      !Object.prototype.hasOwnProperty.call(coercedOverrides, 'title')
    ) {
      // `safeTemplateBlock.title` is the structural markdown heading. When
      // derivation promoted it into `quote`, remove that structural copy unless
      // the author explicitly supplied a distinct template title.
      delete quoteInput.title;
    }
  }

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
