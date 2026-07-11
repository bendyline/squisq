/**
 * useDocPlayback Hook
 *
 * Manages the playback state for a visual doc, including which block
 * is currently active, transition states, and synchronization with audio.
 *
 * This hook provides:
 * - Current block determination based on time
 * - Transition tracking (entering/exiting blocks)
 * - Manual navigation (next/prev block)
 * - Time-based seeking
 * - Automatic expansion of template blocks
 */

import { useMemo, useCallback, useRef } from 'react';
import type { Doc, Block, DocBlock } from '@bendyline/squisq/schemas';
import type { Theme } from '@bendyline/squisq/schemas';
import {
  DEFAULT_THEME,
  getBlockAtTime,
  resolveBlockTransition,
  resolveTransitionDuration,
} from '@bendyline/squisq/schemas';
import {
  expandDocBlocks,
  flattenRenderableBlocks,
  isTemplateBlock,
  resolvePersistentLayers,
  VIEWPORT_PRESETS,
  type ViewportConfig,
} from '@bendyline/squisq/doc';

interface PlaybackState {
  /** Currently visible block */
  currentBlock: Block | null;
  /** Index of current block */
  currentBlockIndex: number;
  /** Previous block (for transitions) */
  previousBlock: Block | null;
  /** Whether current block is entering */
  isEntering: boolean;
  /** Whether previous block is exiting */
  isExiting: boolean;
  /** Time relative to current block start */
  blockTime: number;
  /** Progress through current block (0-1) */
  blockProgress: number;
  /** Overall progress through doc (0-1) */
  docProgress: number;
  /** Expanded blocks (templates converted to full blocks with layers) */
  blocks: Block[];
}

interface PlaybackActions {
  /** Go to next block */
  nextBlock: () => void;
  /** Go to previous block */
  prevBlock: () => void;
  /** Go to specific block by index */
  goToBlock: (index: number) => void;
}

export interface UseDocPlaybackOptions {
  /** Target viewport used to materialize template blocks. */
  viewport?: ViewportConfig;
  /** Active theme used for materialization and transition defaults. */
  theme?: Theme;
  /** Host seek callback used by block navigation actions. */
  onSeek?: (time: number) => void;
}

export function useDocPlayback(
  script: Doc | null,
  currentTime: number,
  options: UseDocPlaybackOptions = {},
): PlaybackState & PlaybackActions {
  const { viewport = VIEWPORT_PRESETS.landscape, theme, onSeek } = options;
  // Expand any template blocks into full blocks
  const blocks = useMemo(() => {
    if (!script?.blocks) {
      return [];
    }

    // Flatten nested block hierarchy (markdown-derived docs have children).
    // `flattenRenderableBlocks` skips the children of container templates
    // (`diagram`, `drawing`) — those are consumed by the parent's render as
    // nodes/shapes, so they must not also appear as their own slides.
    const hasChildren = script.blocks.some((b) => b.children && b.children.length > 0);
    const flatBlocks = hasChildren ? flattenRenderableBlocks(script.blocks) : script.blocks;

    // Check if any blocks are templates
    const hasTemplates = flatBlocks.some(isTemplateBlock);

    // Doc persistent layers win wholesale; docs without any inherit the
    // theme's (see resolvePersistentLayers). Passed as a narrow object so
    // the memo deps stay field-precise.
    const resolvedTheme = theme ?? DEFAULT_THEME;
    const persistentLayers = resolvePersistentLayers(
      { persistentLayers: script.persistentLayers },
      resolvedTheme,
    );

    if (hasTemplates) {
      // Extract audio segment timing for proper block synchronization
      const audioSegments = script.audio?.segments?.map((seg) => ({
        startTime: seg.startTime,
        duration: seg.duration,
      }));

      // Expand template blocks with audio segment timing, viewport, and persistent layers
      const expanded = expandDocBlocks(flatBlocks as DocBlock[], {
        audioSegments,
        viewport,
        persistentLayers,
        theme,
        // Custom (user-defined) templates inlined into the doc's
        // frontmatter — see CustomTemplates.ts. Merged onto the
        // built-in registry so blocks annotated with `{[myhero]}`
        // resolve through the user's design.
        customTemplates: script.customTemplates,
      });
      return expanded;
    }

    // All raw blocks — used as-is except for the theme's default transition
    // fallback (copies, never mutations: these blocks are caller-owned).
    return flatBlocks.map((block, index) => {
      const transition = resolveBlockTransition(block, resolvedTheme, index);
      return transition !== block.transition ? { ...block, transition } : block;
    });
  }, [
    script?.blocks,
    script?.audio?.segments,
    script?.persistentLayers,
    script?.customTemplates,
    viewport,
    theme,
  ]);

  // Find current block based on time
  const currentBlock = useMemo(() => getBlockAtTime(blocks, currentTime), [blocks, currentTime]);

  const currentBlockIndex = useMemo(
    () => (currentBlock ? blocks.indexOf(currentBlock) : -1),
    [blocks, currentBlock],
  );

  // Calculate block-relative time
  const blockTime = useMemo(() => {
    if (!currentBlock) return 0;
    return Math.max(0, currentTime - currentBlock.startTime);
  }, [currentBlock, currentTime]);

  // Calculate progress values
  const blockProgress = useMemo(() => {
    if (!currentBlock || currentBlock.duration === 0) return 0;
    return Math.min(1, blockTime / currentBlock.duration);
  }, [currentBlock, blockTime]);

  const docProgress = useMemo(() => {
    if (!script || script.duration === 0) return 0;
    return Math.min(1, currentTime / script.duration);
  }, [script, currentTime]);

  // ─── Transition tracking (synchronous — no effect lag) ──────────────
  // `isEntering` is simply "we are within the block's entrance window"
  // (blockTime < the transition's duration). Deriving it during render —
  // rather than flipping it in an effect a frame AFTER the block changes —
  // means a newly-active block renders WITH its entrance state on its very
  // first frame. Otherwise the block paints once fully settled and then, a
  // frame later, snaps back to the start of its entrance animation: the brief
  // "flash then re-animate" seen between blocks. This runs identically for
  // real-time playback and frame-seeked render (export) mode.
  //
  // The block we transitioned FROM (for the crossfade) is tracked with refs
  // updated during render — the standard "previous value" pattern — so the
  // outgoing block is known on the SAME frame the new block becomes active
  // (an effect would lag a frame and drop the crossfade's first frames).
  const outgoingBlockRef = useRef<Block | null>(null);
  const activeBlockIdRef = useRef<string | null>(null);
  const lastRenderedBlockRef = useRef<Block | null>(null);
  if (currentBlock && currentBlock.id !== activeBlockIdRef.current) {
    outgoingBlockRef.current = lastRenderedBlockRef.current;
    activeBlockIdRef.current = currentBlock.id;
  }
  lastRenderedBlockRef.current = currentBlock;

  const transitionDuration = currentBlock?.transition
    ? resolveTransitionDuration(currentBlock.transition)
    : 0;
  const isEntering = !!currentBlock && transitionDuration > 0 && blockTime < transitionDuration;
  const outgoingBlock = outgoingBlockRef.current;
  // Only crossfade a genuinely different outgoing block (guards restarts/seeks
  // where the "previous" resolves to the same block).
  const isExiting = isEntering && outgoingBlock != null && outgoingBlock.id !== currentBlock?.id;
  const previousBlock = isExiting ? outgoingBlock : null;

  // Manual navigation
  const goToBlock = useCallback(
    (index: number) => {
      if (!script || index < 0 || index >= blocks.length) return;
      const targetBlock = blocks[index];
      if (targetBlock) {
        onSeek?.(targetBlock.startTime);
      }
    },
    [script, blocks, onSeek],
  );

  const nextBlock = useCallback(() => {
    if (currentBlockIndex < blocks.length - 1) {
      return goToBlock(currentBlockIndex + 1);
    }
  }, [currentBlockIndex, blocks.length, goToBlock]);

  const prevBlock = useCallback(() => {
    if (currentBlockIndex > 0) {
      return goToBlock(currentBlockIndex - 1);
    }
  }, [currentBlockIndex, goToBlock]);

  return {
    currentBlock,
    currentBlockIndex,
    previousBlock,
    isEntering,
    isExiting,
    blockTime,
    blockProgress,
    docProgress,
    nextBlock,
    prevBlock,
    goToBlock,
    /** Expanded blocks (templates converted to full blocks with layers) */
    blocks,
  };
}

export default useDocPlayback;
