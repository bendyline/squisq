/**
 * Streaming sample-rate conversion (windowed sinc, arbitrary ratio).
 *
 * The chain runs at 48 kHz (the denoiser's rate); sources recorded by
 * MediaRecorder already are, but MP3/M4A imports are often 44.1 kHz. The
 * kernel is symmetric, so output sample j is exactly time j / outRate — the
 * conversion adds no delay, which the time-aligned render contract requires.
 * A Blackman-windowed sinc, tabulated and linearly interpolated, low-passed
 * at the lower Nyquist when downsampling.
 */

const TABLE_RESOLUTION = 512;

export interface Resampler {
  readonly inRate: number;
  readonly outRate: number;
  /** Convert a block; returns however many output samples are now determined. */
  process(input: Float32Array): Float32Array;
  /** Emit the remaining output (call once, after the last block). */
  flush(): Float32Array;
}

export function createResampler(inRate: number, outRate: number, halfTaps = 16): Resampler {
  const ratio = inRate / outRate; // input samples per output sample
  const cutoff = Math.min(1, outRate / inRate);
  // Kernel support in input samples scales up when low-passing below input Nyquist.
  const half = Math.ceil(halfTaps / cutoff);
  const table = new Float32Array(half * TABLE_RESOLUTION + 2);
  for (let i = 0; i < table.length; i++) {
    const x = i / TABLE_RESOLUTION;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * cutoff * x) / (Math.PI * cutoff * x);
    const w =
      x >= half
        ? 0
        : 0.42 + 0.5 * Math.cos((Math.PI * x) / half) + 0.08 * Math.cos((2 * Math.PI * x) / half);
    table[i] = cutoff * sinc * w;
  }
  const kernel = (distance: number): number => {
    const pos = Math.abs(distance) * TABLE_RESOLUTION;
    const i = Math.floor(pos);
    if (i + 1 >= table.length) return 0;
    const frac = pos - i;
    return table[i] + (table[i + 1] - table[i]) * frac;
  };

  let buffer = new Float32Array(0);
  let bufferStart = 0; // absolute input index of buffer[0]
  let totalIn = 0;
  let nextOut = 0; // absolute output index
  let flushed = false;

  const produce = (final: boolean): Float32Array => {
    const out: number[] = [];
    const limit = final ? Math.ceil((totalIn * outRate) / inRate) : Number.POSITIVE_INFINITY;
    for (;;) {
      if (nextOut >= limit) break;
      const p = nextOut * ratio;
      const center = Math.floor(p);
      if (!final && center + half >= totalIn) break;
      let acc = 0;
      for (let k = center - half + 1; k <= center + half; k++) {
        const idx = k - bufferStart;
        if (idx < 0 || idx >= buffer.length) continue; // zero padding outside the signal
        acc += buffer[idx] * kernel(p - k);
      }
      out.push(acc);
      nextOut++;
    }
    // Drop input no future output can reach.
    const keepFrom = Math.floor(nextOut * ratio) - half;
    const drop = keepFrom - bufferStart;
    if (drop > 0) {
      const count = Math.min(drop, buffer.length);
      buffer = buffer.slice(count);
      bufferStart += count;
    }
    return Float32Array.from(out);
  };

  if (inRate === outRate) {
    return {
      inRate,
      outRate,
      process: (input) => input.slice(),
      flush: () => new Float32Array(0),
    };
  }

  return {
    inRate,
    outRate,
    process(input) {
      const merged = new Float32Array(buffer.length + input.length);
      merged.set(buffer, 0);
      merged.set(input, buffer.length);
      buffer = merged;
      totalIn += input.length;
      return produce(false);
    },
    flush() {
      if (flushed) return new Float32Array(0);
      flushed = true;
      return produce(true);
    },
  };
}
