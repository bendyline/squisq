/**
 * audioMix — Build the MP4's final audio track from a doc's audio timeline.
 *
 * The schedule is produced by ONE source of truth: `computeAudioTimeline`
 * (from `@bendyline/squisq-video`), which flattens a doc's narration segments
 * (laid sequentially) and its timed media clips (placed at absolute positions
 * via `resolveMediaSchedule`) into a flat list of absolute-timed
 * `AudioTimelineClip`s. This CLI-side helper is a pure *consumer* of that
 * schedule: it loads each clip's bytes and assembles an ffmpeg `amix`
 * filtergraph where every clip is trimmed to its source window and delayed to
 * its absolute start.
 *
 * Because the browser MP4 export and this CLI mix now read the same timeline,
 * their audio placement can no longer drift. In particular, zero-duration
 * narration segments are skipped here exactly as they are in the browser
 * (`computeAudioTimeline` never emits a clip with `durationSec <= 0`).
 *
 * Frame capture stays silent — this reconstructs the audio offline from the
 * same schedule the renderer uses, keeping audio and video aligned.
 */

import type { Doc } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { computeAudioTimeline } from '@bendyline/squisq-video';
import type { AudioTimelineClip } from '@bendyline/squisq-video';
import { runFfmpeg } from './runFfmpeg.js';

/**
 * Build the final mixed MP3 audio track for a doc's MP4 export.
 *
 * Drives the ffmpeg filtergraph entirely from `computeAudioTimeline(doc,
 * coverPreRoll)`: each clip's `startSec` → `adelay`, `sourceInSec` → `atrim`
 * start, `durationSec` → `atrim` duration, keyed by `src`. All clips are summed
 * with `amix` (`normalize=0` so individual levels are preserved).
 *
 * @param doc - The document whose audio to schedule.
 * @param container - Media container to read each clip's `src` bytes from.
 * @param ffmpegPath - Path to the ffmpeg binary.
 * @param coverPreRoll - Seconds of cover-slide pre-roll; shifts every clip's
 *   start (matching the silent leading frames).
 * @returns The mixed MP3 bytes, or `null` when the doc has no audio to place.
 */
export async function buildMixedAudioTrack(
  doc: Doc,
  container: ContentContainer,
  ffmpegPath: string,
  coverPreRoll: number,
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  signal?.throwIfAborted();
  // The native mixer currently consumes authored audio files. Browser MP4
  // export additionally demuxes the audio stream carried by video clips.
  const timeline = computeAudioTimeline(doc, coverPreRoll, { includeVideoAudio: false });
  if (timeline.length === 0) return null;

  // Load each clip's bytes, caching reads by `src` (a src may back several clips).
  const bytesBySrc = new Map<string, ArrayBuffer | null>();
  const readSrc = async (src: string): Promise<ArrayBuffer | null> => {
    signal?.throwIfAborted();
    if (bytesBySrc.has(src)) return bytesBySrc.get(src)!;
    const data = await container.readFile(src);
    signal?.throwIfAborted();
    bytesBySrc.set(src, data ?? null);
    return data ?? null;
  };

  const usable: Array<{ clip: AudioTimelineClip; buffer: ArrayBuffer }> = [];
  for (const clip of timeline) {
    signal?.throwIfAborted();
    const buffer = await readSrc(clip.src);
    if (buffer) usable.push({ clip, buffer });
  }
  if (usable.length === 0) return null;

  return mixTimelineClips(ffmpegPath, usable, signal);
}

/** Assemble the ffmpeg `amix` filtergraph and run it, returning the mixed MP3. */
async function mixTimelineClips(
  ffmpegPath: string,
  usable: Array<{ clip: AudioTimelineClip; buffer: ArrayBuffer }>,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const { writeFile, readFile, mkdir, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const { randomBytes } = await import('node:crypto');
  signal?.throwIfAborted();

  const workDir = join(tmpdir(), `squisq-audio-mix-${randomBytes(8).toString('hex')}`);
  await mkdir(workDir, { recursive: true });

  const ms = (s: number) => Math.max(0, Math.round(s * 1000));

  try {
    signal?.throwIfAborted();
    const inputs: string[] = [];
    const filters: string[] = [];
    const labels: string[] = [];

    for (const { clip, buffer } of usable) {
      signal?.throwIfAborted();
      const p = join(workDir, `clip-${inputs.length}.mp3`);
      await writeFile(p, new Uint8Array(buffer));
      signal?.throwIfAborted();
      const i = inputs.push(p) - 1;
      const delayMs = ms(clip.startSec);
      const start = Math.max(0, clip.sourceInSec);
      const end = start + Math.max(0, clip.durationSec);
      filters.push(
        `[${i}:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs}[a${i}]`,
      );
      labels.push(`[a${i}]`);
    }

    const graph =
      `${filters.join(';')};${labels.join('')}` +
      `amix=inputs=${labels.length}:normalize=0:dropout_transition=0[aout]`;

    const outputPath = join(workDir, 'mixed.mp3');
    const args = ['-y'];
    for (const p of inputs) args.push('-i', p);
    args.push(
      '-filter_complex',
      graph,
      '-map',
      '[aout]',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '192k',
      outputPath,
    );

    await runFfmpeg(ffmpegPath, args, {
      timeoutMs: 180_000,
      failureMessage: 'ffmpeg audio mix failed',
      signal,
    });

    signal?.throwIfAborted();
    const data = await readFile(outputPath);
    signal?.throwIfAborted();
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
