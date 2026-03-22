/**
 * Timing Allocator
 *
 * Distributes timing (startTime, duration) across transformed blocks.
 * When the source Doc has audio, blocks are fitted to the overall duration.
 * When no audio is present, uses reading-time estimation.
 */

import type { Block } from '../schemas/Doc.js';
import type { TemplateBlock } from '../schemas/BlockTemplates.js';
import { isTemplateBlock } from '../schemas/BlockTemplates.js';
import { estimateNarrationDuration } from '../timing/narrationTiming.js';

/** Minimum block duration in seconds. */
const MIN_BLOCK_DURATION = 3;
/** Maximum block duration in seconds. */
const MAX_BLOCK_DURATION = 20;
/** Default duration when no timing info is available. */
const DEFAULT_BLOCK_DURATION = 6;

/**
 * Allocate startTime and duration across a mixed array of blocks and
 * template blocks. Template blocks get timing assigned; existing blocks
 * retain their original timing when possible.
 *
 * @param blocks - The output from templateSelector (mixed Block | TemplateBlock).
 * @param totalDuration - The Doc's total duration (from audio or estimation).
 * @returns A new array of Blocks with consistent timing. Template blocks
 *          are returned as Blocks (with startTime/duration set, layers empty).
 */
export function allocateTiming(
  blocks: Array<Block | TemplateBlock>,
  totalDuration: number,
): Block[] {
  if (blocks.length === 0) return [];

  const effectiveDuration = totalDuration > 0 ? totalDuration : estimateDefaultDuration(blocks);

  // First pass: assign raw durations
  const durations = blocks.map((block) => {
    if (!isTemplateBlock(block) && block.duration > 0) {
      // Existing block with known duration — keep it
      return block.duration;
    }
    if (isTemplateBlock(block) && block.duration > 0) {
      return block.duration;
    }
    return DEFAULT_BLOCK_DURATION;
  });

  // Scale durations to fit the total
  const rawTotal = durations.reduce((sum, d) => sum + d, 0);
  if (rawTotal > 0 && effectiveDuration > 0) {
    const scale = effectiveDuration / rawTotal;
    for (let i = 0; i < durations.length; i++) {
      durations[i] = clampDuration(durations[i] * scale);
    }
  }

  // Second pass: assign startTimes and build output Blocks
  let currentTime = 0;
  const result: Block[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const duration = durations[i];

    if (isTemplateBlock(block)) {
      // Convert TemplateBlock to Block shell, preserving all template-specific
      // fields (stat, quote, description, etc.) so they survive through to
      // the player's template expansion step.
      const outputBlock = {
        ...block,
        startTime: currentTime,
        duration,
        title: getTemplateTitle(block),
      } as unknown as Block;
      result.push(outputBlock);
    } else {
      // Existing block — update timing
      result.push({
        ...block,
        startTime: currentTime,
        duration,
      });
    }

    currentTime += duration;
  }

  return result;
}

/** Clamp a duration to the min/max range. */
function clampDuration(d: number): number {
  return Math.max(MIN_BLOCK_DURATION, Math.min(MAX_BLOCK_DURATION, d));
}

/** Estimate a total duration from block contents when no audio is available. */
function estimateDefaultDuration(blocks: Array<Block | TemplateBlock>): number {
  let totalSeconds = 0;
  for (const block of blocks) {
    if (!isTemplateBlock(block) && block.duration > 0) {
      totalSeconds += block.duration;
    } else {
      totalSeconds += DEFAULT_BLOCK_DURATION;
    }
  }
  return Math.max(totalSeconds, blocks.length * MIN_BLOCK_DURATION);
}

/** Extract a display title from a template block if available. */
function getTemplateTitle(block: TemplateBlock): string | undefined {
  if ('title' in block && typeof block.title === 'string') {
    return block.title;
  }
  if ('stat' in block && typeof block.stat === 'string') {
    return block.stat;
  }
  if ('fact' in block && typeof block.fact === 'string') {
    return block.fact;
  }
  if ('quote' in block && typeof block.quote === 'string') {
    return block.quote.slice(0, 60);
  }
  return undefined;
}
