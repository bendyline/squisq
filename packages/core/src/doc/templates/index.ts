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

import type { Block, Layer } from '../../schemas/Doc.js';
import type {
  TemplateBlock,
  TemplateContext,
  TemplateRegistry,
  ThemeColors,
  DocBlock,
  PersistentLayerConfig,
} from '../../schemas/BlockTemplates.js';
import {
  DEFAULT_THEME as defaultTheme,
  isTemplateBlock,
  createTemplateContext,
} from '../../schemas/BlockTemplates.js';
import { expandPersistentLayers } from './persistentLayers.js';
import type { ViewportConfig } from '../../schemas/Viewport.js';
import { VIEWPORT_PRESETS } from '../../schemas/Viewport.js';

// Import all template functions
import { titleBlock } from './titleBlock.js';
import { sectionHeader } from './sectionHeader.js';
import { statHighlight } from './statHighlight.js';
import { quoteBlock } from './quoteBlock.js';
import { factCard } from './factCard.js';
import { twoColumn } from './twoColumn.js';
import { dateEvent } from './dateEvent.js';
import { imageWithCaption } from './imageWithCaption.js';
import { mapBlock } from './mapBlock.js';
import { coverBlock, expandCoverBlock } from './coverBlock.js';
import { fullBleedQuote } from './fullBleedQuote.js';
import { listBlock } from './listBlock.js';
import { photoGrid } from './photoGrid.js';
import { definitionCard } from './definitionCard.js';
import { comparisonBar } from './comparisonBar.js';
import { pullQuote } from './pullQuote.js';
import { videoWithCaption } from './videoWithCaption.js';
import { videoPullQuote } from './videoPullQuote.js';

/**
 * Registry mapping template names to their implementation functions.
 * Note: coverBlock is not in the registry as it's used directly for start blocks,
 * not as a regular template in the block sequence.
 */
export const templateRegistry: TemplateRegistry = {
  titleBlock,
  sectionHeader,
  statHighlight,
  quoteBlock,
  factCard,
  twoColumn,
  dateEvent,
  imageWithCaption,
  mapBlock,
  fullBleedQuote,
  listBlock,
  photoGrid,
  definitionCard,
  comparisonBar,
  pullQuote,
  videoWithCaption,
  videoPullQuote,
};

/**
 * Expand a template block into a full Block with layers.
 */
export function expandTemplateBlock(
  templateBlock: TemplateBlock,
  context: TemplateContext
): Block {
  const templateFn = templateRegistry[templateBlock.template];

  if (!templateFn) {
    console.warn(`Unknown template: ${templateBlock.template}`);
    // Return block with no layers
    return {
      id: templateBlock.id,
      startTime: 0,
      duration: templateBlock.duration,
      audioSegment: templateBlock.audioSegment,
      transition: templateBlock.transition,
      template: templateBlock.template, // Preserve for debugging
    };
  }

  // Generate layers from template with error handling
  let layers: Layer[];
  try {
    layers = (templateFn as any)(templateBlock, context);
    if (!Array.isArray(layers)) {
      console.error(`Template ${templateBlock.template} did not return an array, got:`, typeof layers);
      layers = [];
    }
  } catch (err) {
    console.error(`Error expanding template ${templateBlock.template}:`, err);
    layers = [];
  }

  return {
    id: templateBlock.id,
    startTime: 0, // Will be calculated later
    duration: templateBlock.duration,
    audioSegment: templateBlock.audioSegment,
    ...(layers.length > 0 ? { layers } : {}),
    transition: templateBlock.transition,
    template: templateBlock.template, // Preserve for debugging
  };
}

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
  /** Theme colors (defaults to DEFAULT_THEME) */
  theme?: ThemeColors;
  /** Viewport configuration (defaults to 16:9 landscape) */
  viewport?: ViewportConfig;
  /** Persistent layers for visual consistency across blocks */
  persistentLayers?: PersistentLayerConfig;
  /**
   * Audio segment timing information.
   * When provided, blocks are timed relative to their audio segment's start time,
   * ensuring proper synchronization with audio playback.
   */
  audioSegments?: AudioSegmentTiming[];
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
export function expandDocBlocks(
  blocks: DocBlock[],
  options: ExpandDocBlocksOptions | ThemeColors = {}
): Block[] {
  // Handle legacy signature: expandDocBlocks(blocks, theme)
  const opts: ExpandDocBlocksOptions =
    options && 'primary' in options
      ? { theme: options as ThemeColors }
      : (options as ExpandDocBlocksOptions);

  const theme = opts.theme ?? defaultTheme;
  const viewport = opts.viewport ?? VIEWPORT_PRESETS.landscape;
  const { persistentLayers, audioSegments } = opts;
  const totalBlocks = blocks.length;

  // Pre-expand persistent layers once
  const bottomLayers = expandPersistentLayers(persistentLayers?.bottomLayers);
  const topLayers = expandPersistentLayers(persistentLayers?.topLayers);

  // If no audio segments provided, use simple cumulative timing
  if (!audioSegments || audioSegments.length === 0) {
    let currentTime = 0;
    return blocks.map((block, index) => {
      const context = createTemplateContext(theme, index, totalBlocks, viewport);
      let expandedBlock = isTemplateBlock(block)
        ? expandTemplateBlock(block, context)
        : block as Block;

      // Inject persistent layers
      const templateBlock = block as TemplateBlock;
      const useBottom = templateBlock.useBottomLayer !== false;
      const useTop = templateBlock.useTopLayer !== false;
      if (bottomLayers.length > 0 || topLayers.length > 0) {
        expandedBlock.layers = [
          ...(useBottom ? bottomLayers : []),
          ...(expandedBlock.layers ?? []),
          ...(useTop ? topLayers : []),
        ];
      }

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
        const context = createTemplateContext(theme, originalIndex, totalBlocks, viewport);
        let expandedBlock = isTemplateBlock(block)
          ? expandTemplateBlock(block, context)
          : block as Block;

        const templateBlock = block as TemplateBlock;
        const useBottom = templateBlock.useBottomLayer !== false;
        const useTop = templateBlock.useTopLayer !== false;
        if (bottomLayers.length > 0 || topLayers.length > 0) {
          expandedBlock.layers = [
            ...(useBottom ? bottomLayers : []),
            ...(expandedBlock.layers ?? []),
            ...(useTop ? topLayers : []),
          ];
        }

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
    const scaleFactor = contentBlockDuration > 0 && remainingDuration > 0
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
      const context = createTemplateContext(theme, originalIndex, totalBlocks, viewport);
      let expandedBlock = isTemplateBlock(block)
        ? expandTemplateBlock(block, context)
        : block as Block;

      const templateBlock = block as TemplateBlock;
      const useBottom = templateBlock.useBottomLayer !== false;
      const useTop = templateBlock.useTopLayer !== false;
      if (bottomLayers.length > 0 || topLayers.length > 0) {
        expandedBlock.layers = [
          ...(useBottom ? bottomLayers : []),
          ...(expandedBlock.layers ?? []),
          ...(useTop ? topLayers : []),
        ];
      }

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
    const hasAnySourceTiming = expandedInfos.some(info => info.hasSourceTiming);

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
      .map(info => expandedBlocks[info.originalIndex])
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
        current.duration = next.startTime - current.startTime;
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
        console.log(`[expandDocBlocks] Eliminated block ${lastBlock.id} (${timeFromLastToEnd.toFixed(1)}s from section end) - extended ${prevBlock.id}`);
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
          console.log(`[expandDocBlocks] Eliminated short block ${block.id} (${block.duration.toFixed(1)}s < ${MIN_TRANSITION_GAP}s) - merged into ${prev.id}`);
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
          const originalDuration = block.duration;
          block.duration = partDuration;

          // Create additional blocks for remaining parts
          for (let p = 1; p < numParts; p++) {
            const splitBlock: Block = {
              id: `${block.id}-split-${p}`,
              startTime: block.startTime + (p * partDuration),
              duration: partDuration,
              audioSegment: block.audioSegment,
              layers: (block.layers ?? []).map(layer => ({
                ...layer,
                id: `${layer.id}-split-${p}`,
              })),
              transition: { type: 'dissolve', duration: 1.0 },
              template: block.template,
            };
            // Insert into expanded blocks array
            expandedBlocks.push(splitBlock);
          }

          console.log(`[expandDocBlocks] Split block ${block.id} (${originalDuration.toFixed(1)}s) into ${numParts} parts of ${partDuration.toFixed(1)}s each`);
        }
      }
    }
  }

  // Filter out zero-duration blocks (eliminated in earlier passes)
  return expandedBlocks.filter(block => block && block.duration > 0);
}

/**
 * Get list of available template names.
 */
export function getAvailableTemplates(): string[] {
  return Object.keys(templateRegistry);
}

/**
 * Check if a template exists.
 */
export function hasTemplate(name: string): boolean {
  return name in templateRegistry;
}

// Re-export types and utilities from schemas
export { isTemplateBlock, DEFAULT_THEME, createTemplateContext, scaledFontSize } from '../../schemas/BlockTemplates.js';
export type { TemplateBlock, DocBlock, ThemeColors, TemplateContext, PersistentLayerConfig, DocStylePreset } from '../../schemas/BlockTemplates.js';
// Re-export timing types (AudioSegmentTiming and ExpandDocBlocksOptions are already exported above)
export { VIEWPORT_PRESETS, getViewport, getViewportOrientation } from '../../schemas/Viewport.js';
export type { ViewportConfig, ViewportPreset, ViewportOrientation } from '../../schemas/Viewport.js';
export { getLayoutHints, getTwoColumnPositions } from '../../schemas/LayoutStrategy.js';
export type { LayoutHints } from '../../schemas/LayoutStrategy.js';
export { expandPersistentLayers, getDocStyleConfig } from './persistentLayers.js';

// Re-export individual templates for direct access
export { titleBlock } from './titleBlock.js';
export { sectionHeader } from './sectionHeader.js';
export { statHighlight } from './statHighlight.js';
export { quoteBlock } from './quoteBlock.js';
export { factCard } from './factCard.js';
export { twoColumn } from './twoColumn.js';
export { dateEvent } from './dateEvent.js';
export { imageWithCaption } from './imageWithCaption.js';
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

// Re-export accent image utilities
export { getAccentLayout, createAccentLayers, adjustY, DEFAULT_LAYOUT } from './accentImage.js';
export type { AccentLayout } from './accentImage.js';
