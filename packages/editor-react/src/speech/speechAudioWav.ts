/**
 * Normalize a MediaRecorder take into the speech-input wire format: mono
 * 16-bit PCM WAV at 16 kHz.
 *
 * Adapted from Gezel's `packages/ui/src/components/speech-audio-wav.ts`, which
 * kept the capture rate. This version resamples to 16 kHz — the rate Whisper
 * models are trained on — so any whisper.cpp build accepts the file without
 * shelling out to ffmpeg, and a take crosses IPC at a third of the size.
 *
 * Chromium records microphone audio as WebM/Opus and can decode its own
 * recording formats, so the browser does the decode; an `OfflineAudioContext`
 * at 16 kHz does the resample.
 */

import { SPEECH_INPUT_SAMPLE_RATE } from './types.js';

/** Decode a recorded take and re-encode it as 16 kHz mono PCM16 WAV bytes. */
export async function microphoneTakeAsWav(blob: Blob): Promise<ArrayBuffer> {
  const encoded = await blobBytes(blob);
  let audio: AudioBuffer;
  try {
    audio = await decodeAt16k(encoded);
  } catch (caught) {
    const detail = caught instanceof Error && caught.message ? ` (${caught.message})` : '';
    throw new Error(`This recording could not be prepared for speech recognition${detail}`);
  }
  const channels = Array.from({ length: audio.numberOfChannels }, (_, index) =>
    audio.getChannelData(index),
  );
  const mono = downmixToMono(channels);
  const samples =
    audio.sampleRate === SPEECH_INPUT_SAMPLE_RATE
      ? mono
      : resampleLinear(mono, audio.sampleRate, SPEECH_INPUT_SAMPLE_RATE);
  return encodeMonoPcm16Wav([samples], SPEECH_INPUT_SAMPLE_RATE).buffer;
}

/** `Blob.arrayBuffer()`, with a `FileReader` fallback for engines that lack it. */
function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) resolve(result);
      else reject(new Error('The recording could not be read.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('The recording could not be read.'));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Decode with an `OfflineAudioContext` running at 16 kHz: `decodeAudioData`
 * resamples to its context's rate, so the decoded buffer is already at the
 * target rate. Where only a realtime `AudioContext` exists, decode at its rate
 * and let the caller resample linearly.
 */
async function decodeAt16k(encoded: ArrayBuffer): Promise<AudioBuffer> {
  if (typeof OfflineAudioContext !== 'undefined') {
    let offline: OfflineAudioContext | null = null;
    try {
      offline = new OfflineAudioContext(1, 1, SPEECH_INPUT_SAMPLE_RATE);
    } catch {
      // An engine that refuses a 16 kHz offline context falls through to the
      // realtime decode + linear resample below.
      offline = null;
    }
    if (offline) return offline.decodeAudioData(encoded);
  }
  if (typeof AudioContext === 'undefined') {
    throw new Error('Web Audio is unavailable');
  }
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(encoded);
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** Average equal-length channels into one. */
export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  const sampleCount = channels[0]?.length ?? 0;
  if (channels.length === 0 || sampleCount === 0) {
    throw new Error('The microphone recording was empty.');
  }
  if (channels.length === 1) return channels[0];
  if (channels.some((channel) => channel.length !== sampleCount)) {
    throw new Error('The microphone recording channels have different lengths.');
  }
  const mono = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[index] ?? 0;
    mono[index] = sum / channels.length;
  }
  return mono;
}

/**
 * Linear-interpolation resampler — the fallback when no `OfflineAudioContext`
 * resampled during decode. Adequate for speech recognition, which is far less
 * sensitive to resampling artefacts than listening is.
 */
export function resampleLinear(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (!Number.isFinite(fromRate) || fromRate <= 0 || !Number.isFinite(toRate) || toRate <= 0) {
    throw new Error('The microphone recording has an invalid sample rate.');
  }
  if (fromRate === toRate) return samples;
  const outputLength = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const output = new Float32Array(outputLength);
  const step = fromRate / toRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * step;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const fraction = position - left;
    const a = samples[Math.min(left, samples.length - 1)] ?? 0;
    const b = samples[right] ?? 0;
    output[index] = a + (b - a) * fraction;
  }
  return output;
}

/** Encode (and down-mix) float channels as a mono 16-bit PCM RIFF/WAVE file. */
export function encodeMonoPcm16Wav(
  channels: readonly Float32Array[],
  sampleRate: number,
): Uint8Array<ArrayBuffer> {
  const sampleCount = channels[0]?.length ?? 0;
  if (channels.length === 0 || sampleCount === 0) {
    throw new Error('The microphone recording was empty.');
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('The microphone recording has an invalid sample rate.');
  }
  if (channels.some((channel) => channel.length !== sampleCount)) {
    throw new Error('The microphone recording channels have different lengths.');
  }

  const rate = Math.round(sampleRate);
  const bytesPerSample = 2;
  const dataBytes = sampleCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // linear PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let index = 0; index < sampleCount; index += 1) {
    let mono = 0;
    for (const channel of channels) mono += channel[index] ?? 0;
    mono = Math.max(-1, Math.min(1, mono / channels.length));
    const pcm = mono < 0 ? Math.round(mono * 0x8000) : Math.round(mono * 0x7fff);
    view.setInt16(44 + index * bytesPerSample, pcm, true);
  }

  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
