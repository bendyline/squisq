/**
 * Decode a media file's audio track into the chain's input: 48 kHz planar
 * blocks laid on the MEDIA timeline, so render sample n is media time
 * n / 48000 — the same clock `<audio>` / `<video>` `currentTime` uses.
 *
 * Samples are placed by their container timestamps: a gap (a late first
 * sample, a dropped packet) becomes silence, an overlap (encoder priming with
 * negative timestamps) is trimmed. Only the audio track is demuxed (mediabunny,
 * streaming from the Blob), so a long screen recording is never loaded or
 * decoded whole. More than two channels are reduced to the first two.
 */

import { ALL_FORMATS, AudioSampleSink, BlobSource, Input } from 'mediabunny';
import {
  MEDIA_FX_SAMPLE_RATE,
  createResampler,
  type MediaFxSource,
} from '@bendyline/squisq/mediaEdit';

export interface DecodedAudioSource extends MediaFxSource {
  /** Frames at 48 kHz this source yields (exact). */
  frames: number;
  /** Length of the decoded window in seconds. */
  durationSec: number;
  /** Whole-track duration in seconds. */
  trackDurationSec: number;
  sourceSampleRate: number;
  dispose(): void;
}

export interface OpenMediaAudioOptions {
  /** Window start in media seconds. Default 0. */
  startSec?: number;
  /** Window end in media seconds. Default: the track's end. */
  endSec?: number;
}

/** Open a media Blob's primary audio track; null when it has none. */
export async function openMediaAudio(
  blob: Blob,
  options: OpenMediaAudioOptions = {},
): Promise<DecodedAudioSource | null> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const track = await input.getPrimaryAudioTrack();
  if (!track) {
    input.dispose();
    return null;
  }
  const trackDurationSec = await track.computeDuration();
  const sourceRate = track.sampleRate;
  const channels = Math.min(2, Math.max(1, track.numberOfChannels));
  const startSec = Math.max(0, options.startSec ?? 0);
  const endSec = Math.max(startSec, Math.min(options.endSec ?? trackDurationSec, trackDurationSec));
  const durationSec = endSec - startSec;
  const frames = Math.round(durationSec * MEDIA_FX_SAMPLE_RATE);
  const sourceFrames = Math.round(durationSec * sourceRate);

  async function* open(): AsyncGenerator<Float32Array[]> {
    const sink = new AudioSampleSink(track as NonNullable<typeof track>);
    const resamplers = Array.from({ length: channels }, () =>
      createResampler(sourceRate, MEDIA_FX_SAMPLE_RATE),
    );
    let placed = 0; // source-rate frames emitted, relative to startSec
    let emitted = 0; // 48 kHz frames yielded

    const feed = (planes: Float32Array[]): Float32Array[] | null => {
      const out = resamplers.map((r, c) => r.process(planes[c]));
      const room = frames - emitted;
      const take = Math.min(out[0].length, room);
      if (take <= 0) return null;
      emitted += take;
      return out.map((ch) => (ch.length === take ? ch : ch.subarray(0, take)));
    };

    for await (const sample of sink.samples(startSec, endSec)) {
      try {
        const at = Math.round((sample.timestamp - startSec) * sourceRate);
        let planes = Array.from({ length: channels }, (_, c) => {
          const plane = new Float32Array(sample.numberOfFrames);
          sample.copyTo(plane, {
            planeIndex: Math.min(c, sample.numberOfChannels - 1),
            format: 'f32-planar',
          });
          return plane;
        });
        if (at > placed) {
          const gap = Math.min(at - placed, sourceFrames - placed);
          if (gap > 0) {
            const out = feed(Array.from({ length: channels }, () => new Float32Array(gap)));
            placed += gap;
            if (out) yield out;
          }
        }
        const overlap = placed - at;
        if (overlap > 0) planes = planes.map((p) => p.subarray(Math.min(overlap, p.length)));
        const room = sourceFrames - placed;
        if (room <= 0) break;
        if (planes[0].length > room) planes = planes.map((p) => p.subarray(0, room));
        if (planes[0].length === 0) continue;
        placed += planes[0].length;
        const out = feed(planes);
        if (out) yield out;
      } finally {
        sample.close();
      }
    }
    // Pad a short track to the window, then drain the resamplers.
    if (placed < sourceFrames) {
      const out = feed(
        Array.from({ length: channels }, () => new Float32Array(sourceFrames - placed)),
      );
      if (out) yield out;
    }
    const tail = resamplers.map((r) => r.flush());
    const room = frames - emitted;
    if (room > 0) {
      const padded = tail.map((ch) => {
        const full = new Float32Array(room);
        full.set(ch.subarray(0, room));
        return full;
      });
      emitted += room;
      yield padded;
    }
  }

  return {
    sampleRate: MEDIA_FX_SAMPLE_RATE,
    channels,
    frames,
    durationSec,
    trackDurationSec,
    sourceSampleRate: sourceRate,
    open,
    dispose: () => input.dispose(),
  };
}
