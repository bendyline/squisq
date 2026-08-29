/**
 * Presenter-advance block timings — the observed sibling of the DTW aligner.
 *
 * The teleprompter INFERS where each block began by matching the take's audio
 * against the expected script (`alignNarration` → `deriveBlockRanges`). This
 * module takes the other route: while a take rolls, the presenter advances
 * slides themselves, and each first showing is stamped with take-relative
 * time. Those observations ARE the block boundaries — nothing is inferred.
 *
 * The output is an ordinary {@link NarrationTimingJsonV3}, so the entire read
 * path is unchanged: the recorder writes it to `<media>.timing.json`,
 * `applyNarrationTiming` finds it through the doc-anchored clip, matches its
 * entries to blocks (id → text similarity → order zip), and writes
 * `block.startTime` / `block.duration`. Only `generator.method` distinguishes
 * the two provenances.
 *
 * ## First-shown-only
 *
 * A revisit is a no-op ({@link recordSlideShown} returns its input). Block *k*
 * therefore runs from its first showing until block *k+1*'s first showing —
 * an excursion back to an earlier slide is billed to the slide the presenter
 * was on. That is the direct consequence of "note the time a slide is first
 * introduced", and it keeps the log monotonic, which every downstream
 * consumer assumes.
 *
 * ## Blocks the presenter never showed
 *
 * They collapse to a ZERO-LENGTH range at the next shown block's start.
 * `getBlockAtTime` selects on `time >= startTime && time < startTime +
 * duration`, so a zero-length block is never on screen — it is skipped in
 * playback, which is exactly what "never shown" means. Emitting them anyway
 * (rather than omitting them) is what keeps the sidecar contiguous and
 * complete: `applyNarrationTiming` places UNMATCHED doc blocks at its running
 * cursor with their own reading-time duration, which would silently push
 * every later block out of sync with the audio.
 */

import type { Doc } from '../schemas/Doc.js';
import { flattenRenderableBlocks } from '../doc/markdownToDoc.js';
import { buildNarrationScript, type BuildScriptOptions } from './script.js';
import type { NarrationTimingBlock, NarrationTimingJsonV3 } from './sidecar.js';

/** One block the presenter put on screen for the first time, in take-relative ms. */
export interface SlideAdvance {
  blockId: string;
  atMs: number;
}

/**
 * An ordered, first-shown-only advance log. Invariants, maintained by
 * {@link recordSlideShown}: each `blockId` appears at most once, and `atMs` is
 * non-decreasing.
 */
export type SlideAdvanceLog = readonly SlideAdvance[];

export const EMPTY_ADVANCE_LOG: SlideAdvanceLog = Object.freeze([]);

/**
 * Append a first showing.
 *
 * Returns the SAME reference — not a copy — when the block is already logged
 * (the presenter went backwards) or the stamp is unusable. Reference stability
 * is what makes this safe to call from a React state updater: a no-op advance
 * cannot trigger a re-render.
 *
 * `atMs` is clamped to at least the previous entry's, so a non-monotonic wall
 * clock (an NTP step mid-take) can never produce a decreasing log.
 */
export function recordSlideShown(
  log: SlideAdvanceLog,
  blockId: string,
  atMs: number,
): SlideAdvanceLog {
  if (!blockId || !Number.isFinite(atMs)) return log;
  for (const entry of log) {
    if (entry.blockId === blockId) return log;
  }
  const floor = log.length > 0 ? log[log.length - 1].atMs : 0;
  return [...log, { blockId, atMs: Math.max(atMs, floor, 0) }];
}

export interface BuildAdvanceTimingOptions {
  /**
   * Forwarded to `buildNarrationScript`. Must match whatever produced the
   * script the sidecar's `sourceText` will be compared against.
   */
  script?: BuildScriptOptions;
  /** `generator.name` written into provenance. Defaults to `'squisq-recorder'`. */
  generatorName?: string;
}

/** Clamp a caller-supplied take length to a usable, finite, non-negative value. */
function clampDuration(durationSec: number): number {
  return Number.isFinite(durationSec) && durationSec >= 0 ? durationSec : 0;
}

/**
 * Take-relative seconds at which each block was first shown, keyed by block id.
 *
 * Unknown ids are ignored (the doc changed since the take), repeats are
 * ignored (first-shown-only), and every value is clamped monotonic and into
 * `[0, duration]`. The earliest entry is then forced to 0: the take begins
 * when Record is pressed, whatever slide happened to be up.
 */
function firstShownSeconds(
  advances: SlideAdvanceLog,
  knownIds: ReadonlySet<string>,
  duration: number,
): Map<string, number> {
  const shown = new Map<string, number>();
  let cursor = 0;
  for (const advance of advances) {
    if (!knownIds.has(advance.blockId) || shown.has(advance.blockId)) continue;
    const raw = Number.isFinite(advance.atMs) ? advance.atMs / 1000 : cursor;
    const t = Math.min(duration, Math.max(cursor, raw));
    shown.set(advance.blockId, t);
    cursor = t;
  }
  const first = shown.keys().next();
  if (!first.done) shown.set(first.value, 0);
  return shown;
}

/**
 * Build a v3 timing sidecar from observed slide advances.
 *
 * Takes the `doc` rather than a prebuilt script on purpose: the payload needs
 * BOTH `flattenRenderableBlocks` (the authoritative block list — the script
 * skips blocks with no spoken text) and `buildNarrationScript` (`sourceText`
 * plus the char ranges that make matching survive an id change). Deriving both
 * here is what guarantees they cannot disagree.
 *
 * Pure — no clock, no I/O.
 */
export function buildAdvanceTimingJson(
  doc: Doc,
  advances: SlideAdvanceLog,
  durationSec: number,
  options?: BuildAdvanceTimingOptions,
): NarrationTimingJsonV3 {
  const duration = clampDuration(durationSec);
  const flat = flattenRenderableBlocks(doc.blocks);
  const script = buildNarrationScript(doc, options?.script);
  // Keyed, never positional: `script.blocks` omits blocks with no spoken text,
  // so index i of the two lists refer to different blocks in general.
  const scriptById = new Map(script.blocks.map((range) => [range.blockId, range]));

  const shown = firstShownSeconds(advances, new Set(flat.map((block) => block.id)), duration);

  // Starts, right to left: a shown block owns its observed time and becomes
  // the boundary for everything before it; an unshown block collapses onto
  // that boundary, which is what makes its range zero-length. A trailing run
  // of unshown blocks collapses onto the take's end.
  const starts = new Array<number>(flat.length);
  let boundary = duration;
  for (let i = flat.length - 1; i >= 0; i--) {
    const at = shown.get(flat[i].id);
    if (at !== undefined) {
      starts[i] = at;
      boundary = at;
    } else {
      starts[i] = boundary;
    }
  }

  const blocks: NarrationTimingBlock[] = [];
  // Blocks the script skipped carry no char range of their own. Anchoring a
  // zero-length range at the previous block's `charEnd` keeps offsets ordered
  // and in-bounds; the empty slice simply scores 0 on `matchSidecarBlocks`'s
  // similarity rung, which never runs because we emit every block's id.
  let charCursor = 0;
  for (let i = 0; i < flat.length; i++) {
    const block = flat[i];
    const range = scriptById.get(block.id);
    const charStart = range ? range.charStart : charCursor;
    const charEnd = range ? range.charEnd : charCursor;
    charCursor = charEnd;
    const startSec = starts[i];
    const rawEnd = i + 1 < flat.length ? starts[i + 1] : duration;
    blocks.push({
      blockId: block.id,
      ...(block.title ? { heading: block.title } : {}),
      blockIndex: i,
      charStart,
      charEnd,
      startSec,
      endSec: Math.max(startSec, Math.min(rawEnd, duration)),
    });
  }

  return {
    version: 3,
    sourceText: script.sourceText,
    duration,
    // No word-level timings exist on this path — the presenter gave us block
    // boundaries, not speech. Bookmarks are documented as per-WORD, so filling
    // them with block starts would misreport what was measured.
    bookmarks: [],
    blocks,
    // `cameraOffsetSec` is deliberately omitted: a dual take already encodes
    // its skew in the camera clip's `startAt`/`clipStart` attributes, and a
    // second copy here invites a double correction.
    generator: {
      name: options?.generatorName ?? 'squisq-recorder',
      method: 'presenter-advance',
    },
  };
}

/** How much of the deck the presenter actually got through. */
export interface AdvanceCoverage {
  /** Renderable blocks in the doc. */
  total: number;
  /** Blocks shown at least once during the take. */
  shown: number;
  /** Blocks never shown — they save as zero-length and are skipped in playback. */
  unshown: number;
  /** Headings of the unshown blocks, in document order, for user-facing copy. */
  unshownHeadings: string[];
}

/** Summarize an advance log against a doc. Pure; drives the review-panel warning. */
export function advanceCoverage(doc: Doc, advances: SlideAdvanceLog): AdvanceCoverage {
  const flat = flattenRenderableBlocks(doc.blocks);
  const seen = new Set(advances.map((advance) => advance.blockId));
  const unshownHeadings: string[] = [];
  let shown = 0;
  for (const block of flat) {
    if (seen.has(block.id)) shown++;
    else unshownHeadings.push(block.title || block.id);
  }
  return {
    total: flat.length,
    shown,
    unshown: flat.length - shown,
    unshownHeadings,
  };
}
