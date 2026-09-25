/**
 * Denoiser seam. Core defines the contract; engines (an RNNoise WASM build,
 * later possibly DeepFilterNet) live with the renderer, which injects a
 * factory. Keeping the model out of core keeps core dependency-free and lets
 * each surface ship the engine as a bundled asset.
 */

export interface Denoiser {
  /** Samples per frame the model consumes (RNNoise: 480 at 48 kHz). */
  readonly frameSize: number;
  /** Sample rate the model runs at. The chain feeds exactly this rate. */
  readonly sampleRate: number;
  /** Samples by which the model's output lags its input (beyond frame buffering). */
  readonly latency: number;
  /** Denoise one frame in place. Samples are floats in ±1. */
  processFrame(frame: Float32Array): void;
  dispose(): void;
}

export type DenoiserFactory = () => Promise<Denoiser>;

/**
 * Streaming wrapper for one channel: accepts any block size, returns a block
 * of the same size, delayed by {@link DenoiseStage.latency}. `strength`
 * blends the denoised signal with the equally delayed dry signal (RNNoise has
 * no strength control of its own), so partial settings never comb-filter.
 */
export interface DenoiseStage {
  readonly latency: number;
  process(block: Float32Array): Float32Array;
  dispose(): void;
}

class SampleFifo {
  private buffer: Float32Array;
  private start = 0;
  private end = 0;

  constructor(capacity: number) {
    this.buffer = new Float32Array(Math.max(16, capacity));
  }

  get length(): number {
    return this.end - this.start;
  }

  push(samples: Float32Array): void {
    if (this.end + samples.length > this.buffer.length) {
      const live = this.buffer.subarray(this.start, this.end);
      const next =
        live.length + samples.length > this.buffer.length
          ? new Float32Array((live.length + samples.length) * 2)
          : this.buffer;
      next.set(live, 0);
      this.buffer = next;
      this.end = live.length;
      this.start = 0;
    }
    this.buffer.set(samples, this.end);
    this.end += samples.length;
  }

  pushZeros(count: number): void {
    this.push(new Float32Array(count));
  }

  shift(count: number): Float32Array {
    const out = this.buffer.slice(this.start, this.start + count);
    this.start += count;
    return out;
  }
}

export function createDenoiseStage(denoiser: Denoiser, strength: number): DenoiseStage {
  const frameSize = denoiser.frameSize;
  const latency = frameSize + denoiser.latency;
  const wet = Math.min(1, Math.max(0, strength));
  const input = new SampleFifo(frameSize * 4);
  const output = new SampleFifo(frameSize * 4);
  const dry = new SampleFifo(frameSize * 4);
  // Prime so every call can return as many samples as it was given. The
  // model's own lag is already in its output stream, so output sample n is
  // the denoised input sample n - latency; the dry path is delayed to match.
  output.pushZeros(frameSize);
  dry.pushZeros(latency);
  const frame = new Float32Array(frameSize);

  return {
    latency,
    process(block) {
      input.push(block);
      dry.push(block);
      while (input.length >= frameSize) {
        frame.set(input.shift(frameSize));
        denoiser.processFrame(frame);
        output.push(frame);
      }
      const out = output.shift(block.length);
      const delayedDry = dry.shift(block.length);
      if (wet < 1) {
        for (let i = 0; i < out.length; i++) out[i] = wet * out[i] + (1 - wet) * delayedDry[i];
      }
      return out;
    },
    dispose: () => denoiser.dispose(),
  };
}
