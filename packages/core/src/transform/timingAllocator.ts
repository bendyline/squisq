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

  // Template blocks carrying a numeric `sourceStartTime` are ANCHORED to
  // the doc timeline — when the source doc is narration-timed
  // (`applyNarrationTiming`), those anchors are where the words are
  // actually spoken, and rescaling would tear the slides away from the
  // voice. Anchored blocks keep their positions; floating blocks
  // (intro/outro bookends, section headers, interleaved images) fill the
  // gaps between anchors. With no anchors at all, behavior is the
  // historical rescale-to-fit.
  const hasAnchors = blocks.some(
    (b) => isTemplateBlock(b) && typeof b.sourceStartTime === 'number',
  );
  return hasAnchors
    ? allocateAnchored(blocks, totalDuration)
    : allocateRescaled(blocks, totalDuration);
}

/** Historical behavior: scale every duration to fill the total, clamp 3–20 s. */
function allocateRescaled(blocks: Array<Block | TemplateBlock>, totalDuration: number): Block[] {
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
    result.push(toOutputBlock(blocks[i], currentTime, durations[i]));
    currentTime += durations[i];
  }
  return result;
}

/** Minimum duration for a floating block squeezed between anchors. */
const MIN_FLOATING_DURATION = 1;

/**
 * Anchor-aware allocation: anchored entries (template blocks with a
 * numeric `sourceStartTime`, and untransformed source Blocks with their
 * own real timing) are PLACED at their timeline positions; runs of
 * floating blocks (bookends, headers, images) distribute across the gap
 * before the next anchor. Durations then derive from consecutive starts
 * so the timeline stays CONTIGUOUS — a slide summarizing unpromoted
 * source content simply holds until the next slide begins, which is
 * what keeps every narration second covered by some block.
 */
function allocateAnchored(blocks: Array<Block | TemplateBlock>, totalDuration: number): Block[] {
  interface Entry {
    block: Block | TemplateBlock;
    anchorStart: number | null;
    rawDuration: number;
  }
  const entries: Entry[] = blocks.map((block) => {
    if (isTemplateBlock(block)) {
      return {
        block,
        anchorStart: typeof block.sourceStartTime === 'number' ? block.sourceStartTime : null,
        rawDuration: block.duration > 0 ? block.duration : DEFAULT_BLOCK_DURATION,
      };
    }
    // Untransformed source blocks carry real (possibly narration) timing.
    return {
      block,
      anchorStart: block.startTime,
      rawDuration: block.duration > 0 ? block.duration : DEFAULT_BLOCK_DURATION,
    };
  });

  // Pass 1: starts. Anchors pin their positions (the cursor then jumps
  // past the anchor's authored span, so following floats land AFTER it).
  // Float runs place differently by position: LEADING floats (before any
  // anchor — intro bookends) fill the opening gap from t=0; MID floats
  // (section headers, images) end-align just before the next anchor —
  // a header belongs to the section it introduces; TRAILING floats
  // (outro) run sequentially after the last anchor's span.
  const starts = new Array<number>(entries.length);
  let cursor = 0;
  let seenAnchor = false;
  let i = 0;
  while (i < entries.length) {
    const entry = entries[i];
    if (entry.anchorStart !== null) {
      const start = Math.max(cursor, entry.anchorStart);
      starts[i] = start;
      const hint = isTemplateBlock(entry.block)
        ? (entry.block.sourceDuration ?? entry.rawDuration)
        : entry.rawDuration;
      cursor = start + Math.max(MIN_FLOATING_DURATION, hint);
      seenAnchor = true;
      i++;
      continue;
    }
    const runStart = i;
    while (i < entries.length && entries[i].anchorStart === null) i++;
    const run = entries.slice(runStart, i);
    const rawSum = run.reduce((sum, e) => sum + e.rawDuration, 0);
    const nextAnchorStart =
      i < entries.length ? Math.max(entries[i].anchorStart ?? cursor, cursor) : null;

    if (nextAnchorStart === null) {
      // Trailing floats: natural sizes after the last anchor's span.
      let acc = cursor;
      for (let k = 0; k < run.length; k++) {
        starts[runStart + k] = acc;
        acc += run[k].rawDuration;
      }
      cursor = acc;
    } else if (!seenAnchor) {
      // Leading floats: fill [cursor, nextAnchorStart) proportionally.
      const gap = nextAnchorStart - cursor;
      let acc = cursor;
      for (let k = 0; k < run.length; k++) {
        starts[runStart + k] = acc;
        acc += rawSum > 0 ? (run[k].rawDuration / rawSum) * gap : gap / run.length;
      }
      cursor = nextAnchorStart;
    } else {
      // Mid floats: end-aligned at natural size, capped by the gap.
      const gap = Math.max(0, nextAnchorStart - cursor);
      const scale = rawSum > 0 ? Math.min(1, gap / rawSum) : 0;
      let acc = Math.max(cursor, nextAnchorStart - rawSum * scale);
      for (let k = 0; k < run.length; k++) {
        starts[runStart + k] = acc;
        acc += run[k].rawDuration * scale;
      }
      cursor = nextAnchorStart;
    }
  }

  // Pass 2: strictly increasing starts, then contiguous durations.
  for (let k = 0; k < starts.length; k++) {
    const floor = k > 0 ? starts[k - 1] + MIN_FLOATING_DURATION : 0;
    if (starts[k] < floor) starts[k] = floor;
  }
  const result: Block[] = [];
  for (let k = 0; k < entries.length; k++) {
    const entry = entries[k];
    let duration: number;
    if (k + 1 < entries.length) {
      duration = Math.max(MIN_FLOATING_DURATION, starts[k + 1] - starts[k]);
    } else {
      const authored = isTemplateBlock(entry.block)
        ? (entry.block.sourceDuration ?? entry.rawDuration)
        : entry.rawDuration;
      // The final block covers through the end of the doc/narration when
      // the caller knows it runs longer.
      duration = Math.max(MIN_FLOATING_DURATION, authored, totalDuration - starts[k]);
    }
    result.push(toOutputBlock(entry.block, starts[k], duration));
  }
  return result;
}

/**
 * Convert an entry to an output Block shell. Template blocks preserve all
 * template-specific fields (stat, quote, description, …) so they survive
 * through to the player's template expansion step.
 */
function toOutputBlock(block: Block | TemplateBlock, startTime: number, duration: number): Block {
  if (isTemplateBlock(block)) {
    return {
      ...block,
      startTime,
      duration,
      title: getTemplateTitle(block),
    } as unknown as Block;
  }
  return { ...block, startTime, duration };
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
