/**
 * Media-clip timing model.
 *
 * An additive layer on top of the simple sequential `Doc.audio.segments[]`
 * narration track, which remains first-class. A {@link MediaClip} is a piece
 * of audio or video whose
 * timing is expressed *relative to its parent block* (or the whole document),
 * with an optional `startAt` offset and an optional `spillover` past the
 * block's end. {@link resolveMediaSchedule} flattens these into absolute,
 * doc-timeline `ScheduledClip`s that playback and export consume.
 *
 * Authoring: a body-level `{[audio …]}` / `{[video …]}` annotation inside a
 * block becomes a `block.media` clip; the same annotation in the preamble
 * (before the first heading) with `anchor=document` becomes a
 * `doc.documentMedia` clip that spans the whole timeline.
 */

import type { Block, Doc } from './Doc.js';

/**
 * How an authored video participates in the composed document frame.
 *
 * `content` videos remain in the block body and are laid out by the block
 * template. The other placements are scheduled player-level video and sit
 * above the composed slide.
 */
export type VideoPlacement = 'content' | 'picture-in-picture' | 'overlay';

/** Player-level placement of scheduled video relative to slide content. */
export type VideoPresentation = 'background' | 'full-frame' | 'picture-in-picture';

/** Optional per-video override for picture-in-picture size. */
export type VideoPipSize = 'small' | 'large';

/** Optional per-video override for the picture-in-picture frame shape. */
export type VideoPipShape = 'square' | 'wide';

/** Optional per-video override for the picture-in-picture corner. */
export type VideoPipPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * A timed piece of media attached to a block (or the document).
 */
export interface MediaClip {
  /** Stable id (for React keys and timeline selection). */
  id: string;
  /** Source path (mp3/mp4/…), relative to the article media dir. */
  src: string;
  kind: 'audio' | 'video';
  /** Per-video placement. Omitted audio and legacy video use player defaults. */
  placement?: Exclude<VideoPlacement, 'content'>;
  /** Per-video PIP size. Omitted clips use the document/player setting. */
  pipSize?: VideoPipSize;
  /** Per-video PIP shape. Omitted clips use the document/player setting. */
  pipShape?: VideoPipShape;
  /** Per-video PIP corner. Omitted clips use the document/player setting. */
  pipPosition?: VideoPipPosition;
  /**
   * Whether a placed video is locked to its owning block's timeline span.
   * `true` clips start with and are capped by the block. `false` clips are
   * document-timed and may cross block boundaries. Omitted for legacy media.
   */
  lockToBlock?: boolean;
  /**
   * Seconds from the parent block's start when this clip begins. For an
   * `anchor='document'` clip, seconds from the document start. Default 0.
   */
  startAt: number;
  /** Source in-point within the file (seconds). Default 0. */
  clipStart?: number;
  /** Source out-point within the file (seconds). Default: file/block end. */
  clipEnd?: number;
  /**
   * When false (default) the clip stops at its block's end. When true it
   * keeps playing past the block boundary until the clip itself finishes.
   * Ignored for `anchor='document'` clips (they already span the timeline).
   */
  spillover?: boolean;
  /**
   * `'block'` (default) — timed relative to the parent block. `'document'` —
   * timed relative to the document start and able to span every block.
   */
  anchor: 'block' | 'document';
  /**
   * 1-based source line of the authoring annotation, when derived from
   * markdown. Enables round-tripping edits (e.g. the timeline editor rewriting
   * `startAt`) back to the exact line. Absent for programmatically built clips.
   */
  sourceLine?: number;
  /**
   * Round-trip home of the authoring annotation: the block whose contents
   * held the paragraph, its position in that block's ORIGINAL contents
   * array (before extraction), and the paragraph's exact source text.
   * `docToMarkdown` re-inserts the annotation from this — `raw` verbatim
   * when present, a re-serialized annotation otherwise. Absent for
   * programmatically built clips (those emit at the document top).
   */
  origin?: {
    blockId: string;
    index: number;
    raw?: string;
    /** Raw authoring form; omitted means a squiggly media annotation. */
    format?: 'html';
  };
}

/**
 * A {@link MediaClip} resolved to absolute document-timeline coordinates.
 * Produced by {@link resolveMediaSchedule}; consumed by the playback
 * scheduler and the MP4 export.
 */
export interface ScheduledClip {
  id: string;
  src: string;
  kind: 'audio' | 'video';
  /** Per-video placement carried through to the player-level compositor. */
  placement?: Exclude<VideoPlacement, 'content'>;
  /** Per-video PIP size carried through to the player-level compositor. */
  pipSize?: VideoPipSize;
  /** Per-video PIP shape carried through to the player-level compositor. */
  pipShape?: VideoPipShape;
  /** Per-video PIP corner carried through to the player-level compositor. */
  pipPosition?: VideoPipPosition;
  /** Authored placed-video lock state, when applicable. */
  lockToBlock?: boolean;
  /** Absolute doc-timeline second the clip starts. */
  absoluteStart: number;
  /** Absolute doc-timeline second the clip ends (exclusive). */
  absoluteEnd: number;
  /** Source in-point to seek to at `absoluteStart`. */
  sourceIn: number;
  anchor: 'block' | 'document';
  /** Owning block id for block-anchored clips (for video re-homing/export). */
  blockId?: string;
  /** 1-based source line of the authoring annotation, when known. */
  sourceLine?: number;
}

/** Depth-first flatten of the block tree (local copy to avoid a doc-layer dep). */
function flatten(blocks: Block[], out: Block[] = []): Block[] {
  for (const b of blocks) {
    out.push(b);
    if (b.children && b.children.length > 0) flatten(b.children, out);
  }
  return out;
}

/** Options for {@link resolveMediaSchedule} / {@link getDocPlaybackDuration}. */
export interface MediaScheduleOptions {
  /**
   * Optional lookup of a media file's intrinsic duration in seconds (e.g.
   * probed from the decoded file). When a clip has no authored out-point
   * (`clipEnd`) and is not locked to its block, its scheduled end is capped at
   * this natural length instead of filling to the block/document end — so an
   * unlocked video plays for its own length and then goes inactive rather than
   * holding its last frame until the timeline ends.
   *
   * Applied only as an upper bound: it can pull a clip's end earlier but never
   * extends it, so the overall timeline length is unchanged. Return undefined
   * (the default when no probe is wired) to preserve the historical
   * fill-to-end behavior. Locked clips ignore it — they fill their owning
   * block by design.
   */
  intrinsicDuration?: (clip: MediaClip) => number | undefined;
}

/** Played length of a clip when known from its in/out points, else null. */
function clipLength(clip: MediaClip): number | null {
  if (clip.clipEnd == null) return null;
  return Math.max(0, clip.clipEnd - (clip.clipStart ?? 0));
}

/**
 * The clip's own played length (seconds) from an externally supplied intrinsic
 * media duration, measured past its in-point. Used to cap an UNLOCKED clip that
 * has no authored out-point to its natural length. Null when the clip is locked
 * (it fills its block by design), already pins an out-point (`clipEnd`), or no
 * usable duration is known. This value is only ever applied as an upper bound on
 * a clip's end, so it can pull the end earlier but never extend the timeline.
 */
function intrinsicPlayedLength(
  clip: MediaClip,
  opts: MediaScheduleOptions | undefined,
): number | null {
  if (clip.clipEnd != null || clip.lockToBlock === true) return null;
  const intrinsic = opts?.intrinsicDuration?.(clip);
  if (intrinsic == null || !Number.isFinite(intrinsic) || intrinsic <= 0) return null;
  const played = intrinsic - (clip.clipStart ?? 0);
  return played > 0 ? played : null;
}

/**
 * Base playback span ignoring media — the larger of the audio-segment sum
 * and the last block's end. Document clips that don't pin a length run to
 * this point.
 */
function baseTimelineEnd(doc: Doc): number {
  const blockEnd = flatten(doc.blocks).reduce(
    (max, b) => Math.max(max, b.startTime + b.duration),
    0,
  );
  return Math.max(doc.duration ?? 0, blockEnd);
}

/**
 * Flatten every block clip and document clip into absolute-timed
 * `ScheduledClip`s. Pure — depends only on `doc` (plus the optional intrinsic
 * media durations in {@link MediaScheduleOptions}).
 */
export function resolveMediaSchedule(doc: Doc, opts?: MediaScheduleOptions): ScheduledClip[] {
  const out: ScheduledClip[] = [];
  const docEnd = baseTimelineEnd(doc);

  for (const block of flatten(doc.blocks)) {
    const blockEnd = block.startTime + block.duration;
    for (const clip of block.media ?? []) {
      const start = block.startTime + clip.startAt;
      const len = clipLength(clip);
      let end: number;
      if (clip.spillover) {
        // Continue past the block; fall back to the block end when the
        // played length is unknown (no clipEnd authored).
        end = len != null ? start + len : blockEnd;
      } else {
        end = len != null ? Math.min(start + len, blockEnd) : blockEnd;
      }
      // An unlocked clip with no authored out-point must not hold past the
      // media file's own length: cap the end at its natural duration when
      // probed. Only ever pulls the end earlier — locked clips and authored
      // out-points are untouched, so the timeline length is unchanged.
      const natLen = intrinsicPlayedLength(clip, opts);
      if (natLen != null) end = Math.min(end, start + natLen);
      out.push({
        id: clip.id,
        src: clip.src,
        kind: clip.kind,
        ...(clip.placement ? { placement: clip.placement } : {}),
        ...(clip.pipSize ? { pipSize: clip.pipSize } : {}),
        ...(clip.pipShape ? { pipShape: clip.pipShape } : {}),
        ...(clip.pipPosition ? { pipPosition: clip.pipPosition } : {}),
        ...(clip.lockToBlock != null ? { lockToBlock: clip.lockToBlock } : {}),
        absoluteStart: start,
        absoluteEnd: Math.max(start, end),
        sourceIn: clip.clipStart ?? 0,
        anchor: 'block',
        blockId: block.id,
        ...(clip.sourceLine != null ? { sourceLine: clip.sourceLine } : {}),
      });
    }
  }

  for (const clip of doc.documentMedia ?? []) {
    const start = clip.startAt;
    const len = clipLength(clip);
    let end = len != null ? start + len : docEnd;
    // Cap an unlocked, un-pinned document video to its own probed length so it
    // stops at its natural end rather than spanning the whole timeline.
    const natLen = intrinsicPlayedLength(clip, opts);
    if (natLen != null) end = Math.min(end, start + natLen);
    out.push({
      id: clip.id,
      src: clip.src,
      kind: clip.kind,
      ...(clip.placement ? { placement: clip.placement } : {}),
      ...(clip.pipSize ? { pipSize: clip.pipSize } : {}),
      ...(clip.pipShape ? { pipShape: clip.pipShape } : {}),
      ...(clip.pipPosition ? { pipPosition: clip.pipPosition } : {}),
      ...(clip.lockToBlock != null ? { lockToBlock: clip.lockToBlock } : {}),
      absoluteStart: start,
      absoluteEnd: Math.max(start, end),
      sourceIn: clip.clipStart ?? 0,
      anchor: 'document',
      ...(clip.sourceLine != null ? { sourceLine: clip.sourceLine } : {}),
    });
  }

  return out;
}

/**
 * Total playback duration including any media that spills past the last
 * block (or audio segment). Export uses this for the frame count and the
 * player for its effective timeline length.
 */
export function getDocPlaybackDuration(doc: Doc, opts?: MediaScheduleOptions): number {
  const base = baseTimelineEnd(doc);
  const mediaEnd = resolveMediaSchedule(doc, opts).reduce(
    (max, c) => Math.max(max, c.absoluteEnd),
    0,
  );
  return Math.max(base, mediaEnd);
}
