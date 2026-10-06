/**
 * Streaming 16-bit PCM WAV writer.
 *
 * Planar float32 blocks are interleaved and quantized as they arrive into a
 * fixed scratch buffer; each full buffer becomes a `Blob` part, which browsers
 * may keep outside the JS heap. The 44-byte RIFF header is only written at
 * {@link WavStreamWriter.finish}, once the final data size is known, and is
 * prepended as the first part — so nothing is ever patched in place and the
 * whole file never exists as one float32 (or even one int16) array.
 */

const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;
/** RIFF sizes are u32; the RIFF size field holds `36 + dataBytes`. */
export const MAX_WAV_DATA_BYTES = 0xffff_ffff - 36;
const DEFAULT_CHUNK_BYTES = 1 << 20;

export interface WavStreamWriter {
  /** Bytes of PCM data written so far (header excluded). */
  readonly dataBytes: number;
  /** Append one planar block: one equal-length Float32Array per channel. */
  append(channels: readonly Float32Array[]): void;
  /** Header + data as one Blob. The writer is spent afterwards. */
  finish(): Blob;
}

/** The canonical 44-byte PCM WAV header for `dataBytes` of 16-bit samples. */
export function wavHeader(
  sampleRate: number,
  channels: number,
  dataBytes: number,
): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(HEADER_BYTES);
  const view = new DataView(header.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  const blockAlign = channels * BYTES_PER_SAMPLE;
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // format: integer PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return header;
}

/** Float sample → 16-bit PCM, clamped; NaN becomes silence. */
function toPcm16(sample: number): number {
  if (!(sample > -1)) return sample <= -1 ? -32768 : 0;
  if (sample >= 1) return 32767;
  return Math.round(sample < 0 ? sample * 32768 : sample * 32767);
}

export function createWavStreamWriter(
  sampleRate: number,
  channels: number,
  options: { chunkBytes?: number } = {},
): WavStreamWriter {
  const blockAlign = channels * BYTES_PER_SAMPLE;
  // Whole frames per scratch buffer, so a frame never straddles two parts.
  const chunkFrames = Math.max(
    1,
    Math.floor((options.chunkBytes ?? DEFAULT_CHUNK_BYTES) / blockAlign),
  );
  const scratch = new ArrayBuffer(chunkFrames * blockAlign);
  const view = new DataView(scratch);
  const parts: Blob[] = [];
  let pendingFrames = 0;
  let dataBytes = 0;
  let finished = false;

  const flushScratch = (): void => {
    if (pendingFrames === 0) return;
    // Blob copies the bytes, so the scratch buffer is reusable immediately.
    parts.push(new Blob([new Uint8Array(scratch, 0, pendingFrames * blockAlign)]));
    pendingFrames = 0;
  };

  return {
    get dataBytes() {
      return dataBytes;
    },
    append(planar) {
      if (finished) throw new Error('The WAV writer is already finished.');
      const frames = planar[0]?.length ?? 0;
      if (frames === 0) return;
      if (dataBytes + frames * blockAlign > MAX_WAV_DATA_BYTES) {
        throw new RangeError('WAV files cannot exceed 4 GiB; use a compressed format instead.');
      }
      for (let frame = 0; frame < frames; frame++) {
        let offset = pendingFrames * blockAlign;
        for (let c = 0; c < channels; c++) {
          view.setInt16(offset, toPcm16(planar[c][frame]), true);
          offset += BYTES_PER_SAMPLE;
        }
        pendingFrames += 1;
        if (pendingFrames === chunkFrames) flushScratch();
      }
      dataBytes += frames * blockAlign;
    },
    finish() {
      if (finished) throw new Error('The WAV writer is already finished.');
      finished = true;
      flushScratch();
      const blob = new Blob([wavHeader(sampleRate, channels, dataBytes), ...parts], {
        type: 'audio/wav',
      });
      parts.length = 0;
      return blob;
    },
  };
}
