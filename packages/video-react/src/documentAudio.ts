/**
 * documentAudio — the doc → mixed `AudioBuffer` path shared by MP4 export and
 * hosts that export a document's audio on its own.
 *
 * One pipeline, three steps, so the two consumers cannot drift:
 *
 *  1. {@link documentAudioTimeline} schedules every clip the doc plays —
 *     `doc.audio.segments`, `documentMedia` and `block.media` (including the
 *     audio of scheduled video) — via `computeAudioTimeline`, substituting
 *     media-edit renders through `processedAudio` exactly as video export does.
 *  2. {@link loadAudioTimelineSources} reads each unique source once.
 *  3. {@link mixAudioTimeline} renders the mix with `renderAudioTimeline`
 *     (OfflineAudioContext), at least as long as the doc's timeline.
 *
 * {@link renderDocumentAudio} composes the three for hosts.
 */

import type { Doc, MediaScheduleOptions } from '@bendyline/squisq/schemas';
import { computeAudioTimeline, type AudioTimelineClip } from '@bendyline/squisq-video';
import { EXPORT_AUDIO_SAMPLE_RATE, renderAudioTimeline } from './audioTrack.js';

export interface DocumentAudioTimelineOptions {
  /** Seconds of leading silence before every clip (video export's cover pre-roll). */
  offsetSec?: number;
  /** Media-edit render lookup; an edited clip then mixes its processed audio. */
  processedAudio?: MediaScheduleOptions['processedAudio'];
}

/** Every audio clip the doc schedules, on the absolute timeline. `[]` when silent. */
export function documentAudioTimeline(
  doc: Doc,
  options: DocumentAudioTimelineOptions = {},
): AudioTimelineClip[] {
  const offset = options.offsetSec ?? 0;
  return options.processedAudio
    ? computeAudioTimeline(doc, offset, { processedAudio: options.processedAudio })
    : computeAudioTimeline(doc, offset);
}

export interface AudioTimelineSources {
  /** Bytes by `src`, for every source that could be read. */
  buffers: Map<string, ArrayBuffer>;
  /** Sources `readMedia` returned null for, in timeline order. */
  missing: string[];
}

/**
 * Read each unique source of `timeline` once, in timeline order. A source the
 * reader returns null for is reported in `missing`; a reader that throws
 * propagates. Checks `signal` between reads.
 */
export async function loadAudioTimelineSources(
  timeline: readonly AudioTimelineClip[],
  readMedia: (src: string) => Promise<ArrayBuffer | null>,
  signal?: AbortSignal,
): Promise<AudioTimelineSources> {
  const buffers = new Map<string, ArrayBuffer>();
  const missing: string[] = [];
  for (const src of new Set(timeline.map((clip) => clip.src))) {
    signal?.throwIfAborted();
    const data = await readMedia(src);
    if (data) buffers.set(src, data);
    else missing.push(src);
  }
  signal?.throwIfAborted();
  return { buffers, missing };
}

/** End of the last clip, or `minDurationSec` when that is later. */
export function audioTimelineEnd(
  timeline: readonly AudioTimelineClip[],
  minDurationSec = 0,
): number {
  const floor = Number.isFinite(minDurationSec) ? Math.max(0, minDurationSec) : 0;
  return timeline.reduce((end, clip) => Math.max(end, clip.startSec + clip.durationSec), floor);
}

/**
 * Mix a timeline into one stereo `AudioBuffer` spanning at least
 * `minDurationSec`. Null when no scheduled source contributed audio (every
 * one a silent video).
 */
export function mixAudioTimeline(
  timeline: AudioTimelineClip[],
  buffers: Map<string, ArrayBuffer>,
  minDurationSec: number,
  sampleRate: number = EXPORT_AUDIO_SAMPLE_RATE,
): Promise<AudioBuffer | null> {
  return renderAudioTimeline(
    timeline,
    buffers,
    audioTimelineEnd(timeline, minDurationSec),
    sampleRate,
  );
}

export interface RenderDocumentAudioOptions {
  /** Read a media file referenced by the doc (relative src), or null if missing. */
  readMedia(src: string): Promise<ArrayBuffer | null>;
  /** Mix sample rate (default 48000). */
  readonly sampleRate?: number;
  readonly signal?: AbortSignal;
  /**
   * Media-edit render lookup (`fx` recipes), as `VideoExportConfig.processedAudio`:
   * an edited clip mixes its processed render instead of its source. Hosts
   * typically pass `createMediaEditRenderManager(...).processedAudio` after
   * awaiting pending renders. Omitted → original audio everywhere.
   */
  readonly processedAudio?: MediaScheduleOptions['processedAudio'];
  /**
   * What to do when `readMedia` returns null for a scheduled source.
   * `'error'` (default) rejects, naming the missing files; `'skip'` mixes
   * whatever could be read.
   */
  readonly missingMedia?: 'error' | 'skip';
}

/**
 * Mix every audio clip the doc schedules (`doc.audio.segments`,
 * `documentMedia`, `block.media`) on the doc's timeline, honoring media-edit
 * renders the same way video export does. The result spans the doc's duration
 * (or the last clip's end, if later). Null when the doc has no audio.
 *
 * Pass the same prepared doc video export would get — narration timing and
 * audio mapping already resolved (`resolveAudioMapping`).
 */
export async function renderDocumentAudio(
  doc: Doc,
  options: RenderDocumentAudioOptions,
): Promise<AudioBuffer | null> {
  const { signal } = options;
  signal?.throwIfAborted();
  const timeline = documentAudioTimeline(
    doc,
    options.processedAudio ? { processedAudio: options.processedAudio } : {},
  );
  if (timeline.length === 0) return null;

  const { buffers, missing } = await loadAudioTimelineSources(
    timeline,
    (src) => options.readMedia(src),
    signal,
  );
  try {
    if (missing.length > 0 && (options.missingMedia ?? 'error') === 'error') {
      throw new Error(`Audio files could not be loaded: ${missing.join(', ')}`);
    }
    const playable = timeline.filter((clip) => buffers.has(clip.src));
    if (playable.length === 0) return null;
    const mixed = await mixAudioTimeline(
      playable,
      buffers,
      doc.duration,
      options.sampleRate ?? EXPORT_AUDIO_SAMPLE_RATE,
    );
    signal?.throwIfAborted();
    return mixed;
  } finally {
    buffers.clear();
  }
}
