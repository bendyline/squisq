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
 * over narration ranges PER FIELD — a `duration=` pin keeps the
 * narration's start and a `startTime=` pin keeps the narration's length
 * (a conflicting pin gets an `info` diagnostic); narration ranges win
 * over per-block audio-segment mapping and reading-time estimates.
 *
 * Contiguity: the block strip never opens a gap (or an overlap) around a
 * pin. When a pin moves a block's end away from the take's range
 * boundary, every later narration anchor ripples by the same delta —
 * the committed layout matches the timeline editor's drag preview,
 * which re-flows following blocks live. The narration AUDIO keeps its
 * own absolute schedule; the diagnostic records that drift.
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
  /**
   * Ripple (seconds) applied to later narration anchors after a pin moved a
   * block's end away from the take's range boundary. Stays 0 while every pin
   * agrees with the take, so unpinned docs keep their absolute anchors.
   */
  shift: number;
}

/** Recursively clone blocks, re-timing matched blocks from their narration ranges. */
function retimeBlocks(blocks: Block[], ctx: RetimeContext): Block[] {
  return blocks.map((block) => {
    const range = ctx.ranges.get(block.id);
    const pinned = getPinnedBlockMeta(block);
    const next: Block = { ...block };

    if (range) {
      const narrStart = ctx.clipStart + range.startSec + ctx.shift;
      const narrDuration = Math.max(0, range.endSec - range.startSec);
      // Per-field precedence: a pin overrides only the field it names. A
      // dragged `duration=` keeps the narration's (rippled) start; a
      // `startTime=` pin keeps the narration's length.
      next.startTime = pinned.startTime ?? narrStart;
      next.duration = pinned.duration ?? narrDuration;
      const end = next.startTime + next.duration;
      // Contiguity: later anchors follow this block's actual end. For an
      // unpinned block `end` lands exactly on its shifted range boundary, so
      // this is a no-op until a pin disagrees with the take — from then on
      // the strip ripples instead of opening a gap or an overlap.
      ctx.shift = end - (ctx.clipStart + range.endSec);
      const durationConflict =
        pinned.duration != null &&
        Math.abs(pinned.duration - narrDuration) > PIN_CONFLICT_TOLERANCE_SEC;
      const startConflict =
        pinned.startTime != null && Math.abs(pinned.startTime - narrStart) > PIN_CONFLICT_TOLERANCE_SEC;
      if (durationConflict || startConflict) {
        ctx.diagnostics.push({
          severity: 'info',
          code: 'narration-pin-conflict',
          message:
            `Block timing is pinned (duration=/startTime=) but the recorded narration says ` +
            `~${narrDuration.toFixed(1)}s starting at ~${narrStart.toFixed(1)}s. The pin wins and ` +
            `later blocks follow it, while the recorded voice keeps its own schedule — playback ` +
            `drifts from the take past this block. Remove the pin to follow the narration.`,
          blockId: block.id,
        });
      }
      ctx.cursor = Math.max(ctx.cursor, end);
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
      shift: 0,
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
