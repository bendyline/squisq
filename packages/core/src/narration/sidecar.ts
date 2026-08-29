/**
 * Narration timing sidecar v3 — the extended `<audio>.timing.json`.
 *
 * v1 (the recorder's original shape) is `{ sourceText, duration,
 * bookmarks }` with bookmarks always empty. v3 fills the bookmarks with
 * real per-word timings from the aligner and adds contiguous per-block
 * ranges. `version: 2` is already taken by the consolidated root
 * `timing.json` (`{ version: 2, sections }`), hence v3.
 *
 * Compatibility contract (tested in both directions): v3 is a strict
 * superset of v1, so the legacy `parseTimingJson` gate (requires
 * `sourceText` + `duration`, ignores unknown keys) keeps accepting v3
 * files; {@link parseNarrationTimingJson} accepts v1 files and returns
 * them with empty `blocks`.
 */

import type { AudioBookmark } from '../schemas/Doc.js';
import type { NarrationAlignment, NarrationScript } from './types.js';

/** Narration time range of one doc block at record time. */
export interface NarrationTimingBlock {
  /** Doc block id at record time (primary match key; ids can drift on heading edits). */
  blockId?: string;
  /** Block heading at record time (human-readable + fuzzy match key). */
  heading?: string;
  /** Index in renderable-block order at record time. */
  blockIndex: number;
  /** Char range into `sourceText` — the durable content key. */
  charStart: number;
  charEnd: number;
  startSec: number;
  /** Contiguous with the next block's startSec (aligner invariant). */
  endSec: number;
}

export interface NarrationTimingJsonV3 {
  version: 3;
  /** EXACTLY the NarrationScript.sourceText of the take. */
  sourceText: string;
  /** Take length in seconds (decoded-PCM length, not the recorder clock). */
  duration: number;
  /** Per-word timings: { id: `word-${i}`, time, charOffset, textFragment }. */
  bookmarks: AudioBookmark[];
  blocks: NarrationTimingBlock[];
  /**
   * SIGNED start skew of the companion camera recording, when one exists:
   * `cameraStart - audioStart`, in seconds. Negative when the camera pipeline
   * began first — which is reachable, since the two `MediaRecorder`s report
   * their start asynchronously and independently.
   */
  cameraOffsetSec?: number;
  /** Provenance of the timing data. */
  generator?: { name: string; method: NarrationTimingMethod; baseWpm?: number };
}

/**
 * How a sidecar's block ranges were produced.
 *
 * - `'dsp-align'` — the teleprompter's offline banded-DTW aligner inferred
 *   them from the take's audio against the expected script.
 * - `'presenter-advance'` — the presenter drove them directly, by advancing
 *   slides in the recorder while the take rolled. Observed, not inferred.
 */
export type NarrationTimingMethod = 'dsp-align' | 'presenter-advance';

export interface BuildNarrationTimingOptions {
  cameraOffsetSec?: number;
  baseWpm?: number;
}

/** Build the v3 sidecar payload from a script + its alignment. Pure. */
export function buildNarrationTimingJson(
  script: NarrationScript,
  alignment: NarrationAlignment,
  durationSec: number,
  options?: BuildNarrationTimingOptions,
): NarrationTimingJsonV3 {
  const bookmarks: AudioBookmark[] = alignment.words.map((word) => {
    const token = script.tokens[word.tokenIndex];
    return {
      id: `word-${word.tokenIndex}`,
      time: word.tSec,
      charOffset: token?.charOffset ?? 0,
      textFragment: token?.text ?? '',
    };
  });
  const blocks: NarrationTimingBlock[] = alignment.blocks.map((range) => ({
    ...(range.blockId ? { blockId: range.blockId } : {}),
    ...(range.heading !== undefined ? { heading: range.heading } : {}),
    blockIndex: range.blockIndex,
    charStart: range.charStart,
    charEnd: range.charEnd,
    startSec: range.startSec,
    endSec: range.endSec,
  }));
  return {
    version: 3,
    sourceText: script.sourceText,
    duration: Number.isFinite(durationSec) && durationSec >= 0 ? durationSec : 0,
    bookmarks,
    blocks,
    // Write only what `parseNarrationTimingJson` will read back, so the codec
    // is a round-trip pair. A non-finite value would serialize to `null`
    // (JSON has no NaN) and be dropped on parse anyway — omitting it here
    // keeps the emitted sidecar honest rather than carrying a dead field.
    ...(finiteNumber(options?.cameraOffsetSec) ? { cameraOffsetSec: options.cameraOffsetSec } : {}),
    generator: {
      name: 'squisq-teleprompter',
      method: 'dsp-align',
      ...(options?.baseWpm !== undefined ? { baseWpm: options.baseWpm } : {}),
    },
  };
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * A SIGNED finite number. `cameraOffsetSec` is a start *skew*, not a duration:
 * the camera and the mic are independent `MediaRecorder` pipelines whose
 * `onstart` events fire asynchronously, so an already-warm camera can begin
 * before the mic and yield a legitimately negative offset. Validating it as
 * non-negative silently DROPPED those takes' offsets on reload, and the camera
 * video then played with uncorrected skew.
 */
function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Tolerant parse: accepts v3, and v1 (`{ sourceText, duration,
 * bookmarks? }`) which comes back with empty `blocks`. Returns null for
 * malformed payloads. Blocks are sorted and clamped monotonic
 * defensively (hand-edited sidecars).
 */
export function parseNarrationTimingJson(
  data: ArrayBuffer | Uint8Array | string,
): NarrationTimingJsonV3 | null {
  try {
    const text =
      typeof data === 'string'
        ? data
        : new TextDecoder().decode(data instanceof Uint8Array ? data : new Uint8Array(data));
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const raw = parsed as Record<string, unknown>;
    if (typeof raw.sourceText !== 'string' || !finiteNonNegative(raw.duration)) return null;

    const bookmarks: AudioBookmark[] = Array.isArray(raw.bookmarks)
      ? (raw.bookmarks as unknown[]).flatMap((b): AudioBookmark[] => {
          if (typeof b !== 'object' || b === null) return [];
          const bookmark = b as Record<string, unknown>;
          if (!finiteNonNegative(bookmark.time) || !finiteNonNegative(bookmark.charOffset)) {
            return [];
          }
          return [
            {
              id: typeof bookmark.id === 'string' ? bookmark.id : `bookmark-${bookmark.charOffset}`,
              time: bookmark.time,
              charOffset: bookmark.charOffset,
              ...(typeof bookmark.textFragment === 'string'
                ? { textFragment: bookmark.textFragment }
                : {}),
            },
          ];
        })
      : [];

    let blocks: NarrationTimingBlock[] = Array.isArray(raw.blocks)
      ? (raw.blocks as unknown[]).flatMap((b): NarrationTimingBlock[] => {
          if (typeof b !== 'object' || b === null) return [];
          const block = b as Record<string, unknown>;
          if (
            !finiteNonNegative(block.startSec) ||
            !finiteNonNegative(block.endSec) ||
            !finiteNonNegative(block.charStart) ||
            !finiteNonNegative(block.charEnd)
          ) {
            return [];
          }
          return [
            {
              ...(typeof block.blockId === 'string' ? { blockId: block.blockId } : {}),
              ...(typeof block.heading === 'string' ? { heading: block.heading } : {}),
              blockIndex: finiteNonNegative(block.blockIndex) ? block.blockIndex : 0,
              charStart: block.charStart,
              charEnd: block.charEnd,
              startSec: block.startSec,
              endSec: Math.max(block.startSec, block.endSec),
            },
          ];
        })
      : [];

    blocks = blocks.sort((a, b) => a.startSec - b.startSec);
    let cursor = 0;
    for (const block of blocks) {
      if (block.startSec < cursor) block.startSec = cursor;
      if (block.endSec < block.startSec) block.endSec = block.startSec;
      cursor = block.startSec;
    }

    return {
      version: 3,
      sourceText: raw.sourceText,
      duration: raw.duration,
      bookmarks,
      blocks,
      ...(finiteNumber(raw.cameraOffsetSec) ? { cameraOffsetSec: raw.cameraOffsetSec } : {}),
      ...(typeof raw.generator === 'object' && raw.generator !== null
        ? { generator: raw.generator as NarrationTimingJsonV3['generator'] }
        : {}),
    };
  } catch {
    return null;
  }
}
