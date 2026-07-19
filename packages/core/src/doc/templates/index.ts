/**
 * Block Template Registry
 *
 * Central registry of all block templates. Provides functions to:
 * - Look up templates by name
 * - Expand template blocks into full Layer arrays
 * - Convert a template-based doc script into a renderable format
 *
 * Supports multiple viewport configurations for different aspect ratios.
 *
 * This is shared code used by both site and efb-app doc renderers.
 */

import type { Block } from '../../schemas/Doc.js';
import type {
  TemplateBlock,
  DocBlock,
  PersistentLayerConfig,
} from '../../schemas/BlockTemplates.js';
import type { Theme } from '../../schemas/Theme.js';
import type { CustomTemplateDefinition } from '../../schemas/CustomTemplates.js';
import { isTemplateBlock } from '../../schemas/BlockTemplates.js';
import { DEFAULT_THEME as defaultTheme } from '../../schemas/themeLibrary.js';
import { expandPersistentLayers } from './persistentLayers.js';
import { resolveBlockTransition } from '../../schemas/Transitions.js';
import { resolveTemplateName } from './templateNames.js';
import { cloneData } from '../../internal/immutable.js';
import type { ViewportConfig } from '../../schemas/Viewport.js';
import { VIEWPORT_PRESETS } from '../../schemas/Viewport.js';
import { buildRegistry, templateRegistry, type RuntimeTemplateRegistry } from './registry.js';
import {
  materializeBlockLayersWithRuntime,
  type ExpandedPersistentLayerSet,
  type LayerMaterializationDiagnostic,
  type LayerMaterializationFailureMode,
} from '../materializeBlockLayers.js';

export { TEMPLATE_METADATA } from './metadata.js';
export { TEMPLATE_AUTHORING_METADATA } from './authoringMetadata.js';
export type {
  TemplateAuthoringMetadata,
  TemplateAuthoringRole,
  TemplateBodyPolicy,
} from './authoringMetadata.js';
export type { TemplateMetadata } from './metadata.js';
export { BLOCK_MEDIA_LAYOUT_POLICIES, getBlockMediaLayoutPolicy } from './mediaLayoutPolicy.js';
export type {
  BlockMediaLayoutPolicy,
  BuiltInTemplateName,
  NativeMediaLayout,
  NoMediaLayout,
  SupplementalMediaLayoutVariant,
  SupplementalMediaShape,
  SupplementalMediaVariantMatrix,
  TemplateMediaOwnership,
  UnconsumedMediaBehavior,
} from './mediaLayoutPolicy.js';

/**
 * Registry mapping template ids (the strings that appear in
 * `{[name]}` markdown annotations) to their implementation functions.
 *
 * Some implementation functions keep historical "Block" suffixes
 * (`titleBlock`, `quoteBlock`, `mapBlock`, `listBlock`) for source
 * readability — the registry surfaces them under the cleaner short
 * ids (`title`, `quote`, `map`, `list`). Internal aliases keep legacy
 * document names readable without expanding the public API surface.
 *
 * Note: coverBlock is not in the registry as it's used directly for
 * start blocks, not as a regular template in the block sequence.
 */
export { buildRegistry, templateRegistry } from './registry.js';
export type { RuntimeTemplateRegistry } from './registry.js';

export { materializeBlockLayers } from '../materializeBlockLayers.js';
export type {
  BlockLayerMaterialization,
  LayerMaterializationDiagnostic,
  LayerMaterializationFailureMode,
  LayerMaterializationSource,
  MaterializeBlockLayersOptions,
} from '../materializeBlockLayers.js';

/**
 * Resolve a template id through the internal compatibility table. Returns
 * the input unchanged when no alias is registered.
 */
export { resolveTemplateName } from './templateNames.js';

/**
 * Container templates render their parent block by consuming the block's
 * child headings (via `context.children`) — `diagram` draws them as nodes,
 * `drawing` as shapes, `layout` as absolutely-positioned layers. Those
 * children are therefore NOT independently renderable slides/sections;
 * render paths use {@link isContainerTemplate} to skip descending into
 * them (see `flattenRenderableBlocks`).
 */
export { CONTAINER_TEMPLATES } from './templateNames.js';

/** True when `name` (or its alias) is a children-consuming container template. */
export { isContainerTemplate } from './templateNames.js';

/**
 * Templates fed by the first GFM table in their block body (dataTable and
 * the chart family). The parse pipeline promotes that table into
 * `templateData` unless the author supplied data explicitly.
 */
export { TABLE_FED_TEMPLATES } from './templateNames.js';

/**
 * Audio segment timing info for aligning blocks with audio.
 */
export interface AudioSegmentTiming {
  /** Start time of this segment in the overall timeline */
  startTime: number;
  /** Duration of this segment */
  duration: number;
}

/**
 * Options for expanding doc blocks.
 */
export interface ExpandDocBlocksOptions {
  /** Theme for template rendering (defaults to DEFAULT_THEME) */
  theme?: Theme;
  /** Viewport configuration (defaults to 16:9 landscape) */
  viewport?: ViewportConfig;
  /** Persistent layers for visual consistency across blocks */
  persistentLayers?: PersistentLayerConfig | false;
  /**
   * Audio segment timing information.
   * When provided, blocks are timed relative to their audio segment's start time,
   * ensuring proper synchronization with audio playback.
   */
  audioSegments?: AudioSegmentTiming[];
  /**
   * User-defined custom templates to merge onto the built-in registry
   * before expanding blocks. Typically passed straight from
   * `Doc.customTemplates`. Built-in names take precedence on collision.
   */
  customTemplates?: readonly CustomTemplateDefinition[];
  /** Failed templates render a visible fallback by default. */
  failureMode?: LayerMaterializationFailureMode;
  /** Receives structured template failures without hidden console output. */
  onDiagnostic?: (
    diagnostic: LayerMaterializationDiagnostic,
    block: DocBlock,
    blockIndex: number,
  ) => void;
}

/**
 * Expand all template blocks in a doc, calculating start times.
 * Injects persistent layers (bottom/top) based on per-block flags.
 *
 * When audioSegments is provided, blocks are timed relative to their audio segment's
 * start time, ensuring blocks appear when their audio is playing. Blocks within each
 * segment are distributed proportionally across the segment duration.
 *
 * @param blocks - Array of template or raw blocks
 * @param options - Expansion options including theme, viewport, and persistent layers
 */
/**
 * Materialize one block through the canonical layer contract, then add its
 * timeline envelope and resolved transition.
 */
function materializeScheduledBlock(
  sourceBlock: DocBlock,
  blockIndex: number,
  totalBlocks: number,
  theme: Theme,
  viewport: ViewportConfig,
  persistentLayers: PersistentLayerConfig | undefined,
  expandedPersistentLayers: ExpandedPersistentLayerSet | undefined,
  registry: RuntimeTemplateRegistry,
  failureMode: LayerMaterializationFailureMode,
  onDiagnostic?: ExpandDocBlocksOptions['onDiagnostic'],
): Block {
  const materialized = materializeBlockLayersWithRuntime(
    sourceBlock,
    {
      theme,
      viewport,
      persistentLayers: persistentLayers ?? false,
      blockIndex,
      totalBlocks,
      failureMode,
    },
    { registry, expandedPersistentLayers },
  );
  if (materialized.diagnostic) {
    onDiagnostic?.(materialized.diagnostic, sourceBlock, blockIndex);
  }

  const expandedBlock: Block = isTemplateBlock(sourceBlock)
    ? {
        id: sourceBlock.id,
        startTime: 0,
        duration: sourceBlock.duration,
        audioSegment: sourceBlock.audioSegment,
        ...(materialized.layers.length > 0 ? { layers: materialized.layers } : {}),
        transition: sourceBlock.transition,
        template: sourceBlock.template,
      }
    : {
        ...cloneData(sourceBlock as Block),
        ...(materialized.layers.length > 0 ? { layers: materialized.layers } : {}),
      };

  const transition = resolveBlockTransition(expandedBlock, theme, blockIndex);
  if (transition !== expandedBlock.transition) {
    expandedBlock.transition = transition;
  }
  return expandedBlock;
}

export function expandDocBlocks(blocks: DocBlock[], options: ExpandDocBlocksOptions = {}): Block[] {
  const opts: ExpandDocBlocksOptions = options;

  const theme = opts.theme ?? defaultTheme;
  const viewport = opts.viewport ?? VIEWPORT_PRESETS.landscape;
  const {
    persistentLayers,
    audioSegments,
    customTemplates,
    failureMode = 'fallback',
    onDiagnostic,
  } = opts;
  const totalBlocks = blocks.length;
  // Merge user-defined templates once, then share the immutable runtime view.
  const registry: RuntimeTemplateRegistry =
    customTemplates && customTemplates.length > 0
      ? buildRegistry(customTemplates)
      : (templateRegistry as unknown as RuntimeTemplateRegistry);

  // Callers that pass no config inherit the theme's atmosphere.
  const effectivePersistentLayers =
    persistentLayers === false ? undefined : (persistentLayers ?? theme.persistentLayers);
  const expandedPersistentLayers = effectivePersistentLayers
    ? {
        bottomLayers: expandPersistentLayers(effectivePersistentLayers.bottomLayers, theme),
        topLayers: expandPersistentLayers(effectivePersistentLayers.topLayers, theme),
      }
    : undefined;

  // If no audio segments provided, use simple cumulative timing
  if (!audioSegments || audioSegments.length === 0) {
    let currentTime = 0;
    return blocks.map((block, index) => {
      const expandedBlock = materializeScheduledBlock(
        block,
        index,
        totalBlocks,
        theme,
        viewport,
        effectivePersistentLayers,
        expandedPersistentLayers,
        registry,
        failureMode,
        onDiagnostic,
      );
      expandedBlock.startTime = currentTime;
      currentTime += expandedBlock.duration;
      return expandedBlock;
    });
  }

  // Group blocks by their audioSegment index
  const blocksBySegment = new Map<number, { block: DocBlock; originalIndex: number }[]>();
  blocks.forEach((block, index) => {
    const segmentIndex = (block as TemplateBlock).audioSegment ?? 0;
    if (!blocksBySegment.has(segmentIndex)) {
      blocksBySegment.set(segmentIndex, []);
    }
    blocksBySegment.get(segmentIndex)!.push({ block, originalIndex: index });
  });

  // Expand blocks, timing them relative to their audio segment
  const expandedBlocks: Block[] = new Array(blocks.length);

  for (const [segmentIndex, segmentBlocks] of blocksBySegment) {
    const audioSegment = audioSegments[segmentIndex];
    if (!audioSegment) {
      // No audio segment info - use simple sequential timing within the segment
      let offsetTime = 0;
      for (const { block, originalIndex } of segmentBlocks) {
        const expandedBlock = materializeScheduledBlock(
          block,
          originalIndex,
          totalBlocks,
          theme,
          viewport,
          effectivePersistentLayers,
          expandedPersistentLayers,
          registry,
          failureMode,
          onDiagnostic,
        );

        expandedBlock.startTime = offsetTime;
        offsetTime += expandedBlock.duration;
        expandedBlocks[originalIndex] = expandedBlock;
      }
      continue;
    }

    // Section headers (sectionHeader template) get their original duration since
    // the title is spoken at the start of the segment. Other blocks are scaled
    // to fill the remaining time.
    const sectionHeaderBlocks: typeof segmentBlocks = [];
    const contentBlocks: typeof segmentBlocks = [];

    for (const item of segmentBlocks) {
      const templateBlock = item.block as TemplateBlock;
      if (templateBlock.template === 'sectionHeader') {
        sectionHeaderBlocks.push(item);
      } else {
        contentBlocks.push(item);
      }
    }

    // Calculate fixed duration (section headers) and scalable duration (content)
    const fixedDuration = sectionHeaderBlocks.reduce((sum, { block }) => {
      return sum + ((block as TemplateBlock).duration ?? 0);
    }, 0);

    const contentBlockDuration = contentBlocks.reduce((sum, { block }) => {
      return sum + ((block as TemplateBlock).duration ?? 0);
    }, 0);

    // Remaining time after section header(s) for content blocks
    const remainingDuration = audioSegment.duration - fixedDuration;

    // Scale factor only applies to content blocks
    const scaleFactor =
      contentBlockDuration > 0 && remainingDuration > 0
        ? remainingDuration / contentBlockDuration
        : 1;

    // First pass: expand all blocks and track which have source timing
    interface ExpandedSlideInfo {
      block: Block;
      originalIndex: number;
      templateBlock: TemplateBlock;
      hasSourceTiming: boolean;
    }
    const expandedInfos: ExpandedSlideInfo[] = [];

    for (const { block, originalIndex } of segmentBlocks) {
      const expandedBlock = materializeScheduledBlock(
        block,
        originalIndex,
        totalBlocks,
        theme,
        viewport,
        effectivePersistentLayers,
        expandedPersistentLayers,
        registry,
        failureMode,
        onDiagnostic,
      );

      const templateBlock = block as TemplateBlock;
      expandedInfos.push({
        block: expandedBlock,
        originalIndex,
        templateBlock,
        hasSourceTiming: typeof templateBlock.sourceStartTime === 'number',
      });
    }

    // Sort blocks within this segment.
    // When ANY block has source timing (from audio analysis), section headers
    // are placed first since they are intro cards for the segment. When there
    // is no source timing (e.g., preview/synthetic mode), keep original
    // document order so the slideshow matches what the author wrote.
    const hasAnySourceTiming = expandedInfos.some((info) => info.hasSourceTiming);

    expandedInfos.sort((a, b) => {
      if (hasAnySourceTiming) {
        const aIsHeader = a.templateBlock.template === 'sectionHeader';
        const bIsHeader = b.templateBlock.template === 'sectionHeader';

        // Section headers come first when we have audio-based timing
        if (aIsHeader && !bIsHeader) return -1;
        if (!aIsHeader && bIsHeader) return 1;

        // Both have source timing - sort by time
        if (a.hasSourceTiming && b.hasSourceTiming) {
          return a.templateBlock.sourceStartTime! - b.templateBlock.sourceStartTime!;
        }

        // One has timing, one doesn't - timing comes first
        if (a.hasSourceTiming && !b.hasSourceTiming) return -1;
        if (!a.hasSourceTiming && b.hasSourceTiming) return 1;
      }

      // Keep original document order
      return a.originalIndex - b.originalIndex;
    });

    // Second pass: assign start times
    // Slides with sourceStartTime use that; others fill gaps
    let offsetWithinSegment = 0;
    for (let i = 0; i < expandedInfos.length; i++) {
      const info = expandedInfos[i];
      const { block: expandedBlock, templateBlock } = info;

      // Use source timing if available, otherwise use sequential offset
      if (info.hasSourceTiming) {
        // Use the source timing - this is when the content is spoken
        const sourceStart = templateBlock.sourceStartTime!;
        expandedBlock.startTime = audioSegment.startTime + sourceStart;
        // Use source duration if available, otherwise use block duration
        if (typeof templateBlock.sourceDuration === 'number') {
          expandedBlock.duration = Math.max(5, templateBlock.sourceDuration);
        }
        // Update offset for next block
        offsetWithinSegment = sourceStart + expandedBlock.duration;
      } else if (templateBlock.template === 'sectionHeader') {
        // Section headers start at the beginning of the segment
        expandedBlock.startTime = audioSegment.startTime + offsetWithinSegment;
        offsetWithinSegment += expandedBlock.duration;
      } else {
        // No source timing - place after previous block
        expandedBlock.startTime = audioSegment.startTime + offsetWithinSegment;
        // Scale content block duration to fit
        const scaledDuration = expandedBlock.duration * scaleFactor;
        expandedBlock.duration = scaledDuration;
        offsetWithinSegment += scaledDuration;
      }

      expandedBlocks[info.originalIndex] = expandedBlock;
    }

    // Third pass: fix overlaps and gaps by adjusting durations
    // Sort by startTime for overlap detection
    const segmentExpandedBlocks = expandedInfos
      .map((info) => expandedBlocks[info.originalIndex])
      .sort((a, b) => a.startTime - b.startTime);

    for (let i = 0; i < segmentExpandedBlocks.length - 1; i++) {
      const current = segmentExpandedBlocks[i];
      const next = segmentExpandedBlocks[i + 1];
      const currentEnd = current.startTime + current.duration;

      if (currentEnd > next.startTime) {
        // Overlap - shorten current block to end when next begins
        current.duration = next.startTime - current.startTime;
      } else if (currentEnd < next.startTime - 0.5) {
        // Gap > 0.5s - extend current block to fill (visual continuity)
        // Same formula as overlap: snap to next block start
        current.duration = Math.max(0.1, next.startTime - current.startTime);
      }
    }

    // Minimum gap between any two transitions (including section boundaries).
    // No block should be visible for less than this before a transition occurs.
    const MIN_TRANSITION_GAP = 5;
    const segmentEnd = audioSegment.startTime + audioSegment.duration;

    // Fourth pass: enforce minimum transition gap at section boundary.
    // Eliminate blocks from the end that would start within MIN_TRANSITION_GAP
    // of the section end (creating a jarring transition right before the next
    // section header). Loop to handle cascading eliminations.
    while (segmentExpandedBlocks.length > 1) {
      const lastBlock = segmentExpandedBlocks[segmentExpandedBlocks.length - 1];
      const timeFromLastToEnd = segmentEnd - lastBlock.startTime;

      if (timeFromLastToEnd < MIN_TRANSITION_GAP && lastBlock.template !== 'sectionHeader') {
        const prevBlock = segmentExpandedBlocks[segmentExpandedBlocks.length - 2];
        prevBlock.duration = segmentEnd - prevBlock.startTime;
        lastBlock.duration = 0;
        lastBlock.startTime = segmentEnd;
        segmentExpandedBlocks.pop();
      } else {
        // Extend last block to fill to segment end
        if (lastBlock.startTime + lastBlock.duration < segmentEnd) {
          lastBlock.duration = segmentEnd - lastBlock.startTime;
        }
        break;
      }
    }

    // Handle single-block segment
    if (segmentExpandedBlocks.length === 1) {
      const onlyBlock = segmentExpandedBlocks[0];
      if (onlyBlock.startTime + onlyBlock.duration < segmentEnd) {
        onlyBlock.duration = segmentEnd - onlyBlock.startTime;
      }
    }

    // Fifth pass: eliminate any remaining blocks shorter than MIN_TRANSITION_GAP.
    // Walk backwards and merge short blocks into their predecessor.
    // Skip index 0 (first block, typically section header) to preserve segment start.
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = segmentExpandedBlocks.length - 1; i >= 1; i--) {
        const block = segmentExpandedBlocks[i];
        if (block.duration > 0 && block.duration < MIN_TRANSITION_GAP) {
          const prev = segmentExpandedBlocks[i - 1];
          const blockEnd = block.startTime + block.duration;
          prev.duration = blockEnd - prev.startTime;
          block.duration = 0;
          block.startTime = segmentEnd;
          segmentExpandedBlocks.splice(i, 1);
          changed = true;
          break; // Restart loop after modification
        }
      }
    }

    // Sixth pass: split blocks that are too long (>20s)
    // This ensures no single block lingers for too long
    const MAX_BLOCK_DURATION = 20;

    for (let i = 0; i < segmentExpandedBlocks.length; i++) {
      const block = segmentExpandedBlocks[i];

      if (block.duration > MAX_BLOCK_DURATION) {
        // Calculate how many parts we need
        const numParts = Math.ceil(block.duration / MAX_BLOCK_DURATION);
        const partDuration = block.duration / numParts;

        // Only split if each part would meet minimum transition gap
        if (partDuration >= MIN_TRANSITION_GAP) {
          // Shorten original block to first part
          block.duration = partDuration;

          // Create additional blocks for remaining parts
          for (let p = 1; p < numParts; p++) {
            const splitBlock: Block = {
              id: `${block.id}-split-${p}`,
              startTime: block.startTime + p * partDuration,
              duration: partDuration,
              audioSegment: block.audioSegment,
              layers: (block.layers ?? []).map((layer) => ({
                ...cloneData(layer),
                id: `${layer.id}-split-${p}`,
              })),
              transition: { type: 'dissolve', duration: 1.0 },
              template: block.template,
            };
            // Insert into expanded blocks array
            expandedBlocks.push(splitBlock);
          }
        }
      }
    }
  }

  // Filter out zero-duration blocks (eliminated in earlier passes)
  return expandedBlocks.filter((block) => block && block.duration > 0);
}

/**
 * Get list of available template names.
 */
export function getAvailableTemplates(): string[] {
  return Object.keys(templateRegistry);
}

/**
 * Check if a template exists. Accepts both the canonical short id
 * (`title`, `quote`, `map`, `list`) and legacy aliases
 * (`titleBlock`, `quoteBlock`, `mapBlock`, `listBlock`).
 */
export function hasTemplate(name: string): boolean {
  return resolveTemplateName(name) in templateRegistry;
}

// Re-export types and utilities from schemas
export {
  isTemplateBlock,
  createTemplateContext,
  scaledFontSize,
} from '../../schemas/BlockTemplates.js';
export type {
  TemplateBlock,
  DocBlock,
  TemplateContext,
  PersistentLayerConfig,
} from '../../schemas/BlockTemplates.js';
export {
  DEFAULT_THEME,
  resolveTheme,
  getAvailableThemes,
  getThemeSummaries,
} from '../../schemas/themeLibrary.js';
export type {
  Theme,
  ThemeColorPalette,
  ThemeColorScheme,
  ThemeTypography,
  ThemeStyle,
  RenderStyle,
} from '../../schemas/Theme.js';
// Re-export timing types (AudioSegmentTiming and ExpandDocBlocksOptions are already exported above)
export { VIEWPORT_PRESETS, getViewport, getViewportOrientation } from '../../schemas/Viewport.js';
export type {
  ViewportConfig,
  ViewportPreset,
  ViewportOrientation,
} from '../../schemas/Viewport.js';
export { getLayoutHints, getTwoColumnPositions } from '../../schemas/LayoutStrategy.js';
export type { LayoutHints } from '../../schemas/LayoutStrategy.js';
export {
  expandPersistentLayers,
  getPersistentLayersFromTheme,
  resolvePersistentLayers,
  wrapWithPersistentLayers,
} from './persistentLayers.js';

// Re-export individual templates for direct access
export { titleBlock } from './titleBlock.js';
export { sectionHeader } from './sectionHeader.js';
export { contentBlock } from './contentBlock.js';
export { statHighlight } from './statHighlight.js';
export { quoteBlock } from './quoteBlock.js';
export { factCard } from './factCard.js';
export { twoColumn } from './twoColumn.js';
export { dateEvent } from './dateEvent.js';
export { imageWithCaption } from './imageWithCaption.js';
export { leftFeature, rightFeature } from './featureBlock.js';
export { mapBlock } from './mapBlock.js';
export { coverBlock, expandCoverBlock } from './coverBlock.js';
export type { CoverBlockInput } from './coverBlock.js';
export { fullBleedQuote } from './fullBleedQuote.js';
export { listBlock } from './listBlock.js';
export { photoGrid } from './photoGrid.js';
export { definitionCard } from './definitionCard.js';
export { comparisonBar } from './comparisonBar.js';
export { pullQuote } from './pullQuote.js';
export { videoWithCaption } from './videoWithCaption.js';
export { videoPullQuote } from './videoPullQuote.js';
export { dataTable } from './dataTable.js';
export { diagramBlock } from './diagramBlock.js';
export { treeBlock } from './treeBlock.js';
export { timelineBlock } from './timelineBlock.js';
export { computeDiagramLayout } from './diagramLayout.js';
export type {
  DiagramLayout,
  DiagramNodePosition,
  DiagramEdge,
  DiagramLayoutOptions,
} from './diagramLayout.js';
export { drawingBlock } from './drawingBlock.js';
export {
  computeDrawingLayout,
  normalizeShapeKind,
  isShapeName,
  SHAPE_NAMES,
} from './drawingLayout.js';
export type {
  DrawingLayout,
  DrawingShape,
  DrawingShapeKind,
  DrawingConnector,
  DrawingLayoutOptions,
} from './drawingLayout.js';
export { layoutBlock } from './layoutBlock.js';
export { computeLayoutLayers } from './layoutLayout.js';
export type { LayoutLayersResult, LayoutLayerDefaults } from './layoutLayout.js';

// Re-export accent image utilities
export { getAccentLayout, createAccentLayers, adjustY, DEFAULT_LAYOUT } from './accentImage.js';
export type { AccentLayout } from './accentImage.js';
