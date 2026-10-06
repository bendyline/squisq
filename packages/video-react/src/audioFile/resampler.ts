/**
 * Streaming sample-rate converter for the audio-file encoder.
 *
 * WebCodecs AAC encoders accept only 44.1/48 kHz, while TTS engines commonly
 * produce 24 kHz. The encoder therefore resamples in-stream so callers can
 * append PCM at whatever rate they have. This is a band-limited (windowed-sinc,
 * Blackman window) converter rather than linear interpolation: linear
 * interpolation dulls speech above a few kHz and leaves aliased images that a
 * lossy encoder then spends bits on.
 *
 * Streaming contract: {@link StreamingResampler.process} returns every output
 * frame its input fully determines, keeping only a short history tail between
 * calls, so memory stays bounded no matter how long the stream runs. Chunk
 * boundaries are invisible: feeding a signal in pieces yields exactly the same
 * output as feeding it whole. {@link StreamingResampler.flush} emits the tail,
 * for a total of `ceil(inputFrames * outputRate / inputRate)` frames.
 *
 * Pure and dependency-free (no Web Audio), so it runs in Node tests.
 */

/** Kernel half-width, in input samples, at unity ratio (wider when downsampling). */
const HALF_TAPS = 16;
/** Passband edge as a fraction of the lower Nyquist frequency. */
const ROLLOFF = 0.94;
/** Above this many distinct output phases, phases are quantized to this many. */
const MAX_PHASES = 4096;

export interface StreamingResampler {
  readonly inputRate: number;
  readonly outputRate: number;
  /** Feed input frames; returns the output frames they complete (possibly none). */
  process(input: Float32Array): Float32Array;
  /** End of stream: returns the remaining output frames. The resampler is spent afterwards. */
  flush(): Float32Array;
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function assertRate(name: string, rate: number): void {
  if (!Number.isInteger(rate) || rate <= 0) {
    throw new RangeError(`${name} must be a positive integer number of hertz (got ${rate}).`);
  }
}

/** Number of output frames a stream of `inputFrames` resamples to. */
export function resampledLength(
  inputFrames: number,
  inputRate: number,
  outputRate: number,
): number {
  return Math.ceil((inputFrames * outputRate) / inputRate);
}

/** Create a single-channel streaming resampler. Use one per channel. */
export function createResampler(inputRate: number, outputRate: number): StreamingResampler {
  assertRate('inputRate', inputRate);
  assertRate('outputRate', outputRate);

  const divisor = gcd(inputRate, outputRate);
  // Output frame n sits at input position n * step = n * stepNum / phaseDen.
  const stepNum = inputRate / divisor;
  const phaseDen = outputRate / divisor;
  const phaseCount = Math.min(phaseDen, MAX_PHASES);
  const ratio = Math.min(1, outputRate / inputRate);
  const cutoff = ratio * ROLLOFF;
  const halfWidth = Math.ceil(HALF_TAPS / ratio);
  const taps = halfWidth * 2;
  const filters: Array<Float32Array | undefined> = new Array(phaseCount);

  /** Normalized taps for a fractional position `frac` ∈ [0, 1). */
  const buildFilter = (frac: number): Float32Array => {
    const filter = new Float32Array(taps);
    let sum = 0;
    for (let j = 0; j < taps; j++) {
      // Distance from the output position to input sample (base - halfWidth + 1 + j).
      const d = frac + (halfWidth - 1 - j);
      const x = d / halfWidth;
      const window = 0.42 + 0.5 * Math.cos(Math.PI * x) + 0.08 * Math.cos(2 * Math.PI * x);
      const arg = Math.PI * cutoff * d;
      const sinc = arg === 0 ? 1 : Math.sin(arg) / arg;
      const weight = cutoff * sinc * window;
      filter[j] = weight;
      sum += weight;
    }
    // Unity DC gain at every phase, so a constant signal stays constant.
    for (let j = 0; j < taps; j++) filter[j] /= sum;
    return filter;
  };

  // History of input samples covering absolute indices [bufferStart, received).
  // Indices below 0 are the implicit silence before the stream starts.
  let buffer = new Float32Array(Math.max(1024, taps * 4));
  let bufferStart = -(halfWidth - 1);
  let bufferLength = halfWidth - 1; // the leading silence, already zeroed
  let received = 0;
  let nextOutput = 0;
  let flushed = false;

  const append = (input: Float32Array): void => {
    const needed = bufferLength + input.length;
    if (needed > buffer.length) {
      let capacity = buffer.length;
      while (capacity < needed) capacity *= 2;
      const grown = new Float32Array(capacity);
      grown.set(buffer.subarray(0, bufferLength));
      buffer = grown;
    }
    buffer.set(input, bufferLength);
    bufferLength += input.length;
  };

  const quantized = phaseCount !== phaseDen;

  /** Emit outputs while their right-most tap is below `limit` (and `n < maxOutputs`). */
  const drain = (limit: number, maxOutputs: number): Float32Array => {
    const estimate = Math.max(
      0,
      Math.ceil(((limit - halfWidth) * phaseDen) / stepNum) - nextOutput + 2,
    );
    const out = new Float32Array(Math.min(estimate, Math.max(0, maxOutputs - nextOutput)));
    let count = 0;
    while (nextOutput < maxOutputs && count < out.length) {
      // Output frame n sits at input index `base` plus phase `key / phaseCount`.
      const position = nextOutput * stepNum;
      let base = Math.floor(position / phaseDen);
      const remainder = position - base * phaseDen;
      let key = quantized ? Math.round((remainder * phaseCount) / phaseDen) : remainder;
      if (key >= phaseCount) {
        base += 1;
        key = 0;
      }
      if (base + halfWidth >= limit) break;
      const filter = filters[key] ?? (filters[key] = buildFilter(key / phaseCount));
      const offset = base - halfWidth + 1 - bufferStart;
      let acc = 0;
      for (let j = 0; j < taps; j++) acc += buffer[offset + j] * filter[j];
      out[count++] = acc;
      nextOutput += 1;
    }
    // Drop history no future output can reach (bases never decrease).
    const keepFrom = Math.floor((nextOutput * stepNum) / phaseDen) - halfWidth + 1;
    const drop = Math.min(bufferLength, Math.max(0, keepFrom - bufferStart));
    if (drop > 0) {
      buffer.copyWithin(0, drop, bufferLength);
      bufferLength -= drop;
      bufferStart += drop;
    }
    return count === out.length ? out : out.slice(0, count);
  };

  return {
    inputRate,
    outputRate,
    process(input) {
      if (flushed) throw new Error('The resampler was already flushed.');
      if (input.length === 0) return new Float32Array(0);
      append(input);
      received += input.length;
      return drain(received, Number.POSITIVE_INFINITY);
    },
    flush() {
      if (flushed) return new Float32Array(0);
      flushed = true;
      // Pad with the silence after the stream so the last outputs have taps.
      append(new Float32Array(halfWidth + 1));
      return drain(received + halfWidth + 1, resampledLength(received, inputRate, outputRate));
    },
  };
}
