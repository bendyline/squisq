import { describe, expect, it } from 'vitest';
import { SeededRandom } from '../random/SeededRandom.js';
import { createLoudnessMeter } from '../mediaEdit/dsp/loudness.js';
import { createLimiter } from '../mediaEdit/dsp/limiter.js';
import { createResampler } from '../mediaEdit/dsp/resample.js';
import { createDenoiseStage, type Denoiser } from '../mediaEdit/dsp/denoiser.js';
import { createBreathAnalyzer, detectBreaths } from '../mediaEdit/dsp/breath.js';
import { detectPauseCuts } from '../mediaEdit/dsp/pauses.js';
import {
  renderMediaFx,
  analyzeMediaFx,
  correctedLoudnessAnalysis,
  MEDIA_FX_SAMPLE_RATE,
} from '../mediaEdit/dsp/chain.js';
import { parseMediaFx } from '../mediaEdit/recipe.js';
import { createBiquadCascade, highpassCoeffs, lowpassCoeffs } from '../mediaEdit/dsp/biquad.js';

const SR = MEDIA_FX_SAMPLE_RATE;

function sine(freq: number, sec: number, amp: number, rate = SR): Float32Array {
  const out = new Float32Array(Math.round(sec * rate));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

function dbfs(db: number): number {
  return Math.pow(10, db / 20);
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function measure(channels: Float32Array[], rate = SR, block = 4096): number {
  const meter = createLoudnessMeter(rate, channels.length);
  for (let i = 0; i < channels[0].length; i += block) {
    meter.push(channels.map((c) => c.subarray(i, i + block)));
  }
  return meter.integrated();
}

function rms(x: Float32Array, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

/** Band-limited seeded noise. */
function bandNoise(
  sec: number,
  lowHz: number,
  highHz: number,
  amp: number,
  seed: number,
): Float32Array {
  const rng = new SeededRandom(seed);
  const out = new Float32Array(Math.round(sec * SR));
  for (let i = 0; i < out.length; i++) out[i] = rng.next() * 2 - 1;
  createBiquadCascade([
    highpassCoeffs(SR, lowHz),
    highpassCoeffs(SR, lowHz),
    lowpassCoeffs(SR, highHz),
    lowpassCoeffs(SR, highHz),
  ]).process(out);
  const scale = amp / Math.max(1e-9, rms(out));
  for (let i = 0; i < out.length; i++) out[i] *= scale;
  return out;
}

/** A voiced syllable: harmonic series on f0 under a Hann envelope. */
function syllable(sec: number, f0: number, amp: number): Float32Array {
  const n = Math.round(sec * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const env = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    let s = 0;
    for (let k = 1; k * f0 < 3500; k++) s += Math.sin((2 * Math.PI * k * f0 * i) / SR) / k;
    out[i] = amp * env * s * 0.5;
  }
  return out;
}

function phrase(syllables: number, seed: number): Float32Array {
  const rng = new SeededRandom(seed);
  return concat(
    ...Array.from({ length: syllables }, () => syllable(0.18, 110 + rng.next() * 60, 0.5)),
  );
}

function source(channels: Float32Array[], block = 4800) {
  return {
    sampleRate: SR,
    channels: channels.length,
    frames: channels[0].length,
    async *open() {
      for (let i = 0; i < channels[0].length; i += block) {
        yield channels.map((c) => c.slice(i, i + block));
      }
    },
  };
}

async function collect(render: (write: (b: Float32Array[]) => void) => Promise<unknown>) {
  const blocks: Float32Array[][] = [];
  const result = await render((b) => {
    blocks.push(b.map((c) => c.slice()));
  });
  const channels = blocks[0].map((_, c) => concat(...blocks.map((b) => b[c])));
  return { channels, result };
}

/** EBU Tech 3341 tolerance: ±0.1 LU. */
function expectLufs(measured: number, target: number): void {
  expect(Math.abs(measured - target)).toBeLessThan(0.1);
}

describe('loudness meter (ITU-R BS.1770-4 / EBU Tech 3341)', () => {
  it('measures a stereo 1 kHz sine at −23 dBFS as −23 LUFS', () => {
    const tone = sine(1000, 20, dbfs(-23));
    expectLufs(measure([tone, tone]), -23);
  });

  it('measures −33 dBFS as −33 LUFS, and mono 3 dB lower', () => {
    const tone = sine(1000, 20, dbfs(-33));
    expectLufs(measure([tone, tone]), -33);
    expectLufs(measure([tone]), -36.01);
  });

  it('gates quiet passages relatively (3341 case 3: −36/−23/−36)', () => {
    const quiet = sine(1000, 10, dbfs(-36));
    const loud = sine(1000, 60, dbfs(-23));
    const signal = concat(quiet, loud, quiet);
    expectLufs(measure([signal, signal]), -23);
  });

  it('gates silence absolutely', () => {
    const tone = sine(1000, 20, dbfs(-23));
    const signal = concat(new Float32Array(SR * 20), tone, new Float32Array(SR * 20));
    expectLufs(measure([signal, signal]), -23);
    expect(measure([new Float32Array(SR * 5)])).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('true-peak limiter', () => {
  it('passes a quiet signal through unchanged, delayed by its latency', () => {
    const limiter = createLimiter({ sampleRate: SR, channels: 1 });
    const x = sine(440, 0.2, 0.25);
    const out = concat(limiter.process([x])[0], limiter.flush()[0]);
    for (let i = 0; i < x.length; i++) expect(out[i + limiter.latency]).toBeCloseTo(x[i], 6);
    expect(limiter.minGain()).toBe(1);
  });

  it('holds loud material under the ceiling, including between samples', () => {
    const ceiling = dbfs(-1);
    const limiter = createLimiter({ sampleRate: SR, channels: 2 });
    // Near-Nyquist content has inter-sample peaks well above its sample peaks.
    const a = concat(sine(11_000, 0.5, 1.6), sine(200, 0.5, 2));
    const b = concat(sine(9_000, 0.5, 1.2), sine(300, 0.5, 1.5));
    const first = limiter.process([a, b]);
    const tail = limiter.flush();
    const outA = concat(first[0], tail[0]);
    // Reconstruct at 4× with the same class of interpolator and check the peak.
    const up = createResampler(SR, SR * 4);
    const hi = concat(up.process(outA), up.flush());
    let peak = 0;
    for (const v of hi) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThan(ceiling * 1.02);
    expect(limiter.minGain()).toBeLessThan(0.7);
  });
});

describe('resampler', () => {
  it('converts 44.1 kHz to 48 kHz without delay', () => {
    const inRate = 44_100;
    const x = sine(1000, 0.5, 0.5, inRate);
    const r = createResampler(inRate, SR);
    const y = concat(r.process(x.subarray(0, 10_000)), r.process(x.subarray(10_000)), r.flush());
    expect(y.length).toBe(Math.ceil((x.length * SR) / inRate));
    const ideal = sine(1000, 0.5, 0.5, SR);
    let maxErr = 0;
    for (let i = 1000; i < y.length - 1000; i++)
      maxErr = Math.max(maxErr, Math.abs(y[i] - ideal[i]));
    expect(maxErr).toBeLessThan(2e-3);
  });

  it('is the identity at equal rates', () => {
    const x = sine(500, 0.1, 0.3);
    const r = createResampler(SR, SR);
    expect(r.process(x)).toEqual(x);
  });
});

describe('denoise stage', () => {
  function fakeDenoiser(scale: number, latency: number): Denoiser {
    const history: number[] = new Array(latency).fill(0);
    return {
      frameSize: 480,
      sampleRate: SR,
      latency,
      processFrame(frame) {
        for (let i = 0; i < frame.length; i++) {
          history.push(frame[i]);
          frame[i] = (history.shift() as number) * scale;
        }
      },
      dispose() {},
    };
  }

  it('returns equal-length blocks delayed by frame + model latency, blending dry by strength', () => {
    const stage = createDenoiseStage(fakeDenoiser(0.5, 100), 0.5);
    expect(stage.latency).toBe(580);
    const x = sine(300, 0.1, 0.4);
    const blocks = [x.subarray(0, 333), x.subarray(333, 2000), x.subarray(2000)];
    const out = concat(...blocks.map((b) => stage.process(b.slice())));
    expect(out.length).toBe(x.length);
    for (let i = 1000; i < x.length; i++) {
      expect(out[i]).toBeCloseTo(0.75 * x[i - 580], 6);
    }
  });
});

describe('breath detection', () => {
  /** Two phrases with a breath between; an unvoiced consonant inside phrase one. */
  function take() {
    const floor = bandNoise(4.6, 100, 8000, dbfs(-62), 1);
    const signal = floor.slice();
    const add = (piece: Float32Array, at: number) => {
      const s = Math.round(at * SR);
      for (let i = 0; i < piece.length && s + i < signal.length; i++) signal[s + i] += piece[i];
    };
    add(phrase(5, 2), 0.3); // 0.3–1.2
    add(bandNoise(0.09, 4000, 9000, dbfs(-24), 3), 0.84); // a short "s" between syllables
    add(bandNoise(0.35, 400, 2500, dbfs(-32), 4), 1.6); // the breath, 1.6–1.95
    add(phrase(6, 5), 2.3); // 2.3–3.38
    add(bandNoise(0.25, 400, 2500, dbfs(-33), 6), 3.8); // a second breath, 3.8–4.05
    return signal;
  }

  it('finds breaths in pauses and ignores unvoiced consonants inside words', () => {
    const analyzer = createBreathAnalyzer(SR);
    const x = take();
    for (let i = 0; i < x.length; i += 4096) analyzer.push(x.subarray(i, i + 4096));
    const regions = detectBreaths(analyzer.frames());
    expect(regions).toHaveLength(2);
    expect(regions[0].start).toBeGreaterThan(1.55);
    expect(regions[0].end).toBeLessThan(2.0);
    expect(regions[0].end - regions[0].start).toBeGreaterThan(0.25);
    expect(regions[1].start).toBeGreaterThan(3.75);
    expect(regions[1].end).toBeLessThan(4.1);
  });

  it('is not fooled by a DC offset (cheap mics, no high-pass in the recipe)', () => {
    const analyzer = createBreathAnalyzer(SR);
    const x = take();
    for (let i = 0; i < x.length; i++) x[i] += 0.05;
    for (let i = 0; i < x.length; i += 4096) analyzer.push(x.subarray(i, i + 4096));
    expect(detectBreaths(analyzer.frames())).toHaveLength(2);
  });

  it('attenuates breaths in a render and leaves speech alone', async () => {
    const x = take();
    const { channels } = await collect((write) =>
      renderMediaFx({ fx: parseMediaFx('debreath:-15')!, source: source([x]), write }),
    );
    const out = channels[0];
    expect(out.length).toBe(x.length);
    const breath = [Math.round(1.65 * SR), Math.round(1.9 * SR)] as const;
    const speech = [Math.round(0.5 * SR), Math.round(1.0 * SR)] as const;
    const breathDrop = 20 * Math.log10(rms(out, ...breath) / rms(x, ...breath));
    expect(breathDrop).toBeLessThan(-12);
    expect(rms(out, ...speech)).toBeCloseTo(rms(x, ...speech), 6);
  });
});

describe('renderMediaFx', () => {
  it('keeps output sample-aligned and exactly as long as the source', async () => {
    const x = concat(phrase(4, 7), new Float32Array(1234));
    const identity: Denoiser = {
      frameSize: 480,
      sampleRate: SR,
      latency: 0,
      processFrame() {},
      dispose() {},
    };
    const { channels, result } = await collect((write) =>
      renderMediaFx({
        fx: parseMediaFx('denoise:1')!,
        source: source([x, x]),
        denoiser: async () => identity,
        write,
      }),
    );
    expect(result).toMatchObject({ frames: x.length, ignoredOps: [] });
    for (let i = 0; i < x.length; i += 97) expect(channels[1][i]).toBeCloseTo(x[i], 6);
  });

  it('reaches the loudness target and respects the true-peak ceiling', async () => {
    const x = concat(phrase(20, 8), phrase(20, 9));
    for (let i = 0; i < x.length; i++) x[i] *= 0.1; // a quiet take
    const before = measure([x]);
    const { channels, result } = await collect((write) =>
      renderMediaFx({ fx: parseMediaFx('highpass:80 loudness:-16')!, source: source([x]), write }),
    );
    const typed = result as { analysis: { loudnessGainDb: number; integratedLufs: number } };
    expect(typed.analysis.integratedLufs).toBeCloseTo(before, 0);
    expect(measure(channels)).toBeGreaterThan(-16.8);
    expect(measure(channels)).toBeLessThan(-15.2);
    let peak = 0;
    for (const v of channels[0]) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(dbfs(-1) * 1.001);
  });

  it('lands on target after one corrective pass when limiting pulls loudness down', async () => {
    // Spiky material: sparse loud clicks over quiet speech — heavy limiting at -12 LUFS.
    const x = concat(phrase(20, 12), phrase(20, 13));
    for (let i = 0; i < x.length; i++) x[i] *= 0.2;
    for (let i = 0; i < x.length; i += SR / 4) x[i] = 0.9;
    const fx = parseMediaFx('loudness:-12')!;
    const first = await collect((write) => renderMediaFx({ fx, source: source([x]), write }));
    const firstResult = first.result as Parameters<typeof correctedLoudnessAnalysis>[1];
    expect(firstResult.outputLufs).not.toBeNull();
    const corrected = correctedLoudnessAnalysis(fx, firstResult);
    if (corrected) {
      expect(corrected.loudnessGainDb).toBeGreaterThan(firstResult.analysis.loudnessGainDb);
      const second = await collect((write) =>
        renderMediaFx({ fx, source: source([x]), analysis: corrected, write }),
      );
      const secondLufs = (second.result as { outputLufs: number }).outputLufs;
      expect(Math.abs(secondLufs + 12)).toBeLessThan(Math.abs((firstResult.outputLufs ?? 0) + 12));
    } else {
      expect(Math.abs((firstResult.outputLufs ?? 0) + 12)).toBeLessThanOrEqual(0.5);
    }
  });

  it('reports denoise as ignored when no denoiser is available', async () => {
    const x = sine(200, 0.2, 0.1);
    const { result } = await collect((write) =>
      renderMediaFx({ fx: parseMediaFx('denoise:0.8 deess:3')!, source: source([x]), write }),
    );
    expect((result as { ignoredOps: string[] }).ignoredOps).toEqual(['deess:3', 'denoise:0.8']);
  });

  it('reuses a whole-take analysis for a region preview', async () => {
    const x = concat(phrase(10, 10), phrase(10, 11));
    const fx = parseMediaFx('loudness:-18')!;
    const analysis = await analyzeMediaFx({ fx, source: source([x]) });
    const region = x.slice(SR, SR * 2);
    const { result } = await collect((write) =>
      renderMediaFx({ fx, source: source([region]), analysis, startSec: 1, write }),
    );
    expect((result as { analysis: unknown }).analysis).toBe(analysis);
  });

  it('rejects a source at the wrong rate', async () => {
    await expect(
      renderMediaFx({
        fx: parseMediaFx('loudness')!,
        source: { ...source([sine(100, 0.1, 0.1)]), sampleRate: 44_100 },
        write: () => {},
      }),
    ).rejects.toThrow('48000 Hz');
  });
});

describe('pause tightening', () => {
  function withPauses(): Float32Array {
    const floor = bandNoise(8, 100, 8000, dbfs(-62), 21);
    const x = floor.slice();
    const add = (piece: Float32Array, at: number) => {
      const s = Math.round(at * SR);
      for (let i = 0; i < piece.length && s + i < x.length; i++) x[s + i] += piece[i];
    };
    add(phrase(5, 22), 0.2); // 0.2–1.1, then a 2 s pause
    add(phrase(5, 23), 3.1); // 3.1–4.0, then a 0.5 s pause (kept)
    add(phrase(5, 24), 4.5); // 4.5–5.4, then a 1.2 s pause with a breath inside
    add(bandNoise(0.3, 400, 2500, dbfs(-32), 25), 5.85);
    add(phrase(5, 26), 6.6); // 6.6–7.5
    return x;
  }

  function framesOf(x: Float32Array) {
    const analyzer = createBreathAnalyzer(SR);
    for (let i = 0; i < x.length; i += 4096) analyzer.push(x.subarray(i, i + 4096));
    return analyzer.frames();
  }

  it('shortens long pauses to the keep length and leaves short ones', () => {
    const cuts = detectPauseCuts(framesOf(withPauses()), { maxPauseSec: 0.8, keepSec: 0.4 });
    expect(cuts).toHaveLength(1);
    const [cut] = cuts;
    // The 1.1 → 3.1 s pause keeps ~0.2 s at each side.
    expect(cut.start).toBeGreaterThan(1.2);
    expect(cut.start).toBeLessThan(1.45);
    expect(cut.end).toBeGreaterThan(2.75);
    expect(cut.end).toBeLessThan(3.0);
  });

  it('never cuts through a breath', () => {
    const cuts = detectPauseCuts(framesOf(withPauses()), { maxPauseSec: 0.3, keepSec: 0.2 });
    for (const cut of cuts) {
      const overlapsBreath = cut.start < 6.15 && cut.end > 5.85;
      expect(overlapsBreath).toBe(false);
    }
  });

  it('proposes nothing for a take with no speech contrast', () => {
    expect(detectPauseCuts(framesOf(bandNoise(3, 100, 8000, 0.01, 27)))).toEqual([]);
  });
});
