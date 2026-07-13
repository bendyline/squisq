/**
 * Apply narration timing from a document-anchored take to a Doc's block
 * timeline.
 *
 * When a doc carries a document-spanning narration clip (a preamble
 * `{[audio src=… anchor=document]}` → `doc.documentMedia`) whose
 * `.timing.json` sidecar has per-block ranges (v3, written by the
 * teleprompter's aligner), the blocks are re-timed so playback and
 * exports advance in sync with the recorded voice. Runs as step 0 of
 * `resolveAudioMapping`, so every surface that resolves audio gets it.
 *
 * Precedence: author-pinned `duration=`/`startTime=` heading attrs win
 * over narration ranges (a conflicting pin gets an `info` diagnostic);
 * narration ranges win over per-block audio-segment mapping and
 * reading-time estimates.
 */

import type { Block, Doc, DocDiagnostic } from '../schemas/Doc.js';
import type { MediaClip } from '../schemas/Media.js';
import type { ContentContainer } from '../storage/ContentContainer.js';
import { estimateTimeFromText } from '../timing/narrationTiming.js';
import { buildNarrationScript } from '../narration/script.js';
import {
  parseNarrationTimingJson,
  type NarrationTimingBlock,
  type NarrationTimingJsonV3,
} from '../narration/sidecar.js';
import { flattenRenderableBlocks, getBlockBodyText, getPinnedBlockMeta } from './markdownToDoc.js';
import { scoreTextSimilarity } from './audioMapping.js';

export interface NarrationResolution {
  doc: Doc;
  /** False → the doc is returned unchanged (no clip / no sidecar / no match). */
  applied: boolean;
  /** The narration media path, for callers that bundle assets. */
  clipSrc?: string;
}

/** Minimum similarity for the fuzzy block-matching rung. */
const MIN_BLOCK_SIMILARITY = 0.5;
/** Minimum whole-script similarity for the v1 proportional fallback. */
const MIN_V1_SCRIPT_SIMILARITY = 0.8;
/** Pins that disagree with the narration range by more than this get a diagnostic. */
const PIN_CONFLICT_TOLERANCE_SEC = 1;

interface BlockRangeSec {
  startSec: number;
  endSec: number;
}

/** Spoken text of a block, mirroring the narration script builder. */
function blockSpokenText(block: Block): string {
  const title = block.title ? block.title.trim() : '';
  const body = getBlockBodyText(block);
  if (title && body) return `${title}\n${body}`;
  return title || body;
}

/**
 * Match sidecar block ranges to doc blocks with a deterministic ladder:
 * exact blockId → text similarity (greedy best-first, ≥ 0.5) →
 * in-order zip when the leftover counts agree. Unmatchable sidecar
 * blocks are dropped.
 */
function matchSidecarBlocks(
  flat: Block[],
  timing: NarrationTimingJsonV3,
): Map<string, BlockRangeSec> {
  const ranges = new Map<string, BlockRangeSec>();
  const remainingBlocks = new Set(flat.map((b) => b.id));
  const remainingSidecar: NarrationTimingBlock[] = [];

  const byId = new Map(flat.map((b) => [b.id, b]));
  for (const entry of timing.blocks) {
    if (entry.blockId && byId.has(entry.blockId) && remainingBlocks.has(entry.blockId)) {
      ranges.set(entry.blockId, { startSec: entry.startSec, endSec: entry.endSec });
      remainingBlocks.delete(entry.blockId);
    } else {
      remainingSidecar.push(entry);
    }
  }

  // Fuzzy rung: greedy best pair first, each side used once.
  if (remainingSidecar.length > 0 && remainingBlocks.size > 0) {
    const candidates: Array<{ score: number; entry: NarrationTimingBlock; blockId: string }> = [];
    for (const entry of remainingSidecar) {
      const slice = timing.sourceText.slice(entry.charStart, entry.charEnd);
      for (const block of flat) {
        if (!remainingBlocks.has(block.id)) continue;
        const score = scoreTextSimilarity(slice, blockSpokenText(block));
        if (score >= MIN_BLOCK_SIMILARITY) candidates.push({ score, entry, blockId: block.id });
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.entry.blockIndex - b.entry.blockIndex);
    const usedEntries = new Set<NarrationTimingBlock>();
    for (const candidate of candidates) {
      if (usedEntries.has(candidate.entry) || !remainingBlocks.has(candidate.blockId)) continue;
      ranges.set(candidate.blockId, {
        startSec: candidate.entry.startSec,
        endSec: candidate.entry.endSec,
      });
      usedEntries.add(candidate.entry);
      remainingBlocks.delete(candidate.blockId);
    }
    // Order rung: leftover counts equal → zip in document/sidecar order.
    const leftoverEntries = remainingSidecar.filter((e) => !usedEntries.has(e));
    if (leftoverEntries.length > 0 && leftoverEntries.length === remainingBlocks.size) {
      const leftoverBlocks = flat.filter((b) => remainingBlocks.has(b.id));
      leftoverEntries.sort((a, b) => a.blockIndex - b.blockIndex);
      leftoverBlocks.forEach((block, i) => {
        const entry = leftoverEntries[i];
        ranges.set(block.id, { startSec: entry.startSec, endSec: entry.endSec });
      });
    }
  }

  return ranges;
}

/**
 * v1 fallback: no block ranges in the sidecar. If the take's source
 * text still narrates this doc (whole-script similarity ≥ 0.8), derive
 * per-block ranges by spoken-word proportion.
 */
function proportionalRanges(
  doc: Doc,
  timing: NarrationTimingJsonV3,
): Map<string, BlockRangeSec> | null {
  const script = buildNarrationScript(doc);
  if (script.blocks.length === 0) return null;
  if (scoreTextSimilarity(script.sourceText, timing.sourceText) < MIN_V1_SCRIPT_SIMILARITY) {
    return null;
  }
  const ranges = new Map<string, BlockRangeSec>();
  const starts = script.blocks.map((range) =>
    estimateTimeFromText(script.sourceText, range.charStart, timing.duration),
  );
  script.blocks.forEach((range, i) => {
    ranges.set(range.blockId, {
      startSec: starts[i],
      endSec: i + 1 < starts.length ? starts[i + 1] : timing.duration,
    });
  });
  return ranges;
}

interface RetimeContext {
  clipStart: number;
  ranges: Map<string, BlockRangeSec>;
  diagnostics: DocDiagnostic[];
  /** Timeline cursor (doc seconds) for unmatched blocks. */
  cursor: number;
}

/** Recursively clone blocks, applying narration ranges to matched, unpinned blocks. */
function retimeBlocks(blocks: Block[], ctx: RetimeContext): Block[] {
  return blocks.map((block) => {
    const range = ctx.ranges.get(block.id);
    const pinned = getPinnedBlockMeta(block);
    const next: Block = { ...block };

    if (range && pinned.duration == null && pinned.startTime == null) {
      next.startTime = ctx.clipStart + range.startSec;
      next.duration = Math.max(0, range.endSec - range.startSec);
      ctx.cursor = Math.max(ctx.cursor, next.startTime + next.duration);
    } else if (range) {
      // Author pins win; surface real disagreement as an info diagnostic.
      const pinnedStart = pinned.startTime ?? block.startTime;
      const pinnedDuration = pinned.duration ?? block.duration;
      const narrStart = ctx.clipStart + range.startSec;
      const narrDuration = Math.max(0, range.endSec - range.startSec);
      if (
        Math.abs(pinnedStart - narrStart) > PIN_CONFLICT_TOLERANCE_SEC ||
        Math.abs(pinnedDuration - narrDuration) > PIN_CONFLICT_TOLERANCE_SEC
      ) {
        ctx.diagnostics.push({
          severity: 'info',
          code: 'narration-pin-conflict',
          message:
            `Block timing is pinned (duration=/startTime=) but the recorded narration says ` +
            `~${narrDuration.toFixed(1)}s starting at ~${narrStart.toFixed(1)}s. The pin wins; ` +
            `remove it to follow the narration.`,
          blockId: block.id,
        });
      }
      ctx.cursor = Math.max(ctx.cursor, pinnedStart + pinnedDuration);
    } else {
      // No narration range (block added after the take, or unmatched):
      // keep its duration but place it at the running cursor so the
      // timeline stays monotonic.
      next.startTime = ctx.cursor;
      ctx.cursor += next.duration;
    }

    if (block.children && block.children.length > 0) {
      next.children = retimeBlocks(block.children, ctx);
    }
    return next;
  });
}

/**
 * Find the doc's document-anchored narration clip, load its timing
 * sidecar, and re-time the blocks from its ranges. Pure with respect to
 * the input doc — returns a new Doc (or the original when nothing
 * applies).
 */
export async function applyNarrationTiming(
  doc: Doc,
  container: ContentContainer,
): Promise<NarrationResolution> {
  const clips: MediaClip[] = (doc.documentMedia ?? []).filter((c) => c.anchor === 'document');
  for (const clip of clips) {
    if (!clip.src) continue;
    const sidecarData = await container.readFile(`${clip.src}.timing.json`);
    if (!sidecarData) continue;
    const timing = parseNarrationTimingJson(sidecarData);
    if (!timing) continue;

    const flat = flattenRenderableBlocks(doc.blocks);
    const ranges =
      timing.blocks.length > 0 ? matchSidecarBlocks(flat, timing) : proportionalRanges(doc, timing);
    if (!ranges || ranges.size === 0) continue;

    const ctx: RetimeContext = {
      clipStart: clip.startAt,
      ranges,
      diagnostics: [],
      cursor: 0,
    };
    const blocks = retimeBlocks(doc.blocks, ctx);
    const duration = Math.max(clip.startAt + timing.duration, ctx.cursor);
    const retimed: Doc = {
      ...doc,
      blocks,
      duration,
      ...(ctx.diagnostics.length > 0
        ? { diagnostics: [...(doc.diagnostics ?? []), ...ctx.diagnostics] }
        : {}),
    };
    return { doc: retimed, applied: true, clipSrc: clip.src };
  }
  return { doc, applied: false };
}
