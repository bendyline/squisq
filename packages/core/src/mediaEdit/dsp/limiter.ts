/**
 * Look-ahead true-peak limiter (streaming, multi-channel, linked).
 *
 * Peaks are estimated between samples by 4× polyphase windowed-sinc
 * interpolation, so the ceiling holds for the reconstructed waveform, not
 * just the stored samples. The gain needed at each instant is the sliding
 * minimum of `ceiling / peak` over the next `lookahead` samples, box-smoothed
 * over the same length — every smoothing window that averages into sample
 * `t` also saw `t`'s own requirement, so the smoothed gain never exceeds it.
 * A one-pole release then lets gain recover slowly. The signal is delayed by
 * the look-ahead; {@link Limiter.flush} drains the tail.
 */

const OVERSAMPLE = 4;
const TAPS_PER_PHASE = 8;

/** Polyphase windowed-sinc interpolation kernels for fractional phases 1..3. */
function interpolationKernels(): Float32Array[] {
  const kernels: Float32Array[] = [];
  const half = TAPS_PER_PHASE / 2;
  for (let phase = 1; phase < OVERSAMPLE; phase++) {
    const frac = phase / OVERSAMPLE;
    const k = new Float32Array(TAPS_PER_PHASE);
    let sum = 0;
    for (let t = 0; t < TAPS_PER_PHASE; t++) {
      // Tap t multiplies x[n - half + 1 + t]; its distance from the target point.
      const x = t - (half - 1) - frac;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 * (1 + Math.cos((Math.PI * x) / half)); // Hann over ±half
      k[t] = sinc * w;
      sum += k[t];
    }
    for (let t = 0; t < TAPS_PER_PHASE; t++) k[t] /= sum;
    kernels.push(k);
  }
  return kernels;
}

export interface LimiterOptions {
  sampleRate: number;
  channels: number;
  /** Ceiling in dBTP. Default −1. */
  ceilingDb?: number;
  /** Look-ahead in ms. Default 5. */
  lookaheadMs?: number;
  /** Release time constant in ms. Default 80. */
  releaseMs?: number;
}

export interface Limiter {
  /** Delay the limiter adds, in samples. */
  readonly latency: number;
  /** Process a block; returns the (delayed) limited output of the same length. */
  process(channels: readonly Float32Array[]): Float32Array[];
  /** Drain the delayed tail (`latency` samples per channel). */
  flush(): Float32Array[];
  /** Smallest gain applied so far (1 = never limited). */
  minGain(): number;
}

export function createLimiter(options: LimiterOptions): Limiter {
  const channelCount = options.channels;
  const ceiling = Math.pow(10, (options.ceilingDb ?? -1) / 20);
  const lookahead = Math.max(
    1,
    Math.round(((options.lookaheadMs ?? 5) / 1000) * options.sampleRate),
  );
  const releaseCoeff = Math.exp(-1 / (((options.releaseMs ?? 80) / 1000) * options.sampleRate));
  const kernels = interpolationKernels();
  const half = TAPS_PER_PHASE / 2;

  // History for interpolation (per channel), required-gain ring for the
  // sliding min (monotonic deque over absolute indices), and a ring of window
  // minima for the box average.
  const history = Array.from({ length: channelCount }, () => new Float32Array(TAPS_PER_PHASE));
  // The peak estimate at step n describes samples n - half and n - half + 1,
  // so the audio path waits `half` samples longer than the gain path.
  const delaySize = lookahead + half;
  const delay = Array.from({ length: channelCount }, () => new Float32Array(delaySize));
  const required = new Float64Array(lookahead);
  const dequeIdx = new Int32Array(lookahead + 1);
  let dqHead = 0;
  let dqTail = 0;
  const minRing = new Float64Array(lookahead).fill(1);
  let minSum = lookahead;
  let n = 0; // absolute input sample index
  let gain = 1;
  let smallest = 1;

  const truePeak = (sample: number, c: number): number => {
    const h = history[c];
    h.copyWithin(0, 1);
    h[TAPS_PER_PHASE - 1] = sample;
    // Interpolated points between h[half-1] and h[half] (TAPS/2 samples ago).
    let peak = Math.max(Math.abs(h[half - 1]), Math.abs(h[half]));
    for (const k of kernels) {
      let v = 0;
      for (let t = 0; t < TAPS_PER_PHASE; t++) v += k[t] * h[t];
      peak = Math.max(peak, Math.abs(v));
    }
    return peak;
  };

  const step = (input: readonly number[], out: Float32Array[], i: number) => {
    let peak = 0;
    for (let c = 0; c < channelCount; c++) peak = Math.max(peak, truePeak(input[c], c));
    const r = peak > ceiling ? ceiling / peak : 1;
    const slot = n % lookahead;
    // Sliding minimum of the requirements over [n - lookahead + 1, n]: expire
    // the oldest index first, then keep the deque's values increasing.
    const cap = lookahead + 1;
    while (dqTail > dqHead && dequeIdx[dqHead % cap] <= n - lookahead) dqHead++;
    required[slot] = r;
    while (dqTail > dqHead && required[dequeIdx[(dqTail - 1) % cap] % lookahead] >= r) dqTail--;
    dequeIdx[dqTail % cap] = n;
    dqTail++;
    const windowMin = required[dequeIdx[dqHead % cap] % lookahead];
    // Box average of the last `lookahead` window minima → gain for sample n - lookahead + 1.
    minSum += windowMin - minRing[slot];
    minRing[slot] = windowMin;
    const smoothed = Math.min(1, minSum / lookahead);
    gain = smoothed < gain ? smoothed : smoothed + (gain - smoothed) * releaseCoeff;
    if (gain < smallest) smallest = gain;
    // Store sample n; emit sample n - lookahead + 1 - half, the one this gain protects.
    const writeSlot = n % delaySize;
    const readSlot = (n + 1) % delaySize;
    for (let c = 0; c < channelCount; c++) {
      const d = delay[c];
      d[writeSlot] = input[c];
      out[c][i] = d[readSlot] * gain;
    }
    n++;
  };

  const run = (channels: readonly Float32Array[], length: number): Float32Array[] => {
    const out = Array.from({ length: channelCount }, () => new Float32Array(length));
    const frame = new Array<number>(channelCount).fill(0);
    for (let i = 0; i < length; i++) {
      for (let c = 0; c < channelCount; c++) frame[c] = channels[c]?.[i] ?? 0;
      step(frame, out, i);
    }
    return out;
  };

  return {
    latency: lookahead - 1 + half,
    process: (channels) => run(channels, channels[0]?.length ?? 0),
    flush: () => run([], lookahead - 1 + half),
    minGain: () => smallest,
  };
}
