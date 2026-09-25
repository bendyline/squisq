import { describe, expect, it } from 'vitest';
import { createMediaTimeMap } from '../mediaEdit/timeMap.js';
import { SeededRandom } from '../random/SeededRandom.js';

describe('createMediaTimeMap', () => {
  it('is the identity for an untrimmed, uncut clip', () => {
    const map = createMediaTimeMap({});
    expect(map.sourceToPlayed(12.5)).toBe(12.5);
    expect(map.playedToSource(12.5)).toBe(12.5);
    expect(map.playedDuration).toBe(Number.POSITIVE_INFINITY);
    expect(map.hasCuts).toBe(false);
  });

  it('shifts by the trim head and ends at the trim tail', () => {
    const map = createMediaTimeMap({ clipStart: 5, clipEnd: 20 });
    expect(map.playedDuration).toBe(15);
    expect(map.sourceToPlayed(5)).toBe(0);
    expect(map.sourceToPlayed(20)).toBe(15);
    expect(map.sourceToPlayed(4)).toBeNull();
    expect(map.sourceToPlayed(21)).toBeNull();
    expect(map.snapSourceToPlayed(2)).toBe(0);
    expect(map.snapSourceToPlayed(25)).toBe(15);
  });

  it('closes up the timeline at each cut', () => {
    const map = createMediaTimeMap({
      clipEnd: 30,
      cuts: [
        { start: 10, end: 12 },
        { start: 20, end: 25 },
      ],
    });
    expect(map.playedDuration).toBe(23);
    expect(map.keptRanges()).toEqual([
      { start: 0, end: 10 },
      { start: 12, end: 20 },
      { start: 25, end: 30 },
    ]);
    expect(map.sourceToPlayed(9)).toBe(9);
    expect(map.sourceToPlayed(11)).toBeNull();
    expect(map.sourceToPlayed(12)).toBe(10);
    expect(map.sourceToPlayed(26)).toBe(19);
    // A range endpoint inside a cut snaps to the cut's boundary.
    expect(map.snapSourceToPlayed(11)).toBe(10);
    expect(map.snapSourceToPlayed(22)).toBe(18);
    expect(map.playedToSource(10)).toBe(12);
    expect(map.playedToSource(18.5)).toBe(25.5);
    expect(map.playedToSource(99)).toBe(30);
  });

  it('drops cuts outside the trim window and caps with the source duration', () => {
    const map = createMediaTimeMap({
      clipStart: 5,
      cuts: [
        { start: 1, end: 3 },
        { start: 8, end: 9 },
      ],
      sourceDuration: 15,
    });
    expect(map.cuts).toEqual([{ start: 8, end: 9 }]);
    expect(map.playedDuration).toBe(9);
  });

  it('round-trips played → source → played for random cut lists', () => {
    const rng = new SeededRandom(1234);
    for (let trial = 0; trial < 50; trial++) {
      const end = 20 + rng.next() * 100;
      const cuts = Array.from({ length: Math.floor(rng.next() * 8) }, () => {
        const start = rng.next() * end;
        return { start, end: start + rng.next() * 5 };
      });
      const map = createMediaTimeMap({ clipStart: rng.next() * 5, clipEnd: end, cuts });
      let covered = 0;
      for (const range of map.keptRanges()) covered += range.end - range.start;
      expect(map.playedDuration).toBeCloseTo(covered, 9);
      for (let i = 0; i < 20; i++) {
        const played = rng.next() * map.playedDuration * 0.999;
        const source = map.playedToSource(played);
        expect(map.sourceToPlayed(source)).toBeCloseTo(played, 9);
      }
    }
  });
});
