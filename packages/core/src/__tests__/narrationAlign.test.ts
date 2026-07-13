import { describe, it, expect } from 'vitest';
import { alignNarration } from '../narration/align';
import type { NarrationAlignment, NarrationScript } from '../narration/types';
import type { NarrationTrace } from '../narration/trace';
import { scriptFromMarkdown, takeFromScript, type SyntheticTake } from './narrationTestSignals';

const SR = 48000;

const MD = `# The River Walk

Every morning we follow the path along the river and count the boats heading out.
The bakery opens early and the smell of bread carries across the water to the far bank.

By noon the light changes and the whole town seems to slow down for an hour or two.

## The Market

Stalls line the square with fruit and flowers and a man who fixes watches while you wait.
We always stop for coffee before carrying everything home up the long hill past the church.

## Evening

The lamps come on one street at a time and the river turns the color of old coins.
`;

const script = scriptFromMarkdown(MD);

/** Burst onsets are at word start; envelope peaks ~half a burst later. */
const PEAK_OFFSET = 0.08;

function timingErrors(alignment: NarrationAlignment, take: SyntheticTake): number[] {
  return alignment.words.map((w, k) => Math.abs(w.tSec - (take.trueWordTimes[k] + PEAK_OFFSET)));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

/** A live trace with a deterministic ±wobble, as a recorded prompter would produce. */
function traceFromTake(
  take: SyntheticTake,
  scriptRef: NarrationScript,
  wobbleSec: number,
): NarrationTrace {
  const samples: { tMs: number; wordPos: number }[] = [];
  for (let t = 0; t <= take.durationSec; t += 0.25) {
    const shifted = t + wobbleSec * Math.sin(t * 1.3);
    // wordPos convention: floor(wordPos) is the ACTIVE token — the word
    // currently being spoken — not the count of words started.
    let started = 0;
    while (started < take.trueWordTimes.length && take.trueWordTimes[started] <= shifted) started++;
    const wordPos = Math.max(0, started - 1);
    samples.push({ tMs: t * 1000, wordPos: Math.min(wordPos, scriptRef.tokens.length) });
  }
  return { samples };
}

describe('alignNarration', () => {
  const take = takeFromScript(script, 150, SR, 21);

  it('clean take without a trace: median error < 0.25 s, p95 < 1 s', () => {
    const alignment = alignNarration({ pcm: take.pcm, sampleRate: SR, script });
    expect(alignment.words.length).toBe(script.tokens.length);
    const errors = timingErrors(alignment, take);
    expect(median(errors)).toBeLessThan(0.25);
    expect(p95(errors)).toBeLessThan(1.0);
    expect(alignment.detectedSyllables).toBeGreaterThan(script.totalSyllables * 0.7);
  });

  it('clean take with a wobbly trace: median error < 0.15 s, p95 < 0.5 s', () => {
    const trace = traceFromTake(take, script, 0.8);
    const alignment = alignNarration({ pcm: take.pcm, sampleRate: SR, script, trace });
    const errors = timingErrors(alignment, take);
    expect(median(errors)).toBeLessThan(0.15);
    expect(p95(errors)).toBeLessThan(0.5);
  });

  it('survives filler insertions and a dropped syllable', () => {
    const messy = takeFromScript(script, 150, SR, 22, {
      extraOnsets: [4.1, 12.4],
      dropTokenSyllable: [8 * 1000 + 0],
    });
    const trace = traceFromTake(messy, script, 0.5);
    const alignment = alignNarration({ pcm: messy.pcm, sampleRate: SR, script, trace });
    const errors = timingErrors(alignment, messy);
    expect(median(errors)).toBeLessThan(0.25);
  });

  it('block ranges are contiguous, monotonic, and near the true block starts', () => {
    const trace = traceFromTake(take, script, 0.4);
    const alignment = alignNarration({ pcm: take.pcm, sampleRate: SR, script, trace });
    const blocks = alignment.blocks;
    expect(blocks.length).toBe(script.blocks.length);
    expect(blocks[0].startSec).toBe(0);
    for (let b = 0; b < blocks.length - 1; b++) {
      expect(blocks[b].endSec).toBeCloseTo(blocks[b + 1].startSec, 9);
      expect(blocks[b].endSec).toBeGreaterThanOrEqual(blocks[b].startSec);
    }
    const last = blocks[blocks.length - 1];
    expect(last.endSec).toBeGreaterThan(last.startSec);
    expect(last.endSec).toBeLessThanOrEqual(take.durationSec + 1e-6);
    for (let b = 1; b < blocks.length; b++) {
      expect(Math.abs(blocks[b].startSec - take.trueBlockStarts[b])).toBeLessThan(0.7);
    }
  });

  it('word times are monotonic', () => {
    const alignment = alignNarration({ pcm: take.pcm, sampleRate: SR, script });
    for (let i = 1; i < alignment.words.length; i++) {
      expect(alignment.words[i].tSec).toBeGreaterThanOrEqual(alignment.words[i - 1].tSec);
    }
  });

  it('falls back proportionally when nothing is detected', () => {
    const quiet = new Float32Array(SR * 5);
    const alignment = alignNarration({ pcm: quiet, sampleRate: SR, script });
    expect(alignment.detectedSyllables).toBe(0);
    expect(alignment.words.length).toBe(script.tokens.length);
    expect(alignment.words.every((w) => w.interpolated)).toBe(true);
    expect(alignment.blocks.length).toBe(script.blocks.length);
  });

  it('handles an empty script', () => {
    const alignment = alignNarration({
      pcm: new Float32Array(SR),
      sampleRate: SR,
      script: {
        sourceText: '',
        tokens: [],
        blocks: [],
        totalSyllables: 0,
        cumulativeSyllables: [0],
      },
    });
    expect(alignment.words).toEqual([]);
    expect(alignment.blocks).toEqual([]);
  });

  it('is deterministic', () => {
    const a = alignNarration({ pcm: take.pcm, sampleRate: SR, script });
    const b = alignNarration({ pcm: take.pcm, sampleRate: SR, script });
    expect(a).toEqual(b);
  });
});
