/**
 * audioTimeline — Pure scheduling of a doc's audio onto the export timeline.
 *
 * Browser-pure and Node-testable: turns a {@link Doc} into a flat list of
 * absolute-timed {@link AudioTimelineClip}s. This is the single source of
 * truth the browser MP4 export uses to place audio, and it deliberately
 * replicates the exact schedule math the CLI mix path uses so both agree:
 *
 *  - Narration segments (`doc.audio.segments[]`) are laid **sequentially**,
 *    each starting where the previous one ended — mirroring the CLI, which
 *    concatenates the segment files in order.
 *  - Timed media clips (`block.media` + `doc.documentMedia`) are placed at
 *    their **absolute** doc-timeline positions via the shared
 *    `resolveMediaSchedule()` helper (the same one the CLI calls), honouring
 *    each clip's trim window (`sourceIn` / `absoluteEnd - absoluteStart`).
 *  - Every start time is shifted by `coverPreRoll` so a cover pre-roll padding
 *    (silent leading frames) keeps audio in sync.
 */

import type { Doc } from '@bendyline/squisq/schemas';
import { resolveMediaSchedule } from '@bendyline/squisq/schemas';

/** One audio source placed on the absolute export timeline. */
export interface AudioTimelineClip {
  /** Source path (mp3/webm/mp4/…), relative to the doc's media dir. */
  src: string;
  /** Absolute second on the export timeline where this clip starts. */
  startSec: number;
  /** In-point within the source file to begin playback from. */
  sourceInSec: number;
  /** Played length in seconds (the trimmed window of the source). */
  durationSec: number;
}

/**
 * Flatten a doc's narration + timed-media audio into absolute-timed clips.
 *
 * Pure — depends only on `doc` (and reuses `resolveMediaSchedule` from core so
 * the browser export and the CLI mix never drift). Returns `[]` for a doc with
 * no audio at all.
 *
 * @param doc - The document to schedule audio for.
 * @param coverPreRoll - Leading silent padding (seconds) added ahead of every
 *   clip, matching the cover-slide pre-roll frames. Default 0.
 */
export function computeAudioTimeline(doc: Doc, coverPreRoll = 0): AudioTimelineClip[] {
  const preRoll = safeSeconds(coverPreRoll);
  const clips: AudioTimelineClip[] = [];

  // ── Narration: laid sequentially (matches the CLI's ordered concat). ──
  // A non-finite duration contributes 0 to the cursor rather than poisoning it:
  // `cursor += NaN` would make EVERY later segment's startSec NaN, which reaches
  // ffmpeg as `adelay=NaN` or the browser as `node.start(NaN)`. One bad segment
  // is dropped; the rest of the timeline stays intact.
  let cursor = 0;
  for (const seg of doc.audio?.segments ?? []) {
    const durationSec = safeSeconds(seg.duration);
    if (durationSec > 0 && seg.src) {
      clips.push({ src: seg.src, startSec: cursor + preRoll, sourceInSec: 0, durationSec });
    }
    cursor += durationSec;
  }

  // ── Timed media clips: absolute positions from the shared schedule. ──
  for (const clip of resolveMediaSchedule(doc)) {
    if (clip.kind !== 'audio') continue;
    // Guard the endpoints before subtracting: `NaN <= 0` is false, so a NaN
    // duration would otherwise sail past the positivity check and be emitted.
    if (!Number.isFinite(clip.absoluteStart) || !Number.isFinite(clip.absoluteEnd)) continue;
    const durationSec = Math.max(0, clip.absoluteEnd - clip.absoluteStart);
    if (durationSec <= 0 || !clip.src) continue;
    clips.push({
      src: clip.src,
      startSec: safeSeconds(clip.absoluteStart) + preRoll,
      sourceInSec: safeSeconds(clip.sourceIn),
      durationSec,
    });
  }

  return clips;
}

/** Clamp to a finite, non-negative second count. NaN/Infinity/negative → 0. */
function safeSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
