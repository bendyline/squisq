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
 * A timed piece of media attached to a block (or the document).
 */
export interface MediaClip {
  /** Stable id (for React keys and timeline selection). */
  id: string;
  /** Source path (mp3/mp4/…), relative to the article media dir. */
  src: string;
  kind: 'audio' | 'video';
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

/** Played length of a clip when known from its in/out points, else null. */
function clipLength(clip: MediaClip): number | null {
  if (clip.clipEnd == null) return null;
  return Math.max(0, clip.clipEnd - (clip.clipStart ?? 0));
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
 * `ScheduledClip`s. Pure — depends only on `doc`.
 */
export function resolveMediaSchedule(doc: Doc): ScheduledClip[] {
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
      out.push({
        id: clip.id,
        src: clip.src,
        kind: clip.kind,
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
    const end = len != null ? start + len : docEnd;
    out.push({
      id: clip.id,
      src: clip.src,
      kind: clip.kind,
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
export function getDocPlaybackDuration(doc: Doc): number {
  const base = baseTimelineEnd(doc);
  const mediaEnd = resolveMediaSchedule(doc).reduce((max, c) => Math.max(max, c.absoluteEnd), 0);
  return Math.max(base, mediaEnd);
}
