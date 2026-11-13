import { describe, expect, it } from 'vitest';
import {
  MIN_CUT_SEC,
  addCut,
  cutAt,
  cutsInRange,
  formatLength,
  formatRulerLabel,
  formatTimecode,
  moveCutEdge,
  peakInRange,
  removeCut,
  rulerStep,
} from '../mediaEdit/cutList';

const clip = { start: 0, end: 60 };

describe('cut list arithmetic', () => {
  it('adds a section in order and merges the cuts it overlaps or touches', () => {
    const cuts = addCut(addCut([], { start: 20, end: 25 }, clip), { start: 5, end: 8 }, clip);
    expect(cuts).toEqual([
      { start: 5, end: 8 },
      { start: 20, end: 25 },
    ]);
    expect(addCut(cuts, { start: 7, end: 21 }, clip)).toEqual([{ start: 5, end: 25 }]);
    expect(addCut(cuts, { start: 8, end: 10 }, clip)).toEqual([
      { start: 5, end: 10 },
      { start: 20, end: 25 },
    ]);
  });

  it('keeps cuts inside the trim window and to the millisecond', () => {
    const trimmed = { start: 10, end: 30 };
    expect(addCut([], { start: 4, end: 12.34567 }, trimmed)).toEqual([{ start: 10, end: 12.346 }]);
    expect(addCut([], { start: 28, end: 40 }, trimmed)).toEqual([{ start: 28, end: 30 }]);
    expect(addCut([], { start: 40, end: 50 }, trimmed)).toEqual([]);
    expect(cutsInRange([{ start: 0, end: 100 }], trimmed)).toEqual([{ start: 10, end: 30 }]);
  });

  it('restores a section', () => {
    const cuts = [
      { start: 5, end: 8 },
      { start: 20, end: 25 },
    ];
    expect(removeCut(cuts, 0)).toEqual([{ start: 20, end: 25 }]);
    expect(removeCut(cuts, 5)).toEqual(cuts);
  });

  it('moves an edge, stopping at the cut’s other edge, its neighbour and the window', () => {
    const cuts = [
      { start: 5, end: 8 },
      { start: 20, end: 25 },
    ];
    expect(moveCutEdge(cuts, 0, 'end', 12, clip)[0]).toEqual({ start: 5, end: 12 });
    // Never onto the neighbour: they would fuse and renumber mid-drag.
    expect(moveCutEdge(cuts, 0, 'end', 40, clip)[0]).toEqual({ start: 5, end: 19.99 });
    expect(moveCutEdge(cuts, 1, 'start', 0, clip)[1]).toEqual({ start: 8.01, end: 25 });
    // Never through its own other edge.
    expect(moveCutEdge(cuts, 0, 'end', 1, clip)[0]).toEqual({ start: 5, end: 5 + MIN_CUT_SEC });
    expect(moveCutEdge(cuts, 1, 'start', 59, clip)[1]).toEqual({
      start: 25 - MIN_CUT_SEC,
      end: 25,
    });
    // Never out of the clip.
    expect(moveCutEdge(cuts, 0, 'start', -3, clip)[0]).toEqual({ start: 0, end: 8 });
    expect(moveCutEdge(cuts, 1, 'end', 99, clip)[1]).toEqual({ start: 20, end: 60 });
    // The other cuts are left alone, and so is the input.
    expect(moveCutEdge(cuts, 0, 'end', 12, clip)[1]).toEqual({ start: 20, end: 25 });
    expect(cuts[0]).toEqual({ start: 5, end: 8 });
    expect(cutsInRange(moveCutEdge(cuts, 0, 'end', 40, clip), clip)).toHaveLength(2);
  });

  it('finds the cut that removes an instant (it owns its start, not its end)', () => {
    const cuts = [{ start: 5, end: 8 }];
    expect(cutAt(cuts, 5)).toEqual({ start: 5, end: 8 });
    expect(cutAt(cuts, 7.999)).toEqual({ start: 5, end: 8 });
    expect(cutAt(cuts, 8)).toBeNull();
    expect(cutAt(cuts, 4.999)).toBeNull();
  });
});

describe('timeline labels', () => {
  it('formats positions and lengths', () => {
    expect(formatTimecode(0)).toBe('0:00.0');
    expect(formatTimecode(65.25)).toBe('1:05.3');
    expect(formatTimecode(59.96)).toBe('1:00.0');
    expect(formatTimecode(-1)).toBe('0:00.0');
    expect(formatLength(0.84)).toBe('0.8 s');
    expect(formatLength(12.44)).toBe('12.4 s');
    expect(formatLength(65)).toBe('1:05');
  });

  it('spaces ruler labels so they do not collide at any zoom', () => {
    // 26 minutes across 700 px: a label every five minutes.
    expect(rulerStep((26 * 60) / 700)).toBe(300);
    // Zoomed to four seconds across 700 px: every half second.
    expect(rulerStep(4 / 700)).toBe(0.5);
    expect(rulerStep(1000)).toBe(3600);
    expect(formatRulerLabel(300, 300)).toBe('5:00');
    expect(formatRulerLabel(2.5, 0.5)).toBe('0:02.5');
  });

  it('takes the loudest slice a pixel covers', () => {
    const peaks = new Float32Array([0.1, 0.9, 0.2, 0.4]);
    expect(peakInRange(peaks, 0, 4)).toBeCloseTo(0.9);
    expect(peakInRange(peaks, 2, 4)).toBeCloseTo(0.4);
    // A pixel narrower than a slice still shows that slice.
    expect(peakInRange(peaks, 1.2, 1.4)).toBeCloseTo(0.9);
    expect(peakInRange(peaks, 10, 12)).toBe(0);
    expect(peakInRange(peaks, -5, 1)).toBeCloseTo(0.1);
  });
});
