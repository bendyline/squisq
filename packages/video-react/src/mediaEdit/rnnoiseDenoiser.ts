/**
 * RNNoise (BSD-3, via `@shiguredo/rnnoise-wasm`, Apache-2.0) behind core's
 * `Denoiser` seam.
 *
 * The WASM is embedded in the module (no runtime fetch), so it works offline
 * and under a CSP with `'wasm-unsafe-eval'`. How the module is loaded is the
 * caller's choice: the media-edit worker imports it statically (worker bundles
 * may be IIFE, which cannot code-split), while the main-thread fallback loads
 * it on demand so page bundles never carry it.
 *
 * RNNoise runs at 48 kHz on 480-sample frames and expects 16-bit-scaled
 * floats. Its output lags its input by two frames (960 samples, measured by
 * cross-correlating synthetic voiced speech; the overlap-add synthesis plus
 * one frame of look-ahead), which the adapter reports so the chain keeps the
 * render sample-aligned.
 */

import type { Denoiser, DenoiserFactory } from '@bendyline/squisq/mediaEdit';

const RNNOISE_SAMPLE_RATE = 48_000;
const RNNOISE_LATENCY = 960;
const PCM16_SCALE = 32768;

interface RnnoiseState {
  processFrame(frame: Float32Array): number;
  destroy(): void;
}

/** The loaded RNNoise module (`Rnnoise.load()`'s result). */
export interface RnnoiseModule {
  readonly frameSize: number;
  createDenoiseState(): RnnoiseState;
}

export type RnnoiseLoader = () => Promise<RnnoiseModule>;

/** A factory creating one independent RNNoise state per call (one per channel). */
export function createRnnoiseDenoiserFactory(load: RnnoiseLoader): DenoiserFactory {
  let loading: Promise<RnnoiseModule> | null = null;
  return async (): Promise<Denoiser> => {
    loading ??= load();
    const rnnoise = await loading;
    const state = rnnoise.createDenoiseState();
    return {
      frameSize: rnnoise.frameSize,
      sampleRate: RNNOISE_SAMPLE_RATE,
      latency: RNNOISE_LATENCY,
      processFrame(frame) {
        for (let i = 0; i < frame.length; i++) frame[i] *= PCM16_SCALE;
        state.processFrame(frame);
        for (let i = 0; i < frame.length; i++) frame[i] /= PCM16_SCALE;
      },
      dispose: () => state.destroy(),
    };
  };
}
