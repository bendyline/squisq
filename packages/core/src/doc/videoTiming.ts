/**
 * A block's video sets the floor on its length.
 *
 * `markdownToDoc` estimates a block's duration from its text. That is right
 * for prose and wrong for a slide that is a short caption over a clip: a
 * heading, a line of text and a 1:40 screen recording read in three seconds,
 * so the slide advanced — and its video, whose out-point is the block's end,
 * stopped — three seconds in. A video plays to its own length, so the block's
 * duration is at least the longest video it plays, measured from the block's
 * start (a `startAt` delay counts) through the clip's played length (trim
 * window minus cuts).
 *
 * ## Which videos count
 *
 * - Video in the block's body: a `<video>` tag, or a markdown link/image to a
 *   video file (what {@link extractEmbeddedVideos} finds).
 * - Video clips anchored to the block (`block.media`) that stop at its end —
 *   not `spillover` clips (they run past the block on purpose) and not
 *   unlocked clips (`lockToBlock: false`; those are document-timed).
 *
 * Audio does not count: a block over a long music bed should not hold for the
 * whole track.
 *
 * ## Where a video's length comes from
 *
 * An authored out-point (`data-squisq-video-clip-end` / `clipEnd=`) is enough
 * on its own. Otherwise the length is the media file's, which the pure model
 * cannot read: hosts that can (a browser decoding the file's metadata) pass a
 * {@link VideoDurationLookup}. Without either, the video sets no floor and the
 * block keeps its text estimate.
 *
 * ## Precedence
 *
 * An author-pinned `duration=` wins outright. Recorded narration
 * (`applyNarrationTiming`, run later by `resolveAudioMapping`) overwrites the
 * blocks it times. Below both, a block lasts the longer of its reading time and
 * its video.
 */

import type { Block, Doc } from '../schemas/Doc.js';
import type { MediaClip } from '../schemas/Media.js';
import type { MediaCut } from '../mediaEdit/recipe.js';
import { createMediaTimeMap } from '../mediaEdit/timeMap.js';
import { extractEmbeddedVideos } from './templateInputs.js';

/**
 * A media file's own length in seconds, keyed by the `src` the document
 * names it with. Return undefined when the length is not known (yet).
 */
export type VideoDurationLookup = (src: string) => number | undefined;

/** The timing facts of one video a block plays. */
interface BlockVideo {
  src: string;
  startAt?: number;
  clipStart?: number;
  clipEnd?: number;
  cuts?: readonly MediaCut[];
}

/** A block clip that ends with its block, so its length can hold the block. */
function clipEndsWithBlock(clip: MediaClip): boolean {
  return (
    clip.kind === 'video' &&
    clip.anchor === 'block' &&
    clip.spillover !== true &&
    clip.lockToBlock !== false
  );
}

/** Every video whose length can hold `block` open. */
function blockVideos(block: Block): BlockVideo[] {
  const body: BlockVideo[] = extractEmbeddedVideos(block.contents).map((video) => ({
    src: video.src,
    startAt: video.startAt,
    clipStart: video.clipStart,
    clipEnd: video.clipEnd,
    cuts: video.cuts,
  }));
  const clips: BlockVideo[] = (block.media ?? []).filter(clipEndsWithBlock).map((clip) => ({
    src: clip.src,
    startAt: clip.startAt,
    clipStart: clip.clipStart,
    clipEnd: clip.clipEnd,
    cuts: clip.edits?.cuts,
  }));
  return [...body, ...clips];
}

/** A usable media length, or undefined. */
function knownLength(seconds: number | undefined): number | undefined {
  return seconds != null && Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/**
 * Seconds from the block's start until `video` finishes, or null when its
 * length is not known.
 */
function videoEnd(video: BlockVideo, lookup: VideoDurationLookup | undefined): number | null {
  const sourceDuration = knownLength(lookup?.(video.src));
  if (video.clipEnd == null && sourceDuration == null) return null;
  const played = createMediaTimeMap({
    clipStart: video.clipStart,
    clipEnd: video.clipEnd,
    cuts: video.cuts,
    sourceDuration,
  }).playedDuration;
  if (!Number.isFinite(played) || played <= 0) return null;
  return Math.max(0, video.startAt ?? 0) + played;
}

/**
 * The shortest duration that lets every video in `block` play to its end, or
 * null when the block plays no video of known length. Ignores the block's own
 * duration and any pin — callers decide whether the floor applies.
 */
export function blockVideoLength(block: Block, lookup?: VideoDurationLookup): number | null {
  let longest: number | null = null;
  for (const video of blockVideos(block)) {
    const end = videoEnd(video, lookup);
    if (end != null && (longest == null || end > longest)) longest = end;
  }
  return longest;
}

/**
 * The video sources in `doc` whose length only the media file can tell — those
 * with no authored out-point — in document order, without duplicates. A host
 * measures these and passes the results to `applyVideoDurations`.
 */
export function collectVideoDurationSources(doc: Doc): string[] {
  const sources = new Set<string>();
  const visit = (blocks: readonly Block[]): void => {
    for (const block of blocks) {
      for (const video of blockVideos(block)) {
        if (video.clipEnd == null && video.src) sources.add(video.src);
      }
      if (block.children?.length) visit(block.children);
    }
  };
  visit(doc.blocks);
  return [...sources];
}
