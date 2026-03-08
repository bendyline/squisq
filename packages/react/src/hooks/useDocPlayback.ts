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

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { Doc, Block } from '@bendyline/squisq/schemas';
import { getBlockAtTime } from '@bendyline/squisq/schemas';
import {
  expandDocBlocks,
  isTemplateBlock,
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

export function useDocPlayback(
  script: Doc | null,
  currentTime: number,
  viewport: ViewportConfig = VIEWPORT_PRESETS.landscape,
  renderMode: boolean = false,
): PlaybackState & PlaybackActions {
  const [transitionState, setTransitionState] = useState<{
    entering: boolean;
    exiting: boolean;
    previousBlock: Block | null;
  }>({
    entering: false,
    exiting: false,
    previousBlock: null,
  });

  // Expand any template blocks into full blocks
  const blocks = useMemo(() => {
    if (!script?.blocks) {
      console.log('[useDocPlayback] No blocks in script');
      return [];
    }

    console.log('[useDocPlayback] Processing blocks:', script.blocks.length);
    console.log('[useDocPlayback] First block:', script.blocks[0]);

    // Check if any blocks are templates
    const hasTemplates = script.blocks.some(isTemplateBlock);
    console.log('[useDocPlayback] Has templates:', hasTemplates);

    if (hasTemplates) {
      // Extract audio segment timing for proper block synchronization
      const audioSegments = script.audio?.segments?.map((seg) => ({
        startTime: seg.startTime,
        duration: seg.duration,
      }));
      console.log('[useDocPlayback] Audio segments for timing:', audioSegments);
      console.log('[useDocPlayback] Using viewport:', viewport.name);

      // Expand template blocks with audio segment timing, viewport, and persistent layers
      const expanded = expandDocBlocks(script.blocks as any, {
        audioSegments,
        viewport,
        persistentLayers: script.persistentLayers,
      });
      console.log('[useDocPlayback] Expanded blocks:', expanded.length, expanded);
      return expanded;
    }

    // All raw blocks, use as-is
    return script.blocks;
  }, [script?.blocks, script?.audio?.segments, script?.persistentLayers, viewport]);

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

  // Track block transitions.
  // In render mode, transitions are computed from blockTime so they stay
  // synchronized with the seekTo timeline. In normal mode, setTimeout drives
  // transitions at the browser's real-time clock speed.
  const _prevBlockRef = useMemo(() => currentBlock, [currentBlockIndex]);

  useEffect(() => {
    if (!currentBlock || renderMode) return;

    // When block changes, trigger transition (real-time mode only)
    if (transitionState.previousBlock?.id !== currentBlock.id) {
      const transition = currentBlock.transition;
      const transitionDuration = transition?.duration || 0;

      if (transitionDuration > 0) {
        // Start transition
        setTransitionState({
          entering: true,
          exiting: true,
          previousBlock: transitionState.previousBlock,
        });

        // End transition after duration
        const timer = setTimeout(() => {
          setTransitionState({
            entering: false,
            exiting: false,
            previousBlock: currentBlock,
          });
        }, transitionDuration * 1000);

        return () => clearTimeout(timer);
      } else {
        // Instant cut
        setTransitionState({
          entering: false,
          exiting: false,
          previousBlock: currentBlock,
        });
      }
    }
  }, [currentBlock?.id, renderMode]);

  // Render mode: track previous block via ref and compute transition from time
  const renderPrevBlockRef = useRef<Block | null>(null);

  useEffect(() => {
    if (!renderMode || !currentBlock) return;

    if (transitionState.previousBlock?.id !== currentBlock.id) {
      // Block changed — remember the old block for crossfade
      const oldPrev = transitionState.previousBlock;
      renderPrevBlockRef.current = oldPrev;
      // Store current block as the "last seen" for next transition
      setTransitionState((prev) => ({
        ...prev,
        previousBlock: currentBlock,
      }));
    }
  }, [currentBlock?.id, renderMode]);

  // In render mode, derive entering/exiting from blockTime
  const renderTransitionDuration = currentBlock?.transition?.duration || 0;
  const renderIsEntering =
    renderMode && renderTransitionDuration > 0 && blockTime < renderTransitionDuration;
  const renderIsExiting = renderIsEntering && renderPrevBlockRef.current !== null;

  // Manual navigation
  const goToBlock = useCallback(
    (index: number) => {
      if (!script || index < 0 || index >= blocks.length) return;
      // This would need to be coordinated with seekTo from audio sync
      // For now, just return the target block's start time
      const targetBlock = blocks[index];
      if (targetBlock) {
        // Caller should use this time with audio seekTo
        return targetBlock.startTime;
      }
    },
    [script, blocks],
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
    previousBlock: renderMode
      ? renderIsExiting
        ? renderPrevBlockRef.current
        : null
      : transitionState.exiting
        ? transitionState.previousBlock
        : null,
    isEntering: renderMode ? renderIsEntering : transitionState.entering,
    isExiting: renderMode ? renderIsExiting : transitionState.exiting,
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
