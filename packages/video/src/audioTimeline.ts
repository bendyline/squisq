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
 *    `resolveMediaSchedule()` helper, honouring each clip's trim window
 *    (`sourceIn` / `absoluteEnd - absoluteStart`). This includes the audio
 *    stream carried by scheduled video clips unless explicitly disabled.
 *  - Every start time is shifted by `coverPreRoll` so a cover pre-roll padding
 *    (silent leading frames) keeps audio in sync.
 */

import type { Doc } from '@bendyline/squisq/schemas';
import { resolveMediaSchedule } from '@bendyline/squisq/schemas';
import { flattenRenderableBlocks, materializeBlockLayers } from '@bendyline/squisq/doc';

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
  /**
   * Video sources may legitimately contain no audio stream. The browser mixer
   * probes them independently and skips only the silent ones. Omitted means an
   * authored audio/narration source, whose decode failure remains an error.
   */
  sourceKind?: 'video';
}

export interface ComputeAudioTimelineOptions {
  /**
   * Include the audio stream carried by scheduled video clips. Defaults to
   * true for composed MP4 export. Consumers that cannot demux video audio may
   * explicitly retain the legacy audio-only behavior.
   */
  includeVideoAudio?: boolean;
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
export function computeAudioTimeline(
  doc: Doc,
  coverPreRoll = 0,
  options: ComputeAudioTimelineOptions = {},
): AudioTimelineClip[] {
  const preRoll = safeSeconds(coverPreRoll);
  const includeVideoAudio = options.includeVideoAudio ?? true;
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
    if (clip.kind !== 'audio' && !includeVideoAudio) continue;
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
      ...(clip.kind === 'video' ? { sourceKind: 'video' as const } : {}),
    });
  }

  // Content/template videos are rendered as VideoLayers rather than MediaClips.
  // Frame capture sees those layers, but resolveMediaSchedule intentionally
  // does not. Materialize the exact layer graph the renderer consumes so the
  // video's audio stream follows its visible source into the composed MP4.
  if (includeVideoAudio) {
    const blocks = flattenRenderableBlocks(doc.blocks);
    const existing = new Set(clips.map(timelineKey));
    blocks.forEach((block, blockIndex) => {
      const materialized = materializeBlockLayers(block, {
        blockIndex,
        totalBlocks: blocks.length,
        customTemplates: doc.customTemplates,
        persistentLayers: false,
      });
      for (const layer of materialized.layers) {
        if (layer.type !== 'video' || !layer.content.src) continue;
        const startAt = safeSeconds(layer.content.startAt ?? 0);
        const sourceInSec = safeSeconds(layer.content.clipStart);
        const clipDuration = Math.max(0, layer.content.clipEnd - sourceInSec);
        const blockRemainder = Math.max(0, safeSeconds(block.duration) - startAt);
        const durationSec = layer.content.spillover
          ? clipDuration
          : Math.min(clipDuration, blockRemainder);
        if (durationSec <= 0) continue;
        const candidate: AudioTimelineClip = {
          src: layer.content.src,
          startSec: safeSeconds(block.startTime) + startAt + preRoll,
          sourceInSec,
          durationSec,
          sourceKind: 'video',
        };
        const key = timelineKey(candidate);
        if (existing.has(key)) continue;
        existing.add(key);
        clips.push(candidate);
      }
    });
  }

  return clips;
}

function timelineKey(clip: AudioTimelineClip): string {
  return `${clip.src}\u0000${clip.startSec}\u0000${clip.sourceInSec}\u0000${clip.durationSec}`;
}

/** Clamp to a finite, non-negative second count. NaN/Infinity/negative → 0. */
function safeSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
